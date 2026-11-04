"""Deterministic assembly; parser proposals are not proof of their own correctness."""
from hashlib import sha256
import json
from .models import ExtractionEvidence, ExtractedMenuCategory, ExtractedMenuItem, ExtractionIssue
from .parsing import clean
from .prices import parse_price


def identifier(prefix, value):
    return prefix + '_' + sha256(value.encode()).hexdigest()[:24]


def supported(value, block):
    if not value: return True
    if not block: return False
    if clean(value) in clean(block.text): return True
    if block.method == 'json_ld':
        try:
            def leaves(obj):
                if isinstance(obj, dict): return ' '.join(leaves(v) for v in obj.values())
                if isinstance(obj, list): return ' '.join(leaves(v) for v in obj)
                return str(obj)
            return clean(value) in clean(leaves(json.loads(block.text)))
        except (ValueError, RecursionError): pass
    return False


class MenuAssembler:
    def __init__(self, restaurant_id):
        self.restaurant_id = restaurant_id
        self.categories, self.evidence, self.items, self.names, self.issues = {}, {}, {}, {}, []

    def issue(self, code, message, source_id=None, item_ids=(), severity='review'):
        value = ExtractionIssue(code=code, message=message[:1000], source_id=source_id, item_ids=list(item_ids), severity=severity)
        if value not in self.issues and len(self.issues) < 600: self.issues.append(value)

    def add_evidence(self, block, source):
        key = identifier('ev', f'{source.id}|{source.source_hash}|{block.locator}|{block.text}')
        value = ExtractionEvidence(id=key, source_id=source.id, source_hash=source.source_hash,
            source_url=source.source_url, locator=block.locator, page=block.page, quote=block.text, method=block.method)
        self.evidence[key] = value
        return key

    def add(self, raw, source):
        if len(self.items) >= 600:
            self.issue('item_limit', 'This menu exceeds the total item limit; remaining records need another review.', source.id)
            return False
        blocks = [raw.block, raw.category_block, raw.currency_block, *raw.context_blocks]
        valid = (0 < len(raw.name) <= 300 and len(raw.description) <= 3000
                 and all(not b or 0 < len(b.text) <= 8000 and len(b.locator) <= 500 for b in blocks)
                 and supported(raw.name, raw.block) and supported(raw.description, raw.block)
                 and (not raw.category or supported(raw.category, raw.category_block))
                 and (not raw.currency or supported(raw.currency, raw.block) or supported(raw.currency, raw.currency_block))
                 and all(supported(p[0], raw.block) and (not p[1] or any(supported(p[1], b) for b in blocks))
                         and (not p[2] or supported(p[2], raw.block) or supported(p[2], raw.currency_block)) for p in raw.offers)
                 and (not raw.price_text or raw.offers or supported(raw.price_text, raw.block)))
        if not valid:
            self.issue('unsupported_fields', 'An item contains unsupported or oversized fields and was rejected.', source.id, severity='blocked')
            return False
        ev = self.add_evidence(raw.block, source)
        refs = [ev] + [self.add_evidence(b, source) for b in blocks[1:] if b]
        price = parse_price(raw.price_text, raw.currency, ev, raw.offers)
        category_name = raw.category or 'Uncategorized'
        category_key = category_name.casefold()
        category_id = identifier('cat', self.restaurant_id + '|' + category_key)
        if category_key not in self.categories:
            self.categories[category_key] = ExtractedMenuCategory(id=category_id, name=category_name, evidence_ids=[], items=[])
        category = self.categories[category_key]
        if raw.category_block:
            category.evidence_ids = list(dict.fromkeys([*category.evidence_ids, refs[1]]))
        price_key = [(p.label, p.amount_minor, p.currency, p.raw if p.amount_minor is None else None) for p in price.options]
        fingerprint = json.dumps([category_key, raw.name.casefold(), raw.description, price.kind, price_key, raw.unavailable], ensure_ascii=False)
        key = identifier('dish', self.restaurant_id + '|' + fingerprint)
        if key in self.items:
            old = self.items[key]
            old.evidence_ids = list(dict.fromkeys([*old.evidence_ids, *refs]))
            self.issue('duplicate_merged', 'Identical source records were merged and all origins retained.', source.id, [key], 'notice')
            return True
        limited = []
        if not raw.category: limited.append('The source did not establish a category; Uncategorized is an organizational label.')
        if raw.block.method == 'pdf_text': limited.append('PDF layout and item boundaries need review.')
        if not price.budget_usable: limited.extend(price.limitations or ['Multiple prices or a range require an explicit variant choice before budget use.'])
        item = ExtractedMenuItem(id=key, category_id=category_id, name=raw.name, description=raw.description,
            price=price, evidence_ids=refs, availability='listed_unavailable' if raw.unavailable else 'unverified',
            confidence='needs_review' if limited else 'structured' if raw.block.method == 'json_ld' else 'supported', limitations=limited)
        self.items[key] = item
        category.items.append(item)
        if limited: self.issue('item_review', '; '.join(limited), source.id, [key])
        name_key = category_key + '|' + raw.name.casefold()
        if name_key in self.names:
            others = self.names[name_key]
            for previous in others:
                self.items[previous].confidence = 'needs_review'
                self.items[previous].price.budget_usable = False
            item.confidence = 'needs_review'; item.price.budget_usable = False
            self.issue('conflicting_duplicate', 'The same named dish has conflicting descriptions, availability or prices. Neither version was preferred.', source.id, [*others, key])
        self.names.setdefault(name_key, []).append(key)
        return True

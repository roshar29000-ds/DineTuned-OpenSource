from datetime import datetime, timezone
from hashlib import sha256
import json
import re
from ..menu_sources.agent import format_of
from ..menu_sources.fetch import SourceFetcher
from ..menu_sources.pages import parse_page, branch_evidence, contains
from ..menu_sources.urls import SourceBlocked
from .html import extract_html
from .pdf import extract_pdf
from .models import ExtractedSource, ExtractedRestaurantMenu, MenuCompleteness, MenuExtractionResult
from .validation import MenuAssembler, identifier
from .vision import UnavailableVisionProvider, VisionContext, check_vision

PARSER_VERSION = 'html-pdf-1.0'


class ExtractionFetcher(SourceFetcher):
    """Reuse every 4D.4A network/robots check; retrieve bounded whole documents."""
    MAX_REQUESTS = 20
    MAX_BYTES = 8_000_000
    WORK_SECONDS = 35
    BINARY_BYTES = 2_000_000
    SAMPLE_BINARY = False


class MenuExtractionPipeline:
    def __init__(self, fetcher, vision=None, now=lambda: datetime.now(timezone.utc)):
        self.fetcher = fetcher
        self.vision = vision or UnavailableVisionProvider()
        self.now = now
        self.parents = {}

    def corroborated_parent(self, candidate, restaurant):
        references = [e.source_url for e in candidate.evidence if e.kind == 'branch' and e.source_url != candidate.source_url]
        if not references: return False
        url = references[0]
        if url not in self.parents:
            self.parents[url] = parse_page(self.fetcher.fetch(url))
        page = self.parents[url]
        branch, _, scoped = branch_evidence(page, restaurant)
        if page.nofollow: raise SourceBlocked('The linking page now prohibits following its menu links.')
        specific = any(link.url == candidate.source_url and link.branch == 'exact' for link in scoped)
        linked = any(link.url == candidate.source_url for link in [*page.links, *scoped])
        if not (specific or branch == 'exact' and linked):
            raise SourceBlocked('The current linking page no longer corroborates this menu for the selected branch.')
        return True

    def extract(self, request):
        chosen = set(request.candidate_ids)
        candidates = [c for c in request.sources.candidates if c.suitable_for_extraction and (not chosen or c.id in chosen)]
        assembler = MenuAssembler(request.restaurant.place_id)
        sources, vision_status = [], 'not_needed'
        eligible = [c for c in request.sources.candidates if c.suitable_for_extraction]
        if len(candidates) < len(eligible):
            assembler.issue('unselected_sources', 'Only part of the discovered source set was requested; other menus remain unprocessed.')
        if any(c.menu_type not in ('delivery', 'takeaway', 'catering') and not c.suitable_for_extraction for c in request.sources.candidates):
            assembler.issue('unresolved_sources', 'Some discovered menu sources have unresolved branch, date or access evidence.')
        if any('unchecked' in line or 'limit' in line for line in request.sources.limitations):
            assembler.issue('discovery_incomplete', 'Source discovery reported unchecked links or access limits.')
        if len(candidates) > 8:
            candidates = candidates[:8]
            assembler.issue('source_limit', 'Only eight sources can be processed in one request; remaining sources are unprocessed.')
        for candidate in candidates:
            source = ExtractedSource(id=identifier('src', candidate.source_url), candidate=candidate,
                                     source_url=candidate.source_url, status='failed')
            sources.append(source)
            try:
                parent = self.corroborated_parent(candidate, request.restaurant)
                resource = self.fetcher.fetch(candidate.source_url)
                if resource.partial: raise SourceBlocked('A sampled or truncated document cannot be used for extraction.')
                source.source_url = resource.url
                source.source_hash = sha256(resource.body).hexdigest()
                source.retrieved_at = self.now()
                format_ = format_of(resource)
                if format_ != candidate.format: raise SourceBlocked('The menu document format changed since discovery.')
                if format_ == 'html':
                    page = parse_page(resource)
                    if any(isinstance(entity.get('name'), str) and not contains(entity['name'], request.restaurant.display_name) for entity in page.entities):
                        raise SourceBlocked('This page includes a different restaurant identity; a branch-specific menu source is required.')
                    branch, _, _ = branch_evidence(page, request.restaurant)
                    if branch in ('other_branch', 'site_wide') or branch != 'exact' and not parent:
                        raise SourceBlocked('The current menu does not corroborate the exact selected restaurant branch.')
                    parsed = extract_html(resource.body)
                elif format_ == 'pdf':
                    if not parent: raise SourceBlocked('A PDF requires a currently corroborated linking page for the selected branch.')
                    parsed = extract_pdf(resource.body, request.restaurant.display_name, candidate.title)
                    street = (request.restaurant.formatted_address or '').split(',')[0]
                    addresses = re.findall(r'^\s*\d{1,6}\s+[^\n]{0,100}\b(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd)\b[^\n]*', parsed.identity_text, re.I | re.M)
                    if addresses and (not street or any(not contains(address, street) for address in addresses)):
                        raise SourceBlocked('The PDF contains an address that conflicts with the selected branch.')
                    expected_postal = re.search(r'\b\d{5}(?:-\d{4})?\b', request.restaurant.formatted_address or '')
                    if expected_postal and any(re.search(r'\b\d{5}(?:-\d{4})?\b', address)
                        and expected_postal[0] not in address for address in addresses):
                        raise SourceBlocked('The PDF postal address conflicts with the selected branch.')
                else:
                    if not parent: raise SourceBlocked('An image requires a currently corroborated linking page for the selected branch.')
                    from .parsing import ParsedDocument
                    parsed = ParsedDocument(page_count=1, needs_vision=True)
                source.page_count = parsed.page_count
                source.parsed_pages = parsed.parsed_pages
                source.recognized_items = parsed.recognized
                if parsed.needs_vision:
                    missing = tuple(n for n in range(1, parsed.page_count + 1) if n not in parsed.parsed_pages)
                    proposal = check_vision(self.vision, VisionContext(source.source_hash, format_, resource.body, missing))
                    vision_status = 'mocked' if proposal.mode == 'mocked' else vision_status if vision_status == 'mocked' else 'unavailable'
                    assembler.issue('vision_required', 'Image/scanned pages have no validated text extraction. Mock proposals are never accepted as actual menu contents.', source.id)
                for code, message in parsed.issues: assembler.issue(code, message, source.id)
                for raw in parsed.items:
                    if assembler.add(raw, source): source.extracted_items += 1
                source.unresolved_sections = list(dict.fromkeys(s for s in parsed.sections if not any(i.category == s for i in parsed.items)))
                accounted = parsed.accounted and source.extracted_items == source.recognized_items and not source.unresolved_sections
                source.coverage = 'accounted_source_records' if accounted else 'partial' if source.extracted_items else 'unknown'
                source.status = ('parsed' if accounted else 'partial') if source.extracted_items else 'needs_vision' if parsed.needs_vision else 'failed'
                if not source.extracted_items: assembler.issue('no_extracted_items', 'No validated dish records were recovered from this source.', source.id)
            except SourceBlocked as error:
                source.status = 'blocked'
                assembler.issue('source_blocked', str(error), source.id, severity='blocked')
            except (ValueError, TypeError, RecursionError, OverflowError):
                source.status = 'failed'
                assembler.issue('parse_failed', 'This document could not be parsed into the validated extraction contract.', source.id, severity='blocked')
        all_accounted = (bool(sources) and len(sources) == len(eligible) and all(s.coverage == 'accounted_source_records' for s in sources)
                         and not any(i.code in ('unresolved_sources', 'discovery_incomplete', 'source_limit') for i in assembler.issues))
        complete = MenuCompleteness(status='accounted_source_records' if all_accounted else 'partial' if assembler.items else 'unknown',
            requested_sources=len(candidates), parsed_sources=sum(s.status in ('parsed', 'partial') for s in sources),
            recognized_items=sum(s.recognized_items for s in sources), extracted_items=len(assembler.items),
            reasons=['Coverage refers only to recognized records in the supplied source set. The restaurant’s entire menu and current availability are not established.',
                     'Identical duplicate records are counted once in the menu, with every source reference retained.'])
        categories = list(assembler.categories.values())
        version_input = json.dumps([PARSER_VERSION, request.restaurant.place_id,
            [(s.source_url, s.source_hash, s.status) for s in sources], [c.model_dump(mode='json') for c in categories]], sort_keys=True)
        menu = ExtractedRestaurantMenu(version=identifier('menu', version_input), restaurant_id=request.restaurant.place_id,
            restaurant=request.restaurant, categories=categories, total_items=len(assembler.items), sources=sources,
            evidence=list(assembler.evidence.values()), completeness=complete, issues=assembler.issues, extracted_at=self.now(), parser_version=PARSER_VERSION)
        status = 'unavailable' if not menu.total_items else 'needs_review' if not all_accounted or any(i.severity != 'notice' for i in menu.issues) else 'extracted'
        return MenuExtractionResult(request_id=request.request_id, restaurant_id=request.restaurant.place_id, status=status,
            vision_status=vision_status, menu=menu, requests_made=self.fetcher.requests)

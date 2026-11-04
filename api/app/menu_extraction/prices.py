"""Literal monetary transcription. No exchange rates, cheapest-variant guess or float arithmetic."""
from decimal import Decimal, InvalidOperation
import re
from .models import ExtractedPrice, ExtractedPriceOption

EXPONENTS = {"USD": 2, "CAD": 2, "AUD": 2, "EUR": 2, "GBP": 2, "CHF": 2, "INR": 2,
             "JPY": 0, "KRW": 0, "KWD": 3, "BHD": 3}
CODE = r"USD|CAD|AUD|EUR|GBP|JPY|KRW|INR|CHF|KWD|BHD"
TOKEN = re.compile(rf"(?:(?P<currency>{CODE}|US\$|CA\$|C\$|A\$|[$€£¥])\s*)?(?P<number>\d+(?:[.,]\d+)*)(?:\s*(?P<suffix>{CODE}))?", re.I)
SYMBOLS = {"US$": "USD", "CA$": "CAD", "C$": "CAD", "A$": "AUD", "€": "EUR", "£": "GBP"}


def amount_minor(raw, currency):
    if currency not in EXPONENTS: return None
    exponent = EXPONENTS[currency]
    value = raw
    separators = [s for s in '.,' if s in raw]
    if len(separators) == 2:
        decimal = max(separators, key=raw.rfind)
        grouping = ',' if decimal == '.' else '.'
        integer, fraction = raw.rsplit(decimal, 1)
        if not 1 <= len(fraction) <= exponent or not re.fullmatch(rf"\d{{1,3}}(?:\{grouping}\d{{3}})+", integer): return None
        value = integer.replace(grouping, '') + '.' + fraction
    elif separators:
        separator = separators[0]
        parts = raw.split(separator)
        if len(parts) == 2 and 1 <= len(parts[1]) <= exponent:
            value = parts[0] + '.' + parts[1]
        elif re.fullmatch(rf"\d{{1,3}}(?:\{separator}\d{{3}})+", raw) and (exponent == 0 or len(parts) > 2):
            value = raw.replace(separator, '')
        else: return None
    try:
        amount = Decimal(value) * (10 ** exponent)
        return int(amount) if amount == amount.to_integral_value() and 0 <= amount <= 1_000_000_000 else None
    except InvalidOperation: return None


def parse_price(raw, currency, evidence_id, offers=()):
    currency = currency.upper() if isinstance(currency, str) else None
    if offers:
        options, limits = [], []
        if len(offers) > 20: limits.append('The source lists more price variants than this extraction supports.')
        for value, label, code in offers[:20]:
            parsed = parse_price(value, code, evidence_id)
            options.extend(option.model_copy(update={'label': label}) for option in parsed.options)
            limits.extend(parsed.limitations)
        kind = 'variants' if len(options) > 1 else 'fixed' if len(options) == 1 and not limits else 'ambiguous'
        return ExtractedPrice(kind=kind, raw=raw, options=options, budget_usable=kind == 'fixed' and not limits, limitations=list(dict.fromkeys(limits)))
    if not raw or re.search(r"\b(?:market price|m\.?p\.?|ask|seasonal price)\b", raw, re.I):
        return ExtractedPrice(kind='unknown', raw=raw, limitations=['No fixed menu price is established.'])
    if re.search(r"(?:^|\s)-\s*[$€£¥]?\s*\d|\d\s*%", raw):
        return ExtractedPrice(kind='ambiguous', raw=raw, limitations=['A negative value or percentage is not a verified dish price.'])
    matches = list(TOKEN.finditer(raw))
    if not matches or len(matches) > 20:
        return ExtractedPrice(kind='ambiguous', raw=raw, limitations=['The price format could not be transcribed reliably.'])
    options, limits = [], []
    stated_codes = {SYMBOLS.get((m['currency'] or m['suffix'] or '').upper(), (m['currency'] or m['suffix'] or '').upper()) for m in matches}
    stated_codes &= EXPONENTS.keys()
    if currency is None and len(stated_codes) == 1: currency = next(iter(stated_codes))
    previous = 0
    for match in matches:
        marker = (match['currency'] or match['suffix'] or '').upper()
        code = SYMBOLS.get(marker, marker if marker in EXPONENTS else currency)
        # A bare dollar/yen symbol is not enough to identify a currency.
        if marker == '$' and code not in ('USD', 'CAD', 'AUD'): code = None
        if marker == '¥' and code != 'JPY': code = None
        if match['currency'] and match['suffix'] and SYMBOLS.get(marker, marker) != match['suffix'].upper():
            code = None
        amount = amount_minor(match['number'], code)
        label = raw[previous:match.start()].strip(' |/;,:–-') or None
        previous = match.end()
        if label and re.search(r'\b(?:for|serves|pieces|portion|oz|grams)\b', label, re.I):
            amount, code = None, None
            limits.append('A quantity may be mixed with the price; it was not treated as another monetary amount.')
        if code is None: limits.append('Currency is not established; no minor-unit amount was assumed.')
        elif amount is None: limits.append('The decimal/grouping format is ambiguous for the stated currency.')
        elif amount == 0 or code in ('USD', 'CAD', 'AUD', 'EUR', 'GBP', 'CHF') and amount > 100000:
            limits.append('This unusually low or high listed price needs review before budget use.')
        options.append(ExtractedPriceOption(label=label, raw=match[0], amount_minor=amount, currency=code, evidence_id=evidence_id))
    remainder = raw[previous:].strip()
    if remainder and not re.fullmatch(r"(?:each|per dish|ea\.?)", remainder, re.I):
        limits.append('The price has a qualifier or unit that needs review.')
    between = raw[matches[0].end():matches[1].start()].strip() if len(matches) == 2 else ''
    kind = 'range' if between in ('-', '–', 'to') else 'variants' if len(options) > 1 else 'fixed'
    if kind == 'range' and all(o.amount_minor is not None for o in options) and options[0].currency == options[1].currency and options[0].amount_minor > options[1].amount_minor:
        limits.append('The printed range endpoints are reversed and require review.')
    if re.search(r"\b(?:from|starting|add|supplement|per person|per kg|per lb)\b", raw, re.I):
        limits.append('A starting price, supplement or unit price is not a fixed per-dish amount.')
    if limits: kind = 'ambiguous'
    return ExtractedPrice(kind=kind, raw=raw, options=options, budget_usable=kind == 'fixed' and not limits, limitations=list(dict.fromkeys(limits)))

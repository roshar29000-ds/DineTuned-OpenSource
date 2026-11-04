from dataclasses import dataclass, field
import re


def clean(value):
    return " ".join(str(value).split())


@dataclass(frozen=True)
class Block:
    locator: str
    text: str
    method: str
    page: int | None = None


@dataclass
class RawItem:
    name: str
    description: str
    category: str
    block: Block
    category_block: Block | None
    price_text: str | None = None
    currency: str | None = None
    # Structured offers retain exact source values and labels.
    offers: list[tuple[str, str | None, str | None]] = field(default_factory=list)
    unavailable: bool = False
    currency_block: Block | None = None
    context_blocks: list[Block] = field(default_factory=list)


@dataclass
class ParsedDocument:
    items: list[RawItem] = field(default_factory=list)
    sections: list[str] = field(default_factory=list)
    issues: list[tuple[str, str]] = field(default_factory=list)
    recognized: int = 0
    page_count: int = 1
    parsed_pages: list[int] = field(default_factory=list)
    accounted: bool = False
    needs_vision: bool = False
    identity_text: str = ''


def currency_context(text):
    declarations = re.findall(r"(?:all\s+)?prices?\s+(?:are\s+)?(?:listed\s+)?in\s+([^.!\n]{1,80})", text, re.I)
    matches = [code for line in declarations for code in re.findall(r'\b(?:USD|CAD|AUD|EUR|GBP|JPY|KRW|INR|CHF|KWD|BHD)\b', line, re.I)]
    return matches[0].upper() if len(set(m.upper() for m in matches)) == 1 else None


def split_priced_name(text):
    """Split a terminal printed price, not numbers in a dish's name or description."""
    text = clean(text)
    marker = re.search(r"\s+(?=(?:USD|CAD|AUD|EUR|GBP|JPY|KRW|INR|CHF|KWD|BHD|US\$|CA\$|A\$|[$€£¥])\s*\d)", text)
    if marker:
        return text[:marker.start()].rstrip(' .·…'), text[marker.end():]
    numeric = re.search(r"\s+((?:\d+(?:[.,]\d+)*)(?:\s*[/–-]\s*\d+(?:[.,]\d+)*)?)$", text)
    if numeric and re.search(r"[^\W\d_]", text[:numeric.start()]):
        return text[:numeric.start()].rstrip(' .·…'), numeric[1]
    market = re.search(r"\s+(M\.?P\.?|market price)$", text, re.I)
    if market: return text[:market.start()].rstrip(' .·…'), market[1]
    return None

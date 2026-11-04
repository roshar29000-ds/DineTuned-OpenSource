"""Text-PDF extraction with page/line evidence and conservative layout handling."""
import json
import os
from pathlib import Path
import re
import statistics
import subprocess
import sys
from .parsing import Block, RawItem, ParsedDocument, clean, currency_context, split_priced_name


def read_pdf(data):
    try:
        result = subprocess.run([sys.executable, '-m', 'app.menu_extraction.pdf_worker'], input=data,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=7, check=False,
            cwd=Path(__file__).resolve().parents[2],
            env={'PATH': os.defpath, 'PYTHONIOENCODING': 'utf-8', 'PYTHONNOUSERSITE': '1'})
        if result.returncode or len(result.stdout) > 800_000: return None
        return json.loads(result.stdout)['pages']
    except (subprocess.TimeoutExpired, OSError, ValueError, KeyError):
        return None


def columns(lines, issues):
    starts = []
    for line in lines:
        segments = list(re.finditer(r'\S(?:.*?\S)?(?=\s{4,}|$)', line))
        priced = [part for part in segments if split_priced_name(part[0])]
        if len(priced) >= 2: starts.append(priced[1].start())
    if len(starts) < 2: return [[(i + 1, line) for i, line in enumerate(lines)]]
    cut = int(statistics.median(starts))
    if max(starts) - min(starts) > 6:
        issues.append(('pdf_columns', 'Column alignment is ambiguous; this page requires layout review.'))
        return []
    left, right = [], []
    for i, line in enumerate(lines):
        if len(line) > cut and line[cut - 1].strip() and line[cut].strip():
            issues.append(('pdf_columns', 'A line crosses the detected column boundary and was not assigned to a dish.'))
            continue
        left.append((i + 1, line[:cut].rstrip()))
        right.append((i + 1, line[cut:].strip()))
    return [left, right]


def extract_pdf(data, restaurant_name='', source_title='', reader=read_pdf):
    result = ParsedDocument()
    pages = reader(data)
    if pages is None:
        result.page_count = 0
        result.issues.append(('pdf_unreadable', 'The PDF is malformed, encrypted, too large, or exceeded a parser resource limit.'))
        return result
    result.page_count = len(pages)
    result.identity_text = '\n'.join(p['text'] for p in pages)
    currency = currency_context(' '.join(p['text'] for p in pages))
    currency_block = next((Block(f'page:{p["number"]}/line:{i+1}', clean(line), 'pdf_text', p['number'])
        for p in pages for i, line in enumerate(p['text'].splitlines()) if currency and currency_context(line) == currency), None)
    previous_category, previous_heading = '', None
    for page in pages:
        number, page_text = page['number'], page['text']
        if not page_text.strip():
            result.needs_vision = True
            result.issues.append(('scanned_page', f'Page {number} has no usable text layer; approved vision extraction is required.'))
            continue
        result.parsed_pages.append(number)
        for col, lines in enumerate(columns(page_text.splitlines(), result.issues), 1):
            category, heading = previous_category, previous_heading
            pending = None
            for line_number, original in lines:
                line = clean(original)
                if not line: continue
                location = f'page:{number}/line:{line_number}/column:{col}'
                if line.casefold() in {restaurant_name.casefold(), source_title.casefold()} or re.fullmatch(r'(?:page\s+)?\d+(?:\s+(?:of|/)\s+\d+)?', line, re.I): continue
                if (currency_context(line) or re.search(r'^(?:all prices|tax|gratuity|please (?:ask|inform)|allerg|https?://|www\.)', line, re.I)
                    or re.search(r'^\d+\s+.*\b(?:street|st|road|rd|avenue|ave)\b', line, re.I)):
                    pending = None
                    continue
                split = split_priced_name(line)
                if split:
                    # Multiple named price groups on an unresolved line must not be
                    # merged into one invented dish/variant.
                    if len(re.findall(r'(?:USD|EUR|GBP|[$€£])\s*\d', split[1])) > 1 and re.search(r'\d\s{4,}\S', original):
                        result.issues.append(('pdf_columns', 'Multiple price groups could not be assigned to independent columns.'))
                        pending = None
                        continue
                    pending = RawItem(split[0], '', category, Block(location, line, 'pdf_text', number), heading, split[1], currency, currency_block=currency_block)
                    result.items.append(pending); result.recognized += 1
                elif line in page.get('headings', []) or (line.isupper() and len(line) < 80 and len(line.split()) <= 8):
                    category, heading = line, Block(location, line, 'pdf_text', number)
                    result.sections.append(category); pending = None
                elif line in page.get('bold', []) and category:
                    pending = RawItem(line, '', category, Block(location, line, 'pdf_text', number), heading, None, currency, currency_block=currency_block)
                    result.items.append(pending); result.recognized += 1
                elif pending is not None and len(line) <= 500:
                    pending.description = clean(pending.description + ' ' + line)
                    pending.block = Block(pending.block.locator, pending.block.text + '\n' + line, 'pdf_text', number)
                else:
                    result.issues.append(('unassigned_pdf_text', f'Page {number} has unassigned text at line {line_number}; completeness is unverified.'))
            previous_category, previous_heading = category, heading
    for section in dict.fromkeys(result.sections):
        if not any(item.category == section for item in result.items):
            result.issues.append(('empty_section', f'No readable dishes were assigned to PDF section: {section}.'))
    # PDF reading order/layout interpretation always needs review in this first
    # implementation, even when every printed line has a proposed assignment.
    if result.items: result.issues.append(('pdf_layout_review', 'Text and prices are transcribed with page references; PDF reading order and category boundaries still need review.'))
    return result

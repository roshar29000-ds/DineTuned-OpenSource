"""Bounded semantic/menu-layout readers. Unknown layouts remain reviewable gaps."""
import json
import re
from bs4 import BeautifulSoup, Tag
from .parsing import Block, RawItem, ParsedDocument, clean, currency_context, split_priced_name

ROW = re.compile(r"^(?:menu[-_]{0,2}item|dish|food[-_]item)(?:$|[-_](?:row|card)$)", re.I)
NAME = '[itemprop="name"], .menu-item-name, .menu-item-title, .menu-item__name, .menu-item__title, .dish-name, .item-name, h3, h4, h5, dt, strong'
DESCRIPTION = '[itemprop="description"], .description, .desc, [class*="description"]'
PRICE = '[itemprop="price"], [class*="price"]'


def locator(node):
    parts = []
    while isinstance(node, Tag) and node.name != '[document]' and len(parts) < 14:
        siblings = [s for s in node.previous_siblings if isinstance(s, Tag) and s.name == node.name]
        parts.append(f'{node.name}:nth-of-type({len(siblings) + 1})')
        node = node.parent
    return ' > '.join(reversed(parts))


def text(node):
    return clean(node.get_text(' ', strip=True)) if node else ''


def block(node):
    return Block(locator(node), text(node), 'html')


def structured(value, result, path, currency=None, category='', category_block=None, depth=0, currency_block=None):
    if depth > 16 or len(result.items) >= 600:
        result.issues.append(('structure_limit', 'Structured menu nesting or item limits were reached.'))
        return
    if isinstance(value, list):
        if len(value) > 650: result.issues.append(('structure_limit', 'A structured list exceeds this extraction limit.'))
        for index, child in enumerate(value[:650]):
            structured(child, result, f'{path}/{index}', currency, category, category_block, depth + 1, currency_block)
        return
    if not isinstance(value, dict): return
    types = value.get('@type', [])
    if isinstance(types, str): types = [types]
    currency = value.get('priceCurrency', currency)
    if not isinstance(currency, str): currency = None
    if isinstance(value.get('priceCurrency'), str):
        currency_block = Block(path + '/priceCurrency', value['priceCurrency'], 'json_ld')
    if 'MenuSection' in types and isinstance(value.get('name'), str):
        category = clean(value['name'])
        category_block = Block(path + '/name', category, 'json_ld')
        result.sections.append(category)
        if not value.get('hasMenuItem') and not value.get('hasMenuSection'):
            result.issues.append(('empty_section', f'The source declares an empty or unreadable section: {category}.'))
    if 'MenuItem' in types:
        result.recognized += 1
        name, description = value.get('name'), value.get('description', '')
        if not isinstance(name, str) or not name.strip() or not isinstance(description, str):
            result.issues.append(('invalid_item', 'A structured menu item has no usable name/description.'))
            return
        offers = value.get('offers', [])
        if isinstance(offers, dict): offers = [offers]
        prices = []
        for offer in offers if isinstance(offers, list) else []:
            if not isinstance(offer, dict): continue
            price = offer.get('price')
            if isinstance(price, (str, int, float)) and not isinstance(price, bool):
                label = offer.get('name') if isinstance(offer.get('name'), str) else None
                code = offer.get('priceCurrency', currency)
                prices.append((str(price), label, code if isinstance(code, str) else None))
            elif any(key in offer for key in ('lowPrice', 'highPrice', 'priceSpecification')):
                result.issues.append(('unsupported_offer', 'A structured aggregate/unit price needs review; no fixed price was assumed.'))
        if not prices and isinstance(value.get('price'), (str, int, float)) and not isinstance(value.get('price'), bool):
            prices.append((str(value['price']), None, currency))
        evidence = Block(path, json.dumps(value, ensure_ascii=False, separators=(',', ':')), 'json_ld')
        # One sold-out size does not establish that every version of the dish is
        # unavailable. Unknown or mixed offers retain unverified availability.
        unavailable = isinstance(offers, list) and bool(offers) and all(
            isinstance(o, dict) and str(o.get('availability', '')).endswith(('OutOfStock', 'SoldOut', 'Discontinued'))
            for o in offers)
        result.items.append(RawItem(clean(name), clean(description), category, evidence, category_block,
                                   ' | '.join(p[0] for p in prices) or None, currency, prices, unavailable, currency_block))
        return
    declared = value.get('numberOfItems')
    before = result.recognized
    for key in ('@graph', 'mainEntity', 'hasMenu', 'menu', 'hasMenuSection', 'hasMenuItem', 'itemListElement'):
        if key in value:
            structured(value[key], result, path + '/' + key, currency, category, category_block, depth + 1, currency_block)
    if declared is not None and str(declared).isdigit() and int(declared) != result.recognized - before:
        result.issues.append(('declared_count_mismatch', 'The source-declared item count differs from its readable menu records.'))


def category_for(node):
    # Local section heading wins over unrelated preceding navigation headings.
    section = node.find_parent(['section', 'article'])
    heading = section.find(['h2']) if section else None
    if heading is None: heading = node.find_previous('h2')
    if node.name == 'tr':
        table = node.find_parent('table')
        caption = table.find('caption') if table else None
        if caption: heading = caption
    return (text(heading), block(heading)) if heading else ('', None)


def table_item(row, currency, category, heading):
    cells = row.find_all('td', recursive=False)
    if not cells: return None
    name = text(cells[0])
    table = row.find_parent('table')
    headers = [text(h) for h in table.find_all('th')][:len(cells)]
    descriptions, offers = [], []
    for index, cell in enumerate(cells[1:], 1):
        value = text(cell)
        if re.fullmatch(r'(?:(?:[A-Z]{3}|US\$|CA\$|A\$|[$€£¥])\s*)?\d+(?:[.,]\d+)*(?:\s*[A-Z]{3})?', value) or re.fullmatch(r'M\.?P\.?|market price', value, re.I):
            label = headers[index] if len(headers) == len(cells) and headers[index].lower() not in ('price', 'cost') else None
            offers.append((value, label, currency))
        elif value: descriptions.append(value)
    header_row = table.find('tr')
    return RawItem(name, ' '.join(descriptions), category, block(row), heading,
                   ' | '.join(p[0] for p in offers) or None, currency, offers,
                   context_blocks=[block(header_row)] if header_row and header_row.find('th') else [])


def card_item(node, currency, category, heading):
    name_node = node.select_one(NAME)
    if name_node is None: return None
    name = text(name_node)
    prices = node.select(PRICE)
    prices = [p for p in prices if not any(parent in prices for parent in p.parents)]
    price_text = ' / '.join(text(p) for p in prices if text(p)) or None
    for price in prices:
        if name_node in price.parents: name = name.replace(text(price), '').strip()
    split = split_priced_name(name)
    if split: name, price_text = split[0], price_text or split[1]
    descriptions = node.select(DESCRIPTION)
    if not descriptions:
        descriptions = [p for p in node.find_all('p') if p not in prices and not p.select(PRICE) and name_node not in [p, *p.descendants]]
    description = ' '.join(text(p) for p in descriptions if text(p) and not any(parent in descriptions for parent in p.parents))
    if not price_text:
        split = split_priced_name(text(node))
        if split and split[0].startswith(name):
            price_text = split[1]
            if not description: description = split[0][len(name):].strip(' –—-:')
    return RawItem(name, description, category, block(node), heading, price_text, currency)


def extract_html(body):
    result = ParsedDocument()
    soup = BeautifulSoup(body, 'html.parser')
    if len(soup.find_all(True)) > 15000:
        result.issues.append(('html_limit', 'This page exceeds the supported DOM size.'))
        return result
    for index, script in enumerate(soup.select('script[type="application/ld+json"]')):
        try: structured(json.loads(script.string or script.get_text()), result, f'jsonld[{index}]')
        except (ValueError, RecursionError, TypeError):
            result.issues.append(('malformed_structured_data', 'A menu structured-data block could not be read.'))
    for node in soup.select('script, style, nav, footer, header, aside, template, noscript, [hidden], [aria-hidden="true"]'):
        node.decompose()
    for node in soup.select('[style]'):
        if re.search(r'display\s*:\s*none|visibility\s*:\s*hidden', node.get('style', ''), re.I): node.decompose()
    for node in soup.select('img, object, iframe, embed, canvas'):
        references = ' '.join(str(node.get(key, '')) for key in ('src', 'data', 'alt', 'title'))
        if node.name in ('iframe', 'embed', 'canvas') or re.search(r'menu|\.pdf\b', references, re.I):
            result.issues.append(('embedded_menu', 'Embedded/image menu content is not covered by the HTML text extraction.'))
    if soup.select('[data-next-page], [aria-busy="true"]') or any(re.search(r'load more|show more', text(n), re.I) for n in soup.select('button')):
        result.issues.append(('dynamic_content', 'The page indicates additional dynamic content; source coverage is partial.'))
    currency = currency_context(text(soup))
    currency_node = next((n for n in soup.select('p,small,caption') if currency and currency_context(text(n)) == currency), None)
    rows = [node for node in soup.find_all(['div', 'li', 'article', 'section', 'dl'])
            if node.has_attr('data-menu-item') or str(node.get('itemtype', '')).endswith('/MenuItem')
            or any(ROW.match(c) for c in node.get('class', []))]
    rows += [row for row in soup.select('table tr') if row.find('td')]
    row_ids = {id(row) for row in rows}
    # Common heading/description/price blocks without a framework-specific class.
    for heading in soup.select('h3, h4, h5'):
        parent = heading.parent
        if id(parent) not in row_ids and len(parent.select('h3,h4,h5')) == 1 and (parent.select(PRICE) or split_priced_name(text(heading))):
            rows.append(parent)
            row_ids.add(id(parent))
    rows = [node for node in rows if not any(id(parent) in row_ids for parent in node.parents)]
    positions = {id(node): index for index, node in enumerate(soup.descendants)}
    rows.sort(key=lambda node: positions[id(node)])
    handled = set()
    for node in rows[:600]:
        result.recognized += 1
        category, heading = category_for(node)
        if category: result.sections.append(category)
        item = table_item(node, currency, category, heading) if node.name == 'tr' else card_item(node, currency, category, heading)
        if not item or not item.name:
            result.issues.append(('unreadable_item', 'A recognized menu block lacks a reliable dish name.'))
        else:
            item.currency_block = block(currency_node) if currency_node else None
            result.items.append(item)
        handled.update(id(element) for element in [node, *node.descendants])
    if len(rows) > 600: result.issues.append(('item_limit', 'The menu exceeds this extraction item limit.'))
    # Flat printed lists: each priced line is retained, but lower-confidence layout
    # inference cannot establish whole-source completeness.
    for node in soup.select('p, li, dt'):
        if id(node) in handled or any(id(child) in handled for child in node.descendants): continue
        split = split_priced_name(text(node))
        if not split: continue
        result.recognized += 1
        category, heading = category_for(node)
        if category: result.sections.append(category)
        strong = node.find(['strong', 'b'])
        name = text(strong) if strong else split[0]
        description = split[0][len(name):].strip(' :–—-') if strong and split[0].startswith(name) else ''
        result.items.append(RawItem(name, description, category, block(node), heading, split[1], currency,
                                   currency_block=block(currency_node) if currency_node else None))
        result.issues.append(('flat_layout', 'Printed menu lines were transcribed; their boundaries require review.'))
    # Empty explicit menu sections are not silently discarded.
    for section in soup.select('section'):
        heading = section.find('h2')
        if heading and ('menu' in ' '.join(section.get('class', [])) or section.has_attr('data-menu-section')):
            label = text(heading)
            result.sections.append(label)
            if not any(item.category == label for item in result.items):
                result.issues.append(('empty_section', f'No readable items in the declared section: {label}.'))
    result.accounted = bool(result.items) and not result.issues and result.recognized == len(result.items)
    if not result.items: result.issues.append(('no_items', 'No supported menu records were found; JavaScript/image content may need another extraction path.'))
    return result

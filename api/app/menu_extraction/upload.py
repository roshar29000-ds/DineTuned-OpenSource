"""Bounded local-document extraction. No website, Google, or model transport."""
import base64
import binascii
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import PurePath
import re

from ..discovery.config import DiscoveryError
from ..menu_sources.fetch import Resource
from ..menu_sources.models import MenuSourceCandidate, MenuSourceEvidence
from ..menu_sources.pages import branch_evidence, contains, parse_page
from ..menu_sources.urls import SourceBlocked
from .html import extract_html
from .pdf import extract_pdf
from .models import ExtractedSource, ExtractedRestaurantMenu, MenuCompleteness, MenuExtractionResult
from .parsing import ParsedDocument
from .pipeline import PARSER_VERSION
from .validation import MenuAssembler, identifier

MAX_UPLOAD_BYTES = 3_000_000


def decode_document(filename: str, encoded: str):
    name = PurePath(filename.replace('\\', '/')).name.strip()
    if not name or len(name) > 180 or any(ord(char) < 32 for char in name):
        raise DiscoveryError(422, 'Choose a file with a valid name.')
    try:
        body = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise DiscoveryError(422, 'The menu file could not be decoded.') from None
    if not body or len(body) > MAX_UPLOAD_BYTES:
        raise DiscoveryError(413, 'Choose a menu file up to 3 MB.')
    extension = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
    if extension == 'pdf' and body.startswith(b'%PDF-'):
        return name, body, 'pdf'
    if extension in ('html', 'htm') and (b'<html' in body[:1024].lower() or b'<!doctype html' in body[:1024].lower()):
        return name, body, 'html'
    if extension == 'png' and body.startswith(b'\x89PNG\r\n\x1a\n'):
        return name, body, 'image'
    if extension in ('jpg', 'jpeg') and body.startswith(b'\xff\xd8\xff'):
        return name, body, 'image'
    if extension == 'webp' and body.startswith(b'RIFF') and body[8:12] == b'WEBP':
        return name, body, 'image'
    raise DiscoveryError(422, 'Supported files are text-based PDF, HTML, PNG, JPEG, and WebP with matching file content.')


def conflicting_pdf_address(parsed, restaurant):
    street = (restaurant.formatted_address or '').split(',')[0]
    addresses = re.findall(r'^\s*\d{1,6}\s+[^\n]{0,100}\b(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd)\b[^\n]*',
                           parsed.identity_text, re.I | re.M)
    if addresses and (not street or any(not contains(address, street) for address in addresses)):
        raise DiscoveryError(409, 'This uploaded PDF names a different street address. No menu was accepted for this branch.')
    postal = re.search(r'\b\d{5}(?:-\d{4})?\b', restaurant.formatted_address or '')
    if postal and any(re.search(r'\b\d{5}(?:-\d{4})?\b', address) and postal[0] not in address for address in addresses):
        raise DiscoveryError(409, 'This uploaded PDF names a different postal address. No menu was accepted for this branch.')


def extract_uploaded_menu(request):
    name, body, kind = decode_document(request.filename, request.content_base64)
    now = datetime.now(timezone.utc)
    digest = sha256(body).hexdigest()
    source_url = f'urn:dinetuned:upload:{digest}'
    candidate = MenuSourceCandidate(id=identifier('candidate', source_url), source_url=source_url,
        discovered_from=source_url, title=name, format=kind, menu_type='unknown', branch_relevance='unknown',
        provenance='user_upload', confidence='low', freshness='undated', access='checked',
        discovered_at=now, evidence=[MenuSourceEvidence(kind='access', source_url=source_url,
            detail='The user supplied this file. Its official origin, current availability and branch association are unverified.')],
        limitations=['User-supplied document; not verified as the restaurant’s official or current menu.',
                     'Confirm the branch, prices, ingredients and availability with restaurant staff.'],
        suitable_for_extraction=True)
    source = ExtractedSource(id=identifier('src', source_url), candidate=candidate, source_url=source_url,
        source_hash=digest, retrieved_at=now, status='failed')
    assembler = MenuAssembler(request.restaurant.place_id)
    assembler.issue('user_upload_unverified', 'This is a user-supplied document. Its official origin, branch association, and freshness are unverified.', source.id)
    if kind == 'image':
        parsed = ParsedDocument(page_count=1, needs_vision=True)
    elif kind == 'pdf':
        try:
            parsed = extract_pdf(body, request.restaurant.display_name, name)
        except (ValueError, TypeError, RecursionError, OverflowError):
            raise DiscoveryError(422, 'This PDF could not be parsed safely. No dishes were accepted.') from None
        conflicting_pdf_address(parsed, request.restaurant)
    else:
        try:
            page = parse_page(Resource(source_url, 200, 'text/html', body, {}))
            branch, _, _ = branch_evidence(page, request.restaurant)
            if branch == 'other_branch':
                raise DiscoveryError(409, 'This uploaded HTML names a different restaurant or branch. No menu was accepted.')
            parsed = extract_html(body)
        except SourceBlocked:
            raise DiscoveryError(422, 'This HTML restricts processing or could not be parsed safely.') from None
        except (ValueError, TypeError, RecursionError, OverflowError):
            raise DiscoveryError(422, 'This HTML could not be parsed safely. No dishes were accepted.') from None
    source.page_count, source.parsed_pages, source.recognized_items = parsed.page_count, parsed.parsed_pages, parsed.recognized
    if parsed.needs_vision:
        assembler.issue('vision_required', 'Scanned pages and images need separately approved vision extraction. No model was called.', source.id)
    for code, message in parsed.issues:
        assembler.issue(code, message, source.id)
    for raw in parsed.items:
        if assembler.add(raw, source): source.extracted_items += 1
    source.unresolved_sections = list(dict.fromkeys(s for s in parsed.sections if not any(i.category == s for i in parsed.items)))
    accounted = parsed.accounted and source.extracted_items == source.recognized_items and not source.unresolved_sections
    source.coverage = 'accounted_source_records' if accounted else 'partial' if source.extracted_items else 'unknown'
    source.status = ('parsed' if accounted else 'partial') if source.extracted_items else 'needs_vision' if parsed.needs_vision else 'failed'
    if not source.extracted_items:
        assembler.issue('no_extracted_items', 'No validated dish records were recovered from this uploaded document.', source.id)
    categories = list(assembler.categories.values())
    version_input = json.dumps([PARSER_VERSION, request.restaurant.place_id, digest,
        [category.model_dump(mode='json') for category in categories]], sort_keys=True)
    completeness = MenuCompleteness(status='partial' if assembler.items else 'unknown',
        requested_sources=1, parsed_sources=int(source.status in ('parsed', 'partial')),
        recognized_items=source.recognized_items, extracted_items=len(assembler.items),
        reasons=['Only records recovered from the uploaded file are shown; the restaurant’s complete or current menu is unverified.',
                 'The document’s association with the selected branch was supplied by the user, not independently confirmed.'])
    menu = ExtractedRestaurantMenu(version=identifier('menu', version_input), restaurant_id=request.restaurant.place_id,
        restaurant=request.restaurant, categories=categories, total_items=len(assembler.items), sources=[source],
        evidence=list(assembler.evidence.values()), completeness=completeness, issues=assembler.issues,
        extracted_at=now, parser_version=PARSER_VERSION)
    return MenuExtractionResult(request_id=request.request_id, restaurant_id=request.restaurant.place_id,
        status='needs_review' if menu.total_items else 'unavailable', vision_status='unavailable' if parsed.needs_vision else 'not_needed',
        menu=menu, requests_made=0)

"""Read navigation and identity evidence, never execute JavaScript or extract dishes."""
from dataclasses import dataclass, field
from html.parser import HTMLParser
import json
import re
import unicodedata
from urllib.parse import urljoin, urlsplit
from .urls import source_url, SourceBlocked


def normal(text):
    value = "".join(c for c in unicodedata.normalize("NFKD", text.casefold().replace("&", " and ")) if not unicodedata.combining(c))
    words = re.findall(r"[a-z0-9]+", value)
    substitutions = {"st": "street", "rd": "road", "ave": "avenue", "blvd": "boulevard", "n": "north", "s": "south", "e": "east", "w": "west"}
    return " ".join(substitutions.get(w, w) for w in words)


def contains(text, phrase):
    return bool(phrase) and " " + normal(phrase) + " " in " " + normal(text) + " "


@dataclass
class Link:
    url: str
    label: str
    branch: str = "unknown"
    evidence: str = "Linked from the supplied website."
    discovered_from: str | None = None


@dataclass
class Page:
    url: str
    title: str = ""
    headings: list[str] = field(default_factory=list)
    addresses: list[str] = field(default_factory=list)
    text: str = ""
    links: list[Link] = field(default_factory=list)
    entities: list[dict] = field(default_factory=list)
    nofollow: bool = False
    restricted: bool = False


class PageParser(HTMLParser):
    def __init__(self, url):
        super().__init__(convert_charrefs=True)
        self.page = Page(url)
        self.capture = None
        self.buffer = []
        self.href = None
        self.skip = 0
        self.script = False
        self.tokens = 0

    def handle_starttag(self, tag, attrs):
        self.tokens += 1
        if self.tokens > 15000: raise SourceBlocked("This page is too complex for bounded source discovery.")
        attrs = dict(attrs)
        if tag in ("script", "style"):
            self.skip += 1
            self.script = tag == "script" and attrs.get("type", "").lower() == "application/ld+json"
            if self.script: self.buffer = []
            return
        if self.skip: return
        if tag == "meta" and attrs.get("name", "").lower() in ("robots", "dinetunedmenudiscovery"):
            content = attrs.get("content", "").lower()
            self.page.nofollow |= "nofollow" in content or "none" in content
            self.page.restricted |= "noai" in content
        if tag in ("title", "h1", "h2", "h3", "address", "a") and self.capture is None:
            self.capture, self.buffer = tag, []
            self.href = attrs.get("href") if tag == "a" and "nofollow" not in (attrs.get("rel") or "").lower() else None

    def handle_data(self, data):
        if self.skip:
            if self.script and sum(map(len, self.buffer)) < 100000: self.buffer.append(data)
            return
        if len(self.page.text) < 60000: self.page.text += " " + data[:2000]
        if self.capture: self.buffer.append(data[:2000])

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.skip:
            if self.script:
                try: self._entities(json.loads("".join(self.buffer)))
                except (ValueError, RecursionError): pass
            self.skip -= 1; self.script = False; self.buffer = []
            return
        if self.skip or tag != self.capture: return
        text = " ".join(" ".join(self.buffer).split())[:1000]
        if tag == "title": self.page.title = text
        elif tag == "address": self.page.addresses.append(text)
        elif tag.startswith("h"): self.page.headings.append(text)
        elif tag == "a" and self.href and len(self.page.links) < 200:
            try: self.page.links.append(Link(source_url(urljoin(self.page.url, self.href)), text[:180], discovered_from=self.page.url))
            except SourceBlocked: pass
        self.capture, self.buffer, self.href = None, [], None

    def _entities(self, value, depth=0):
        if depth > 8 or len(self.page.entities) >= 60: return
        if isinstance(value, list):
            for item in value[:60]: self._entities(item, depth + 1)
        elif isinstance(value, dict):
            types = value.get("@type", [])
            if isinstance(types, str): types = [types]
            if not isinstance(types, list): types = []
            if any(t in ("Restaurant", "LocalBusiness", "CafeOrCoffeeShop", "FoodEstablishment", "Bakery", "BarOrPub") for t in types):
                self.page.entities.append(value)
            for key in ("@graph", "mainEntity", "department", "subOrganization", "hasMenu"):
                if key in value: self._entities(value[key], depth + 1)


def parse_page(resource):
    parser = PageParser(resource.url)
    parser.feed(resource.body.decode("utf-8", errors="replace"))
    page = parser.page
    page.nofollow |= "nofollow" in resource.headers.get("x-robots-tag", "").lower()
    if page.restricted or re.search(r"(?:verify you are human|just a moment|access denied|captcha)", page.title, re.I):
        raise SourceBlocked("This page restricts automated access or AI use. No challenge was bypassed.")
    return page


def branch_evidence(page, restaurant):
    """Match a name and full street + locality/postcode within the same entity.

    A group site's footer listing many branches is deliberately not an exact match.
    """
    expected = restaurant.formatted_address or ""
    if not expected or not re.search(r"\d", expected):
        return "unknown", "The selected restaurant has no usable street address for a branch comparison.", []
    exact, other, foreign = [], [], []
    scoped = []
    for entity in page.entities:
        if not isinstance(entity.get("name"), str): continue
        address = entity.get("address")
        if not isinstance(address, dict): continue
        street = address.get("streetAddress", "")
        if not contains(entity["name"], restaurant.display_name):
            if isinstance(street, str) and re.search(r"\d", street):
                foreign.append("The page's structured restaurant identity names a different business and address.")
            continue
        locality = address.get("addressLocality", "")
        postal = address.get("postalCode", "")
        location_parts = [x for x in (locality, postal) if isinstance(x, str) and x]
        matched = isinstance(street, str) and bool(re.search(r"\d", street)) and contains(expected, street) and bool(location_parts) and all(contains(expected, x) for x in location_parts)
        conflict = isinstance(street, str) and bool(re.search(r"\d", street)) and (not contains(expected, street) or any(not contains(expected, x) for x in location_parts))
        scope = "exact" if matched else "other_branch" if conflict else "unknown"
        evidence = f"Website lists {entity['name']}: {street}, {locality}, {postal}."[:500]
        if matched: exact.append(evidence)
        elif conflict: other.append(evidence)
        menus = entity.get("hasMenu", entity.get("menu", []))
        if not isinstance(menus, list): menus = [menus]
        for menu in menus[:20]:
            url = menu if isinstance(menu, str) else menu.get("url", menu.get("@id")) if isinstance(menu, dict) else None
            if isinstance(url, str) and not page.nofollow:
                try: scoped.append(Link(source_url(urljoin(page.url, url)), "Restaurant menu", scope, evidence, page.url))
                except SourceBlocked: pass
    if exact:
        return ("exact" if not other and len(exact) == 1 else "site_wide"), exact[0], scoped
    if other:
        return "other_branch", other[0], scoped
    if foreign:
        return "other_branch", foreign[0], scoped
    name_present = any(contains(t, restaurant.display_name) for t in [page.title, *page.headings])
    # For ordinary HTML require a single address block containing the expected
    # street and locality, not merely a city somewhere in the page.
    parts = [part.strip() for part in expected.split(",") if part.strip()]
    if name_present and len(page.addresses) == 1 and len(parts) >= 2 and re.search(r"\d", parts[0]):
        if contains(page.addresses[0], parts[0]) and contains(page.addresses[0], parts[1]):
            return "exact", f"Page heading names {restaurant.display_name}; address block lists {page.addresses[0]}."[:500], scoped
        if re.search(r"\d", page.addresses[0]):
            return "other_branch", "This page's address block does not match the selected branch.", scoped
    if name_present and len(page.addresses) > 1:
        return "site_wide", "This page lists multiple addresses without linking this menu to the selected branch.", scoped
    # Many restaurant sites put their one visible postal address in an ordinary
    # footer div instead of an <address> element. Accept it only when the full
    # selected street, city and postcode occur together in visible page text,
    # and no second street address suggests a multi-location footer.
    if name_present and not page.addresses and len(parts) >= 2:
        visible = normal(page.text)
        street = normal(parts[0])
        city = normal(parts[1])
        postcode = re.search(r"\b\d{5}(?:-\d{4})?\b", expected)
        streets = set(re.findall(r"\b\d{1,6} (?:north |south |east |west )?[a-z0-9 ]{1,60} "
                                 r"(?:street|road|avenue|boulevard|drive|lane|court|place|parkway)\b", visible))
        if street in streets and len(streets) == 1 and postcode:
            start = visible.find(street)
            nearby = visible[start:start + 180]
            if contains(nearby, city) and contains(nearby, postcode.group()):
                return "exact", "Visible page text gives the selected street, city and postcode beside the restaurant name.", scoped
    return "unknown", "The page does not establish this restaurant's exact street address and locality.", scoped


def menu_kind(label, url):
    host = urlsplit(url).hostname or ""
    if any(host == h or host.endswith("." + h) for h in ("doordash.com", "ubereats.com", "grubhub.com", "deliveroo.com", "deliveroo.co.uk")):
        return "delivery"
    value = normal(label + " " + urlsplit(url).path)
    for kind, words in [("catering", r"\bcater(?:ing)?\b"), ("delivery", r"\bdelivery\b"), ("takeaway", r"\b(?:takeaway|takeout|pick up|order|ordering)\b")]:
        if re.search(words, value): return kind
    return "dine_in" if re.search(r"\b(?:dine in|dinner|lunch|brunch|breakfast|supper|a la carte)\b", value) else "unknown"


def menu_link(link):
    return bool(re.search(r"\b(?:menus?|dinner|lunch|brunch|breakfast|catering|delivery|takeout|takeaway)\b", normal(link.label + " " + urlsplit(link.url).path)))


def location_link(link, restaurant):
    text = normal(link.label + " " + urlsplit(link.url).path)
    if not re.search(r"\b(?:locations?|restaurants?|contact|visit)\b", text): return False
    return True

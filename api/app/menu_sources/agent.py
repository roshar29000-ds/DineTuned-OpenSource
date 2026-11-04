from collections import deque
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import PurePosixPath
import re
from typing import Protocol
from urllib.parse import urlsplit, unquote
from xml.etree import ElementTree
from .fetch import SourceFetcher
from .models import MenuSourceRequest, MenuSourceResult, MenuSourceCandidate, MenuSourceEvidence
from .pages import Link, parse_page, branch_evidence, menu_link, menu_kind, location_link, normal
from .urls import source_url, same_site, SourceBlocked


class MenuSourceDiscoveryProvider(Protocol):
    def discover(self, request: MenuSourceRequest) -> MenuSourceResult: ...


def format_of(resource):
    data, mime = resource.body, resource.content_type
    if data.startswith(b"%PDF-") and mime in ("application/pdf", "application/octet-stream"): return "pdf"
    if mime == "image/png" and data.startswith(b"\x89PNG\r\n\x1a\n"): return "image"
    if mime == "image/jpeg" and data.startswith(b"\xff\xd8\xff"): return "image"
    if mime == "image/webp" and data.startswith(b"RIFF") and data[8:12] == b"WEBP": return "image"
    if mime in ("text/html", "application/xhtml+xml") and b"<" in data[:200]: return "html"
    raise SourceBlocked("The source's format could not be verified as HTML, PDF or a supported image.")


def dated_menu(label, url, year):
    # A year in an upload directory or copyright footer is not a menu date.
    name = unquote(PurePosixPath(urlsplit(url).path).name)
    text = normal(label + " " + name)
    matches = re.findall(r"\b(20\d{2})\b", text) if re.search(r"\b(?:menu|dinner|lunch|brunch|breakfast|catering)\b", text) else []
    if not matches: return "undated", None
    newest = max(map(int, matches))
    return ("outdated" if newest < year else "dated"), str(newest)


class PublicWebsiteMenuDiscovery:
    """Bounded navigation discovery from a supplied official-website candidate.

    No search-engine scraping, guessed domains, browser execution or extraction.
    A site's self-published identity corroborates branch relevance, not ownership.
    """
    def __init__(self, fetcher: SourceFetcher, now=lambda: datetime.now(timezone.utc)):
        self.fetcher, self.now = fetcher, now

    def discover(self, request):
        seed = source_url(request.website_url)
        queue = deque([(Link(seed, "Restaurant website", evidence="Website URL supplied by the user.", discovered_from=seed), 0, False)])
        visited, candidates, issues = set(), {}, []
        checked_at = self.now()
        sitemap_attempted = False
        while queue and len(visited) < 8 and len(candidates) < 12:
            link, depth, parent_corroborated = queue.popleft()
            if link.url in visited or depth > 3: continue
            visited.add(link.url)
            is_menu = menu_link(link)
            if (menu_kind(link.label, link.url) in ("delivery", "takeaway", "catering") or link.branch == "other_branch") and is_menu:
                candidate = self._candidate(link, link.url, request, checked_at)
                candidate.limitations.append("This link refers to another branch or to delivery, takeaway or catering; it is not a corroborated dine-in source for this selection.")
                candidates[link.url] = candidate
                continue
            try:
                resource = self.fetcher.fetch(link.url)
                format_ = format_of(resource)
                page = parse_page(resource) if format_ == "html" else None
                branch, evidence, scoped = branch_evidence(page, request.restaurant) if page else ("unknown", link.evidence, [])
                branch_source = resource.url
                if page and branch == "unknown" and link.branch == "exact" and parent_corroborated:
                    branch, evidence = "exact", link.evidence
                    branch_source = link.discovered_from or link.url
                elif not page:
                    branch = link.branch
                    branch_source = link.discovered_from or link.url
                corroborated = parent_corroborated or branch == "exact"
                menu_heading = next((h for h in ([page.title] + page.headings) if menu_link(Link(resource.url, h))), "") if page else ""
                if page:
                    self_link = next((l.label for l in page.links if l.url == resource.url and menu_link(l)), "")
                    menu_heading = menu_heading or self_link
                if is_menu or menu_heading or format_ in ("pdf", "image"):
                    candidate = self._candidate(link, resource.url, request, checked_at)
                    candidate.title = (link.label if is_menu else menu_heading or "Possible menu file")[:180]
                    candidate.format, candidate.access, candidate.verified_at = format_, "checked", self.now()
                    candidate.branch_relevance = branch
                    candidate.provenance = ("corroborated_website" if same_site(resource.url, seed) else "linked_by_corroborated_website") if corroborated else "unverified_website"
                    candidate.menu_type = menu_kind(candidate.title + " " + menu_heading, resource.url)
                    candidate.freshness, candidate.date_label = dated_menu(candidate.title + " " + menu_heading, resource.url, checked_at.year)
                    candidate.evidence.extend([
                        MenuSourceEvidence(kind="branch", source_url=branch_source, detail=evidence[:500]),
                        MenuSourceEvidence(kind="format", source_url=resource.url, detail=f"HTTP 200; {format_.upper()} content type and document signature checked."),
                    ])
                    candidate.limitations = ["Dishes, prices, dietary information and menu completeness have not been extracted or verified.",
                        "The website was supplied by the user. Identity evidence does not independently prove domain ownership."]
                    if format_ != "html": candidate.limitations.append("Only the file signature was sampled. Its contents and internal branch references are not yet parsed.")
                    if candidate.freshness == "undated": candidate.limitations.append("No explicit menu date was established; the retrieval timestamp does not establish freshness.")
                    if candidate.freshness == "outdated": candidate.limitations.append("The menu label or filename carries an older year. Confirm a current menu before using it.")
                    if candidate.date_label:
                        candidate.evidence.append(MenuSourceEvidence(kind="date", source_url=resource.url, detail=f"Menu label/filename names year {candidate.date_label}; this is not a verified validity period."))
                    if candidate.menu_type == "unknown": candidate.limitations.append("Dine-in versus another service is not established by the available labels.")
                    if branch != "exact": candidate.limitations.append("The exact selected branch is not corroborated for this source.")
                    future = candidate.date_label is not None and int(candidate.date_label) > checked_at.year
                    if future: candidate.limitations.append("This menu is future-dated; current availability is unverified.")
                    candidate.suitable_for_extraction = (branch == "exact" and corroborated and candidate.freshness != "outdated" and not future
                                                        and candidate.menu_type in ("dine_in", "unknown"))
                    candidate.confidence = "high" if candidate.suitable_for_extraction and format_ == "html" and candidate.menu_type == "dine_in" else "medium" if candidate.suitable_for_extraction else "low"
                    existing = candidates.get(resource.url)
                    if existing is None or (not existing.suitable_for_extraction and candidate.suitable_for_extraction): candidates[resource.url] = candidate
                if not page or not same_site(resource.url, seed) or page.nofollow: continue
                seen_scoped = {l.url for l in scoped}
                links = scoped + [Link(l.url, l.label, branch, evidence, resource.url) for l in page.links if l.url not in seen_scoped]
                links.sort(key=lambda l: (not menu_link(l), l.branch == "other_branch",
                    menu_kind(l.label, l.url) in ("delivery", "takeaway", "catering"),
                    dated_menu(l.label, l.url, checked_at.year)[0] == "outdated", not same_site(l.url, seed), l.url))
                for child in links:
                    if len(queue) >= 30: break
                    if child.url == resource.url or child.url in visited: continue
                    if menu_link(child):
                        child_corroborated = corroborated or child.branch == "exact"
                        if same_site(child.url, seed) or (child_corroborated and child.branch == "exact"):
                            queue.append((child, depth + 1, child_corroborated))
                    elif same_site(child.url, seed) and location_link(child, request.restaurant):
                        queue.append((child, depth + 1, False))
                if not queue and not sitemap_attempted:
                    sitemap_attempted = True
                    # Read only an explicitly advertised same-site sitemap; no guessed crawling endpoints.
                    policy = self.fetcher.policy(seed)
                    for url in policy.sitemaps if policy else []:
                        try:
                            url = source_url(url)
                            if not same_site(seed, url): continue
                            sitemap = self.fetcher.fetch(url)
                            if b"<!DOCTYPE" in sitemap.body.upper() or b"<!ENTITY" in sitemap.body.upper(): raise SourceBlocked("Sitemap entity declarations are not supported.")
                            root = ElementTree.fromstring(sitemap.body)
                            for node in list(root.iter())[:300]:
                                if node.tag.split("}")[-1] == "loc" and node.text:
                                    target = source_url(node.text.strip())
                                    child = Link(target, "Sitemap menu link", discovered_from=sitemap.url)
                                    if same_site(seed, target) and re.search(r"menu|dinner|lunch", urlsplit(target).path, re.I):
                                        queue.append((child, depth + 1, False))
                            break
                        except (SourceBlocked, ElementTree.ParseError):
                            issues.append("An advertised sitemap could not be checked safely.")
            except SourceBlocked as error:
                if len(issues) < 8: issues.append(str(error))
                if is_menu:
                    candidate = self._candidate(link, link.url, request, checked_at)
                    candidate.access = "blocked"
                    candidate.limitations.append(str(error))
                    candidates[link.url] = candidate
        items = sorted(candidates.values(), key=lambda c: (not c.suitable_for_extraction, c.confidence != "high", c.menu_type != "dine_in", c.source_url))[:12]
        suitable = [c for c in items if c.suitable_for_extraction]
        status = "sources_found" if suitable else "needs_review" if items else "access_limited" if issues else "no_trustworthy_source"
        limits = ["Source discovery only: no menu has been extracted and no real-restaurant recommendations are available.",
                  "Website lookup is not connected. This check starts from the website URL you supplied."]
        limits.extend(dict.fromkeys(issues))
        if queue: limits.append("Some links remain unchecked because this discovery is deliberately bounded.")
        if not items and not issues: limits.append("No corroborated menu links were found. The site may need JavaScript, another public URL or a menu supplied by the restaurant.")
        return MenuSourceResult(request_id=request.request_id, restaurant_id=request.restaurant.place_id, checked_at=checked_at,
            status=status, candidates=items, recommended_candidate_id=suitable[0].id if suitable else None,
            requests_made=self.fetcher.requests, limitations=limits[:12])

    def _candidate(self, link, url, request, now):
        freshness, date = dated_menu(link.label, url, now.year)
        return MenuSourceCandidate(id=sha256((request.restaurant.place_id + "|" + url).encode()).hexdigest()[:24], source_url=url,
            discovered_from=link.discovered_from or link.url, title=link.label[:180] or "Possible menu source", format="unknown", menu_type=menu_kind(link.label, url),
            branch_relevance=link.branch, provenance="unverified_website", confidence="low", freshness=freshness, date_label=date,
            access="not_checked", discovered_at=now, evidence=[MenuSourceEvidence(kind="link", source_url=link.discovered_from or link.url, detail=link.evidence[:500])], limitations=[])

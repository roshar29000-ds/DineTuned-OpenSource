"""Robots groups, wildcard paths and longest-match allow/disallow rules.

Access failures are handled by the fetcher. Crawl-delay/request-rate are honored
conservatively in addition to REP path rules; they never cause busy retries.
"""
from dataclasses import dataclass, field
import re
from fnmatch import fnmatchcase
from urllib.parse import urlsplit, quote

PRODUCT = "DineTunedMenuDiscovery"


def encoded_path(value):
    value = quote(value, safe="/%?=&:;,+!$'()@*-._~")
    def decode(match):
        char = chr(int(match.group()[1:], 16))
        return char if re.fullmatch(r"[A-Za-z0-9._~-]", char) else match.group().upper()
    return re.sub(r"%[0-9a-fA-F]{2}", decode, value)


@dataclass
class RobotsPolicy:
    rules: list[tuple[bool, str]] = field(default_factory=list)
    delay: float = .4
    sitemaps: list[str] = field(default_factory=list)

    @classmethod
    def parse(cls, text):
        groups, agents, rules, delays, sitemaps = [], [], [], [], []
        directives = False
        def finish():
            if agents: groups.append((list(agents), list(rules), list(delays)))
        for line in text.splitlines():
            line = line.split("#", 1)[0].strip()
            if ":" not in line: continue
            name, value = [p.strip() for p in line.split(":", 1)]
            name = name.lower()
            if name == "user-agent":
                if directives:
                    finish(); agents, rules, delays = [], [], []
                    directives = False
                agents.append(value.lower())
            elif name in ("allow", "disallow") and agents:
                directives = True
                if value.startswith("/"): rules.append((name == "allow", encoded_path(value)))
            elif name == "crawl-delay" and agents:
                directives = True
                try:
                    delay = float(value)
                    if delay >= 0: delays.append(min(delay, 86400))
                except ValueError: pass
            elif name == "request-rate" and agents:
                directives = True
                try:
                    count, seconds = value.split("/")
                    if float(count) > 0: delays.append(max(0, float(seconds) / float(count)))
                except (ValueError, ZeroDivisionError): pass
            elif name == "sitemap" and len(sitemaps) < 4:
                sitemaps.append(value)
        finish()
        scored = [(max((len(a) for a in aa if a != "*" and a in PRODUCT.lower()), default=0 if "*" in aa else -1), rr, dd) for aa, rr, dd in groups]
        best = max((s for s, _, _ in scored), default=-1)
        matched = [(rr, dd) for s, rr, dd in scored if s == best and s >= 0]
        return cls([rule for rr, _ in matched for rule in rr], max([.4] + [delay for _, dd in matched for delay in dd]), sitemaps)

    def allows(self, url):
        parts = urlsplit(url)
        target = encoded_path(parts.path + ("?" + parts.query if parts.query else ""))
        matches = []
        for allow, rule in self.rules:
            end = rule.endswith("$")
            path = rule[:-1] if end else rule
            # fnmatch's atomic-star translation avoids catastrophic regex backtracking.
            pattern = path.replace("?", "[?]") + ("" if end else "*")
            if fnmatchcase(target, pattern): matches.append((len(path.replace("*", "").encode()), allow))
        return max(matches, default=(0, True))[1]

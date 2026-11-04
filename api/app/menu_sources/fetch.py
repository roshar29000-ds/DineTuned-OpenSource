from dataclasses import dataclass
import time
from urllib.parse import urljoin
import httpx
import httpcore
from .urls import source_url, origin, same_site, SourceBlocked
from .robots import RobotsPolicy, PRODUCT


@dataclass
class Resource:
    url: str
    status: int
    content_type: str
    body: bytes
    headers: dict
    partial: bool = False


class SourceFetcher:
    MAX_REQUESTS = 12
    MAX_BYTES = 2_000_000
    WORK_SECONDS = 22
    BINARY_BYTES = 8192
    SAMPLE_BINARY = True

    def __init__(self, client: httpx.Client, clock=time.monotonic, sleep=time.sleep):
        self.client, self.clock, self.sleep = client, clock, sleep
        self.deadline = clock() + self.WORK_SECONDS
        self.requests = self.bytes = 0
        self.policies, self.visited_at = {}, {}

    def _request(self, url, *, robots=False):
        if self.requests >= self.MAX_REQUESTS or self.clock() >= self.deadline or self.bytes >= self.MAX_BYTES:
            raise SourceBlocked("The bounded website check reached its request, time or size limit.")
        url = source_url(url)
        self.requests += 1
        self.visited_at[origin(url)] = self.clock()
        self.client.cookies.clear()
        try:
            with self.client.stream("GET", url, headers={"User-Agent": PRODUCT + "/0.1", "Accept": "text/html,application/pdf,application/xml,text/plain,image/png,image/jpeg,image/webp;q=0.5",
                    "Accept-Encoding": "identity"}, follow_redirects=False, timeout=min(4, max(.05, self.deadline - self.clock()))) as response:
                headers = {k.lower(): v for k, v in response.headers.items() if k.lower() in ("location", "content-type", "content-length", "content-encoding", "x-robots-tag", "cf-mitigated")}
                content_type = headers.get("content-type", "").split(";", 1)[0].lower()
                if response.status_code != 200:
                    return Resource(url, response.status_code, content_type, b"", headers)
                if headers.get("content-encoding", "identity").lower() not in ("", "identity"):
                    raise SourceBlocked("This source requires a compressed response that is not supported by the bounded check.")
                # Discovery only samples binary signatures; it does not parse PDF/image contents.
                binary = not robots and (content_type in ("application/pdf", "application/octet-stream") or content_type.startswith("image/"))
                cap = self.BINARY_BYTES if binary else 512_000 if robots else 750_000
                body = bytearray()
                for chunk in response.iter_raw(chunk_size=4096):
                    self.bytes += len(chunk)
                    if self.clock() >= self.deadline or self.bytes > self.MAX_BYTES:
                        raise SourceBlocked("The bounded website check reached its time or size limit.")
                    body.extend(chunk)
                    if binary and self.SAMPLE_BINARY and len(body) >= cap: break
                    if len(body) > cap: raise SourceBlocked("This page exceeds the discovery size limit.")
                return Resource(url, response.status_code, content_type, bytes(body), headers, partial=binary and self.SAMPLE_BINARY)
        except (httpx.HTTPError, httpcore.NetworkError, httpcore.TimeoutException, httpcore.ProtocolError, OSError):
            raise SourceBlocked("The website could not be reached within the bounded check. No retry was attempted.") from None

    def policy(self, url):
        host = origin(url)
        if host in self.policies: return self.policies[host]
        if len(self.policies) >= 3: raise SourceBlocked("The website check reached its host limit.")
        self.policies[host] = None  # Failed robots checks remain closed for this job.
        target = host + "/robots.txt"
        for _ in range(6):
            response = self._request(target, robots=True)
            if response.status in (301, 302, 303, 307, 308):
                next_url = source_url(urljoin(target, response.headers.get("location", "")))
                if not same_site(target, next_url): raise SourceBlocked("Robots redirects leave the website; access could not be established.")
                target = next_url
                continue
            if response.status in (404, 410):
                result = RobotsPolicy()
            elif response.status == 200 and (response.content_type in ("text/plain", "") or response.body.lstrip().lower().startswith(b"user-agent:")):
                result = RobotsPolicy.parse(response.body.decode("utf-8-sig", errors="replace"))
            else:
                raise SourceBlocked("Website robots rules are unavailable or access is restricted. No content was crawled.")
            self.policies[host] = result
            return result
        raise SourceBlocked("Robots redirects could not be resolved within the check limit.")

    def fetch(self, url):
        url = source_url(url)
        initial = url
        for _ in range(4):
            policy = self.policy(url)
            if policy is None or not policy.allows(url): raise SourceBlocked("The website's robots rules do not allow this page to be crawled.")
            wait = policy.delay - (self.clock() - self.visited_at.get(origin(url), 0))
            if wait > 0:
                if self.clock() + wait >= self.deadline: raise SourceBlocked("The website's crawl delay exceeds this check's time budget.")
                self.sleep(wait)
            resource = self._request(url)
            if resource.status in (301, 302, 303, 307, 308):
                target = source_url(urljoin(url, resource.headers.get("location", "")))
                if not same_site(initial, target):
                    raise SourceBlocked("The source redirects to a different website. Supply that public website explicitly for a separate check.")
                url = target
                continue
            if resource.status != 200:
                raise SourceBlocked("The source is unavailable or restricts access. Login, CAPTCHA and rate limits are not bypassed.")
            if resource.headers.get("cf-mitigated") == "challenge" or "noai" in resource.headers.get("x-robots-tag", "").lower():
                raise SourceBlocked("This source restricts automated access or AI use.")
            return resource
        raise SourceBlocked("The source has too many redirects.")

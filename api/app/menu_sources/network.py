"""Public-IP pinning at connect time, retaining original Host and TLS SNI.

Uses httpcore's public NetworkBackend/ConnectionPool API. DNS is bounded and no
second hostname resolution occurs between validation and the TCP connection.
"""
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from threading import BoundedSemaphore
import ipaddress
import socket
import ssl
import certifi
import httpcore
import httpx
from .urls import public_hostname, source_url, SourceBlocked

_resolver = ThreadPoolExecutor(max_workers=2, thread_name_prefix="menu-dns")
_dns_slots = BoundedSemaphore(2)
_translation_networks = (ipaddress.ip_network("64:ff9b::/96"), ipaddress.ip_network("64:ff9b:1::/48"))


def public_addresses(host, timeout=2):
    public_hostname(host)
    if not _dns_slots.acquire(blocking=False):
        raise SourceBlocked("Website DNS checks are busy. Try again later.")
    future = _resolver.submit(socket.getaddrinfo, host, 443, socket.AF_UNSPEC, socket.SOCK_STREAM)
    future.add_done_callback(lambda _: _dns_slots.release())
    try:
        answers = future.result(timeout=timeout)
        addresses = sorted({row[4][0] for row in answers})
        if not addresses:
            raise SourceBlocked("Website DNS could not be verified.")
        for value in addresses:
            address = ipaddress.ip_address(value)
            if (not address.is_global or address.is_multicast or getattr(address, "ipv4_mapped", None)
                    or getattr(address, "sixtofour", None) or getattr(address, "teredo", None)
                    or any(address in subnet for subnet in _translation_networks)):
                raise SourceBlocked("This website resolves to a non-public network address.")
        return addresses
    except (FutureTimeout, OSError, ValueError):
        raise SourceBlocked("Website DNS could not be verified in time.") from None


class PublicNetworkBackend(httpcore.SyncBackend):
    def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        if port != 443:
            raise SourceBlocked("Only HTTPS connections are supported.")
        address = public_addresses(host, min(timeout or 2, 2))[0]
        return super().connect_tcp(address, port, timeout=timeout, local_address=None, socket_options=socket_options)


class CoreStream(httpx.SyncByteStream):
    def __init__(self, stream): self.stream = stream
    def __iter__(self): yield from self.stream
    def close(self): self.stream.close()


class PublicWebTransport(httpx.BaseTransport):
    def __init__(self):
        self.pool = httpcore.ConnectionPool(ssl_context=ssl.create_default_context(cafile=certifi.where()),
            network_backend=PublicNetworkBackend(), retries=0, max_connections=1, max_keepalive_connections=0)

    def handle_request(self, request):
        source_url(str(request.url))
        core = httpcore.Request(method=request.method, url=httpcore.URL(scheme=request.url.raw_scheme,
            host=request.url.raw_host, port=request.url.port, target=request.url.raw_path),
            headers=request.headers.raw, content=request.stream, extensions=request.extensions)
        response = self.pool.handle_request(core)
        return httpx.Response(response.status, headers=response.headers, stream=CoreStream(response.stream), extensions=response.extensions)

    def close(self): self.pool.close()

"""All automated backend tests are offline, including accidental provider calls."""
import socket
import httpx
import pytest


@pytest.fixture(autouse=True)
def no_external_network(monkeypatch, tmp_path):
    monkeypatch.setenv('DINETUNED_TABLE_STORE_PATH', str(tmp_path / 'guest_tables.sqlite3'))
    def blocked(*args, **kwargs):
        raise AssertionError("Network disabled in tests. Use httpx.MockTransport or ASGITransport.")
    monkeypatch.setattr(socket.socket, "connect", blocked)
    monkeypatch.setattr(socket, "create_connection", blocked)
    monkeypatch.setattr(socket, "getaddrinfo", blocked)
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", blocked)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", blocked)

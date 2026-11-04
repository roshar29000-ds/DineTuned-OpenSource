"""Retired ungated adapter. Paid calls must use the protected developer command."""
from .culinary.errors import CulinaryError


def model_ask(question: str, model: str = "spark") -> str:
    raise CulinaryError("legacy_disabled", "Ungated inference is disabled. Use scripts/meta_smoke.py after explicit spending approval.")

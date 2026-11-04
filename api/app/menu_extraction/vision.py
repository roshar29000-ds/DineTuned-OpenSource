"""Replaceable vision boundary. No SDK imports, paid calls or implicit fallback."""
from dataclasses import dataclass
from typing import Literal, Protocol
from pydantic import Field
from ..schemas import Contract
from .models import Hash


class VisionItemProposal(Contract):
    name: str = Field(min_length=1, max_length=300)
    description: str = Field(default='', max_length=3000)
    category: str | None = None
    price_text: str | None = None
    page: int = Field(ge=1, le=24)
    transcription: str = Field(min_length=1, max_length=8000)
    uncertainty: list[str] = Field(default_factory=list)


class VisionProposal(Contract):
    source_hash: Hash
    mode: Literal['mocked', 'unavailable']
    items: list[VisionItemProposal] = Field(default_factory=list, max_length=600)
    limitations: list[str]


@dataclass(frozen=True)
class VisionContext:
    source_hash: str
    format: str
    data: bytes
    missing_pages: tuple[int, ...]


class MenuVisionProvider(Protocol):
    def propose(self, context: VisionContext) -> VisionProposal: ...


class UnavailableVisionProvider:
    def propose(self, context):
        return VisionProposal(source_hash=context.source_hash, mode='unavailable',
            limitations=['Scanned PDFs and menu images require separately approved vision extraction. No model was called.'])


def check_vision(provider, context):
    """A mock is useful for interface tests, never evidence of real image contents."""
    try:
        value = VisionProposal.model_validate(provider.propose(context))
        if value.source_hash != context.source_hash or any(item.page not in context.missing_pages for item in value.items):
            raise ValueError()
        return value
    except Exception:
        return VisionProposal(source_hash=context.source_hash, mode='unavailable', limitations=['The vision proposal was unavailable or rejected. No extracted dishes were accepted.'])

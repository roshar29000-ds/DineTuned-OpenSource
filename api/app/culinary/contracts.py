"""Internal provider contracts; existing application responses remain unchanged."""
from typing import Literal, Protocol
from pydantic import Field, StrictFloat, StrictStr
from ..schemas import Contract, Identifier, BridgeLink, BridgeFact, BudgetPosition, MenuItem, StructuredTasteBridge


class FactClaim(Contract):
    fact_id: Identifier
    attribute: str = Field(max_length=32)
    value: StrictStr | StrictFloat


class CandidateProposal(Contract):
    item_id: Identifier
    fit: Literal["strong", "tentative"]
    claims: list[FactClaim] = Field(max_length=4)
    anchor_id: Identifier | None
    shared: list[BridgeLink] = Field(max_length=3)
    differences: list[BridgeLink] = Field(max_length=2)
    uncertainties: list[Literal["partial_taste", "incomplete_menu", "unknown_ingredients", "familiarity_unknown"]] = Field(max_length=4)


class CulinaryProposal(Contract):
    restaurant_id: Identifier
    menu_version: Identifier
    # List order is the provider's culinary ranking, not Python taste scores.
    candidates: list[CandidateProposal] = Field(max_length=8)


class ProviderOutput(Contract):
    provider: str
    mode: Literal["meta", "mock", "demo"]
    model: str | None
    proposal: CulinaryProposal


class ValidatedCulinaryPick(Contract):
    dish: MenuItem
    category_name: str
    explanation: str
    evidence: list[BridgeFact]
    uncertainties: list[str]
    taste_bridge: StructuredTasteBridge
    budget: BudgetPosition


class CulinarySelection(Contract):
    restaurant_id: Identifier
    menu_version: Identifier
    provider: str
    mode: Literal["meta", "mock", "demo"]
    model: str | None
    context_digest: str
    recommendations: list[ValidatedCulinaryPick] = Field(max_length=3)
    worth_the_stretch: list[ValidatedCulinaryPick] = Field(max_length=2)
    rejected: list[dict[str, str]]


class CulinaryReasoningProvider(Protocol):
    def propose(self, context: "CulinaryContext") -> ProviderOutput: ...


from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from .context import CulinaryContext

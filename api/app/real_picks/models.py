from typing import Literal
from uuid import UUID
from pydantic import Field, PrivateAttr
from ..schemas import (Contract, Identifier, TasteProfile, RecommendationTasteEvidence,
    DiningConstraints, RecommendationOptions, BudgetPosition, RefinementRequest, DietaryRestriction)
from ..discovery.models import PlaceID
from ..menu_extraction.models import MenuExtractionResult, ExtractedMenuItem, ExtractionEvidence


class RealPicksRequest(Contract):
    # Runner-only evaluation context. Never accepted from browser JSON or persisted.
    _technical_soft_dietary: tuple[DietaryRestriction, ...] = PrivateAttr(default=())
    request_id: UUID
    extraction: MenuExtractionResult
    profile: TasteProfile
    taste_evidence: RecommendationTasteEvidence = Field(default_factory=RecommendationTasteEvidence)
    constraints: DiningConstraints
    options: RecommendationOptions = Field(default_factory=RecommendationOptions)
    refinements: RefinementRequest = Field(default_factory=RefinementRequest)


class RealPreference(Contract):
    id: Identifier
    label: str
    source: Literal['taste_dna', 'taste_detective', 'taste_memory']
    basis: Literal['stated', 'inferred']
    polarity: Literal['like', 'dislike']


class RealMemoryObservation(Contract):
    id: Identifier
    label: str = Field(min_length=1, max_length=1200)
    kind: Literal['feedback', 'saved', 'selected', 'ordered', 'tasted']
    polarity: Literal['like', 'dislike', 'neutral']
    restaurant_id: Identifier
    menu_version: Identifier
    dish_id: Identifier
    consumption_confirmed: bool


class MenuConnectionProposal(Contract):
    preference_id: Identifier
    field: Literal['name', 'description']
    quote: str = Field(min_length=3, max_length=500)


class RealCandidateProposal(Contract):
    item_id: Identifier
    fit: Literal['exceptional', 'strong', 'tentative']
    connections: list[MenuConnectionProposal] = Field(min_length=1, max_length=3)
    uncertainty: list[Literal['limited_taste', 'missing_description', 'possible_dislike', 'uncertain_portion']] = Field(max_length=4)


class RealPairingProposal(Contract):
    main_id: Identifier
    addition_ids: list[Identifier] = Field(min_length=1, max_length=2)


class RealCulinaryProposal(Contract):
    restaurant_id: PlaceID
    menu_version: Identifier
    candidates: list[RealCandidateProposal] = Field(max_length=6)
    pairings: list[RealPairingProposal] = Field(max_length=3)


class RealProviderOutput(Contract):
    mode: Literal['meta', 'mock']
    model: str
    proposal: RealCulinaryProposal


class RealPickConnection(Contract):
    preference: RealPreference
    menu_quote: str
    field: Literal['name', 'description']
    evidence: ExtractionEvidence


class RealPersonalizedPick(Contract):
    dish: ExtractedMenuItem
    category_name: str
    fit: Literal['exceptional', 'strong']
    explanation: str
    connections: list[RealPickConnection]
    price_minor: int = Field(ge=0)
    currency: Literal['USD'] = 'USD'
    budget: BudgetPosition
    limitations: list[str]


class RealTasteBridge(Contract):
    item_id: Identifier
    anchor: RealPreference
    menu_quote: str
    evidence: ExtractionEvidence
    connection: str
    uncertainty: str


class RealMealItem(Contract):
    dish: ExtractedMenuItem
    category_name: str
    price_minor: int = Field(ge=0)
    evidence: ExtractionEvidence


class RealMealCombination(Contract):
    main_item_id: Identifier
    additions: list[RealMealItem] = Field(min_length=1, max_length=2)
    subtotal_minor: int = Field(ge=0)
    rationale: str
    limitations: list[str]


class RealPickExclusion(Contract):
    item_id: Identifier
    reasons: list[str]


class RealPicksResult(Contract):
    request_id: UUID
    restaurant_id: PlaceID
    menu_version: Identifier
    context_digest: str = Field(pattern=r'^[0-9a-f]{64}$')
    status: Literal['ready', 'no_matches', 'no_eligible_items', 'insufficient_taste', 'unavailable']
    mode: Literal['meta', 'mock', 'not_run']
    model: str | None
    recommendations: list[RealPersonalizedPick] = Field(max_length=3)
    taste_bridges: list[RealTasteBridge] = Field(default_factory=list, max_length=5,
        json_schema_extra={'x-response-optional': True})
    meal_combinations: list[RealMealCombination] = Field(default_factory=list, max_length=3,
        json_schema_extra={'x-response-optional': True})
    worth_the_stretch: list[RealPersonalizedPick] = Field(default_factory=list, max_length=2,
        json_schema_extra={'x-response-optional': True})
    exclusions: list[RealPickExclusion]
    message: str
    limitations: list[str]
    error_code: str | None = None


class RealPicksCapability(Contract):
    available: bool
    mode: Literal['disabled', 'mock', 'meta']
    message: str

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID
from pydantic import Field
from ..schemas import Contract, Identifier, AllergenEvidence
from ..discovery.models import DiscoveredRestaurant, PlaceID
from ..menu_sources.models import MenuSourceResult, MenuSourceCandidate, SourceURL

Hash = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class MenuExtractionRequest(Contract):
    request_id: UUID
    restaurant: DiscoveredRestaurant
    selection_token: str = Field(min_length=20, max_length=2048, repr=False)
    sources: MenuSourceResult
    candidate_ids: list[str] = Field(default_factory=list, max_length=8)


class MenuUploadRequest(Contract):
    request_id: UUID
    restaurant: DiscoveredRestaurant
    selection_token: str = Field(min_length=20, max_length=2048, repr=False)
    filename: str = Field(min_length=1, max_length=180)
    # At most 3 MB decoded; JSON/base64 fits the hosted relay's bounded body.
    content_base64: str = Field(min_length=4, max_length=4_000_000, repr=False)


class ExtractionEvidence(Contract):
    id: Identifier
    source_id: Identifier
    source_url: SourceURL
    source_hash: Hash
    locator: str = Field(max_length=500)
    page: int | None = Field(default=None, ge=1, le=24)
    # Normalized visible text or decoded JSON value, not a manufactured explanation.
    quote: str = Field(min_length=1, max_length=8000)
    method: Literal["json_ld", "html", "pdf_text"]


class ExtractedPriceOption(Contract):
    label: str | None = None
    raw: str
    amount_minor: int | None = Field(default=None, ge=0, le=1_000_000_000)
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    evidence_id: Identifier


class ExtractedPrice(Contract):
    kind: Literal["fixed", "variants", "range", "unknown", "ambiguous"]
    basis: Literal["as_printed"] = "as_printed"
    raw: str | None
    options: list[ExtractedPriceOption] = Field(default_factory=list, max_length=20)
    # Only a single, unambiguous price can participate in future budget checks.
    budget_usable: bool = False
    limitations: list[str] = Field(default_factory=list)


class ExtractedMenuItem(Contract):
    id: Identifier
    category_id: Identifier
    name: str = Field(min_length=1, max_length=300)
    description: str = Field(max_length=3000)
    price: ExtractedPrice
    evidence_ids: list[Identifier]
    availability: Literal["unverified", "listed_unavailable"] = "unverified"
    ingredients: list[str] = Field(default_factory=list)
    dietary: list[str] = Field(default_factory=list)
    allergens: AllergenEvidence = Field(default_factory=lambda: AllergenEvidence(
        note="Menu text does not establish a complete ingredient list or cross-contact controls. Confirm with restaurant staff."))
    confidence: Literal["structured", "supported", "needs_review"]
    limitations: list[str] = Field(default_factory=list)


class ExtractedMenuCategory(Contract):
    id: Identifier
    name: str
    evidence_ids: list[Identifier]
    items: list[ExtractedMenuItem]


class ExtractionIssue(Contract):
    code: str
    severity: Literal["notice", "review", "blocked"]
    message: str
    source_id: Identifier | None = None
    item_ids: list[Identifier] = Field(default_factory=list)


class ExtractedSource(Contract):
    id: Identifier
    candidate: MenuSourceCandidate
    source_url: SourceURL
    source_hash: Hash | None = None
    retrieved_at: datetime | None = None
    status: Literal["parsed", "partial", "needs_vision", "blocked", "failed"]
    page_count: int = 0
    parsed_pages: list[int] = Field(default_factory=list)
    recognized_items: int = 0
    extracted_items: int = 0
    unresolved_sections: list[str] = Field(default_factory=list)
    # Counts cover recognized source records only, never every restaurant offering.
    coverage: Literal["accounted_source_records", "partial", "unknown"] = "unknown"


class MenuCompleteness(Contract):
    scope: Literal["supplied_source_set"] = "supplied_source_set"
    status: Literal["accounted_source_records", "partial", "unknown"]
    restaurant_menu_complete: Literal[False] = False
    requested_sources: int
    parsed_sources: int
    recognized_items: int
    extracted_items: int
    reasons: list[str]


class ExtractedRestaurantMenu(Contract):
    schema_version: Literal[1] = 1
    mode: Literal["extracted"] = "extracted"
    version: Identifier
    restaurant_id: PlaceID
    restaurant: DiscoveredRestaurant
    categories: list[ExtractedMenuCategory]
    total_items: int
    sources: list[ExtractedSource]
    evidence: list[ExtractionEvidence]
    completeness: MenuCompleteness
    issues: list[ExtractionIssue]
    extracted_at: datetime
    parser_version: str
    # Extraction does not authorize the existing demo-only recommendation endpoint.
    recommendations_ready: Literal[False] = False


class MenuExtractionResult(Contract):
    schema_version: Literal[1] = 1
    request_id: UUID
    restaurant_id: PlaceID
    status: Literal["extracted", "needs_review", "unavailable"]
    provider: Literal["local_html_pdf"] = "local_html_pdf"
    vision_status: Literal["not_needed", "unavailable", "mocked"] = "not_needed"
    recommendation_token: str | None = Field(default=None, min_length=20, max_length=2048, repr=False,
        json_schema_extra={"x-response-optional": True})
    menu: ExtractedRestaurantMenu
    requests_made: int = Field(ge=0, le=20)

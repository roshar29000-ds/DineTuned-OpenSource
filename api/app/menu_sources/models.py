from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID
from pydantic import Field, StringConstraints
from ..schemas import Contract
from ..discovery.models import DiscoveredRestaurant, PlaceID

SourceURL = Annotated[str, StringConstraints(min_length=8, max_length=2048)]


class MenuSourceRequest(Contract):
    request_id: UUID
    restaurant: DiscoveredRestaurant
    selection_token: str = Field(min_length=20, max_length=2048, repr=False)
    website_url: SourceURL


class MenuSourceEvidence(Contract):
    kind: Literal["identity", "branch", "link", "format", "menu_type", "date", "access"]
    source_url: SourceURL
    detail: str = Field(max_length=500)


class MenuSourceCandidate(Contract):
    id: str
    source_url: SourceURL
    discovered_from: SourceURL
    title: str = Field(max_length=180)
    format: Literal["html", "pdf", "image", "unknown"]
    menu_type: Literal["dine_in", "delivery", "takeaway", "catering", "unknown"]
    branch_relevance: Literal["exact", "site_wide", "unknown", "other_branch"]
    provenance: Literal["corroborated_website", "linked_by_corroborated_website", "unverified_website", "user_upload"]
    confidence: Literal["high", "medium", "low"]
    freshness: Literal["undated", "dated", "outdated"]
    date_label: str | None = None
    access: Literal["checked", "not_checked", "blocked", "unavailable"]
    verified_at: datetime | None = None
    discovered_at: datetime
    evidence: list[MenuSourceEvidence] = Field(max_length=12)
    limitations: list[str] = Field(max_length=10)
    suitable_for_extraction: bool = False
    # A resource check is not a verified menu, price list, or permission to order.
    extraction_status: Literal["not_extracted"] = "not_extracted"


class MenuSourceResult(Contract):
    schema_version: Literal[1] = 1
    request_id: UUID
    restaurant_id: PlaceID
    identity_source: Literal["google_places"] = "google_places"
    status: Literal["sources_found", "needs_review", "no_trustworthy_source", "access_limited"]
    provider: Literal["bounded_public_web"] = "bounded_public_web"
    seed_origin: Literal["user_supplied_website"] = "user_supplied_website"
    checked_at: datetime
    candidates: list[MenuSourceCandidate] = Field(max_length=12)
    recommended_candidate_id: str | None = None
    requests_made: int = Field(ge=0, le=12)
    limitations: list[str] = Field(max_length=12)
    # This response can never be confused with RestaurantMenu.
    menu_status: Literal["sources_only"] = "sources_only"
    extraction_token: str | None = Field(default=None, max_length=2048, repr=False, json_schema_extra={"x-response-optional": True})

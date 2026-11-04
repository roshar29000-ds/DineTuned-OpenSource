from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID
from pydantic import Field, StringConstraints
from ..schemas import Contract

PlaceID = Annotated[str, StringConstraints(min_length=1, max_length=255, pattern=r"^[A-Za-z0-9_-]+$")]
Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=600)]


class DiscoveryLocation(Contract):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class DiscoveryConfig(Contract):
    google_enabled: bool
    message: str
    minimum_query_length: Literal[3] = 3


class DiscoverySession(Contract):
    session_token: UUID
    expires_at: datetime
    request_limit: int


class DiscoverySearch(Contract):
    session_token: UUID
    query: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=80)]
    area: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] = ""
    location: DiscoveryLocation | None = None


class DiscoverySelection(Contract):
    session_token: UUID
    place_id: PlaceID


class RestaurantPrediction(Contract):
    provider: Literal["google_places", "demo"]
    place_id: PlaceID
    name: Label
    address: Label | None = None
    types: list[str] = Field(default_factory=list, max_length=50)
    distance_meters: int | None = Field(default=None, ge=0)


class DiscoveryResults(Contract):
    provider: Literal["google_places", "demo"]
    session_token: UUID
    predictions: list[RestaurantPrediction] = Field(max_length=10)
    location_mode: Literal["nearby", "area", "global"]


class PlaceAttribution(Contract):
    provider: Label
    uri: str | None = None


class RestaurantSource(Contract):
    provider: Literal["google_places", "demo"]
    api: Literal["places_new", "fictional_catalog"]
    retrieved_at: datetime
    place_id: PlaceID


class DiscoveredRestaurant(Contract):
    provider: Literal["google_places", "demo"]
    place_id: PlaceID
    display_name: Label
    formatted_address: Label | None = None
    location: DiscoveryLocation | None = None
    business_status: Literal["OPERATIONAL", "CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY", "UNKNOWN"] = "UNKNOWN"
    types: list[str] = Field(default_factory=list, max_length=50)
    source: RestaurantSource
    attributions: list[PlaceAttribution] = Field(default_factory=list, max_length=30)


class MenuDiscoveryHandoff(Contract):
    schema_version: Literal[1] = 1
    restaurant: DiscoveredRestaurant
    menu_status: Literal["not_retrieved"] = "not_retrieved"
    limitations: list[str]
    source_discovery_token: str | None = Field(default=None, max_length=2048, repr=False, json_schema_extra={"x-response-optional": True})

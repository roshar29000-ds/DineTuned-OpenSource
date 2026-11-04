"""Replaceable identity providers. Menu retrieval is deliberately outside this interface."""
from datetime import datetime, timezone
from decimal import Decimal
from typing import Protocol
from urllib.parse import urlsplit
import httpx
from pydantic import ValidationError
from .config import PlacesConfig, DiscoveryError
from .models import (DiscoverySearch, DiscoverySelection, DiscoveryResults, RestaurantPrediction,
                     DiscoveredRestaurant, RestaurantSource, MenuDiscoveryHandoff, PlaceAttribution)
from ..services.catalog import search_restaurants, get_menu
from ..validation_spend import ValidationSpend

AUTOCOMPLETE_MASK = ",".join("suggestions.placePrediction." + value for value in (
    "placeId", "structuredFormat.mainText.text", "structuredFormat.secondaryText.text", "types", "distanceMeters"))
DETAILS_MASK = "id,displayName,formattedAddress,location,businessStatus,types,attributions"
BASE_URL = "https://places.googleapis.com/v1/places"
FOOD_TYPES = {"restaurant", "cafe", "coffee_shop", "bakery", "bar", "meal_takeaway", "meal_delivery",
              "food_court", "food_truck", "ice_cream_shop", "sandwich_shop", "pizza_restaurant"}


def dining_types(types):
    return isinstance(types, list) and any(isinstance(t, str) and (t in FOOD_TYPES or t.endswith("_restaurant")) for t in types)


def location_mode(request):
    return "area" if request.area else "nearby" if request.location else "global"


def handoff(restaurant):
    limitations = ["No menu sources, dishes or dietary information have been retrieved for this selection yet."]
    if not restaurant.formatted_address:
        limitations.append("The provider did not supply an address; confirm the location before visiting.")
    if not restaurant.location:
        limitations.append("Coordinates are unavailable.")
    if restaurant.business_status == "UNKNOWN":
        limitations.append("Business status is unavailable; confirm directly with the restaurant.")
    return MenuDiscoveryHandoff(restaurant=restaurant, limitations=limitations)


class RestaurantDiscoveryProvider(Protocol):
    def autocomplete(self, request: DiscoverySearch) -> DiscoveryResults: ...
    def details(self, request: DiscoverySelection) -> MenuDiscoveryHandoff: ...


class DemoRestaurantDiscoveryProvider:
    """Adapter over the existing catalog; its legacy API and menu journey stay intact."""
    search_catalog = staticmethod(search_restaurants)

    def autocomplete(self, request):
        location = request.location if not request.area else None
        result = self.search_catalog(" ".join(filter(None, (request.query, request.area))),
                                     location.latitude if location else None, location.longitude if location else None)
        return DiscoveryResults(provider="demo", session_token=request.session_token, location_mode=location_mode(request), predictions=[
            RestaurantPrediction(provider="demo", place_id=r.id, name=r.name, address=f"{r.area}, {r.city}",
                                 types=["restaurant"], distance_meters=round(r.distance_km * 1000) if r.distance_km is not None else None)
            for r in result.restaurants])

    def details(self, request):
        restaurant = get_menu(request.place_id).restaurant
        return handoff(DiscoveredRestaurant(provider="demo", place_id=restaurant.id, display_name=restaurant.name,
            formatted_address=f"Fictional location: {restaurant.area}, {restaurant.city}", types=["restaurant"],
            source=RestaurantSource(provider="demo", api="fictional_catalog", place_id=restaurant.id, retrieved_at=datetime.now(timezone.utc))))


class GooglePlacesProvider:
    def __init__(self, config: PlacesConfig, client: httpx.Client):
        self.config, self.client = config, client

    def _request(self, method, url, mask, **kwargs):
        self.config.require_live()  # A key alone never authorizes even a direct adapter call.
        phase = None if isinstance(getattr(self.client, '_transport', None), httpx.MockTransport) else ValidationSpend.from_environment()
        reservation = None
        status = 'failed'
        if phase:
            operation = 'autocomplete' if method == 'POST' else 'place_details'
            reservation = phase.reserve('google_places', 'places_new', operation,
                                        Decimal('0.003' if method == 'POST' else '0.025'))
        try:
            response = self.client.request(method, url, headers={"X-Goog-Api-Key": self.config.api_key,
                "X-Goog-FieldMask": mask, "Content-Type": "application/json"}, **kwargs)
            if response.status_code == 429:
                raise DiscoveryError(429, "Google restaurant search is at capacity. Please try later.")
            if response.status_code == 404:
                raise DiscoveryError(404, "This restaurant is no longer available from Google. Start a new search.")
            if response.status_code != 200:
                raise DiscoveryError(502, "Google restaurant search could not complete this request. No demo results were substituted.")
            data = response.json()
            if not isinstance(data, dict):
                raise ValueError()
            status = 'success'
            return data
        except httpx.TimeoutException:
            raise DiscoveryError(504, "Google restaurant search timed out. The request was not retried.") from None
        except (httpx.HTTPError, ValueError):
            raise DiscoveryError(502, "Google restaurant search returned an unreadable response. Please start a new search.") from None
        finally:
            if phase and reservation:
                phase.finish(reservation, status)

    def autocomplete(self, request):
        body = {"input": f"{request.query} in {request.area}" if request.area else request.query,
                "sessionToken": str(request.session_token), "includeQueryPredictions": False, "languageCode": "en"}
        if request.location and not request.area:
            center = request.location.model_dump()
            body.update(locationBias={"circle": {"center": center, "radius": 25000.0}}, origin=center)
        else:
            # Explicit worldwide bias prevents Google's implicit backend-IP bias.
            body["locationBias"] = {"rectangle": {"low": {"latitude": -90, "longitude": -180},
                                                  "high": {"latitude": 90, "longitude": 180}}}
        data = self._request("POST", BASE_URL + ":autocomplete", AUTOCOMPLETE_MASK, json=body)
        suggestions = data.get("suggestions", [])
        if not isinstance(suggestions, list):
            raise DiscoveryError(502, "Google restaurant suggestions could not be read.")
        predictions, seen = [], set()
        for item in suggestions[:5]:
            try:
                p = item["placePrediction"]
                types = p.get("types", [])
                # No primary-type restriction: cuisine-specific restaurant types remain discoverable.
                # Unknown types may be shown, but Details must verify a dining establishment.
                if types and not dining_types(types):
                    continue
                prediction = RestaurantPrediction(provider="google_places", place_id=p["placeId"],
                    name=p["structuredFormat"]["mainText"]["text"],
                    address=p["structuredFormat"].get("secondaryText", {}).get("text") or None,
                    types=types, distance_meters=p.get("distanceMeters"))
                if prediction.place_id not in seen:
                    predictions.append(prediction)
                    seen.add(prediction.place_id)
            except (KeyError, TypeError, AttributeError, ValidationError):
                continue  # Partial entries never acquire invented names or addresses.
        return DiscoveryResults(provider="google_places", session_token=request.session_token,
                                predictions=predictions, location_mode=location_mode(request))

    def details(self, request):
        data = self._request("GET", BASE_URL + "/" + request.place_id, DETAILS_MASK, params={"sessionToken": str(request.session_token), "languageCode": "en"})
        try:
            if data.get("id") != request.place_id or not dining_types(data.get("types")):
                raise DiscoveryError(422, "This result could not be verified as the selected dining location. Please choose another branch.")
            attributions = []
            for value in data.get("attributions", []):
                uri = value.get("providerUri")
                parsed = urlsplit(uri) if isinstance(uri, str) else None
                safe_uri = uri if parsed and parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password else None
                attributions.append(PlaceAttribution(provider=value["provider"], uri=safe_uri))
            restaurant = DiscoveredRestaurant(provider="google_places", place_id=data["id"],
                display_name=data["displayName"]["text"], formatted_address=data.get("formattedAddress") or None,
                location=data.get("location"), business_status=data.get("businessStatus", "UNKNOWN"), types=data["types"],
                attributions=attributions, source=RestaurantSource(provider="google_places", api="places_new",
                    place_id=data["id"], retrieved_at=datetime.now(timezone.utc)))
            return handoff(restaurant)
        except (ValueError, KeyError, TypeError, AttributeError):
            raise DiscoveryError(502, "Google returned incomplete restaurant identity data. Please start a new search.") from None

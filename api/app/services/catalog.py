import math
import unicodedata
from fastapi import HTTPException
from ..demo_data import catalog
from ..schemas import RestaurantMenu, RestaurantSearch

def normalized(value: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", value.casefold()) if not unicodedata.combining(c))

def distance_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return round(6371 * 2 * math.asin(min(1, math.sqrt(h))), 1)

def search_restaurants(query: str, latitude: float | None = None, longitude: float | None = None) -> RestaurantSearch:
    query = normalized(query.strip())
    origin = (latitude, longitude) if latitude is not None and longitude is not None else None
    matches = []
    for menu, coordinates in catalog().values():
        r = menu.restaurant
        if all(token in normalized(f"{r.name} {r.cuisine} {r.area}") for token in query.split()):
            distance = distance_km(origin, coordinates) if origin is not None else None
            matches.append(r.model_copy(update={"distance_km": distance}))
    matches.sort(key=lambda r: (r.distance_km if origin is not None else 0, normalized(r.name), r.area))
    return RestaurantSearch(restaurants=matches, location_applied=origin is not None)

def get_menu(restaurant_id: str, version: str | None = None) -> RestaurantMenu:
    entry = catalog().get(restaurant_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Restaurant not found. Choose a restaurant from search.")
    menu = entry[0]
    if version is not None and version != menu.version:
        raise HTTPException(status_code=409, detail="This menu has changed. Return to the full menu before requesting new picks.")
    return menu

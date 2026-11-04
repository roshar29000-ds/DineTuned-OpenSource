import os
from typing import Annotated
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from .recommend import recommend
from .schemas import (Capabilities, MenuEvaluation, MenuEvaluationRequest, RecommendationRequest,
                      RecommendationSession, RestaurantMenu, RestaurantSearch, TasteAnswers, TasteProfile)
from .services.catalog import get_menu
from .services.eligibility import evaluate_menu
from .services.taste import guided_profile
from .persistence.config import PersistenceError
from .persistence.routes import router as memory_router
from .discovery.routes import router as discovery_router
from .discovery.config import DiscoveryError
from .discovery.providers import DemoRestaurantDiscoveryProvider
from .menu_sources.routes import router as menu_sources_router
from .menu_extraction.routes import router as menu_extraction_router
from .real_picks.routes import router as real_picks_router

load_dotenv()
app = FastAPI(title="DineTuned API", version="2.0.0", description="Fictional demo menus plus bounded real-menu discovery and user-supplied text extraction; live Meta inference remains disabled by default.")
origins = [x.strip() for x in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Content-Type", "Authorization"])
app.include_router(memory_router)
app.include_router(discovery_router)
app.include_router(menu_sources_router)
app.include_router(menu_extraction_router)
app.include_router(real_picks_router)


@app.exception_handler(DiscoveryError)
async def discovery_error(_request, error: DiscoveryError):
    return JSONResponse(status_code=error.status, content={"detail": str(error)}, headers={"Cache-Control": "private, no-store", "Vary": "Authorization"})


@app.exception_handler(PersistenceError)
async def persistence_error(_request, error: PersistenceError):
    return JSONResponse(status_code=error.status, content={"detail": str(error)}, headers={"Cache-Control": "private, no-store", "Vary": "Authorization"})


@app.middleware("http")
async def private_memory_limits(request, call_next):
    if request.url.path.startswith(("/api/v2/memory/", "/api/v2/discovery/", "/api/v2/menu-sources/", "/api/v2/menu-extraction/", "/api/v2/real-picks/")):
        limit = 4200000 if request.url.path == "/api/v2/menu-extraction/upload" else 1048576 if request.url.path.startswith("/api/v2/real-picks/") else 16384 if request.url.path.startswith("/api/v2/menu-sources/") else 4096 if request.url.path.startswith("/api/v2/discovery/") else 131072
        if len(await request.body()) > limit:
            return JSONResponse(status_code=413, content={"detail": "The request is too large."}, headers={"Cache-Control": "private, no-store"})
        response = await call_next(request)
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["Vary"] = "Authorization"
        return response
    return await call_next(request)


@app.exception_handler(RequestValidationError)
async def invalid_request(_request, error: RequestValidationError):
    # Do not echo personal inputs; non-finite input values must not break JSON errors.
    detail = [{"loc": item["loc"], "msg": item["msg"], "type": item["type"]} for item in error.errors()]
    return JSONResponse(status_code=422, content={"detail": detail})

@app.get("/api/health", response_model=Capabilities)
@app.get("/api/v2/health", response_model=Capabilities)
def health():
    return Capabilities()

@app.get("/api/restaurants", response_model=RestaurantSearch, deprecated=True)
@app.get("/api/v2/restaurants", response_model=RestaurantSearch)
def restaurants(q: Annotated[str, Query(max_length=100)] = "",
                latitude: Annotated[float | None, Query(ge=-90, le=90, allow_inf_nan=False)] = None,
                longitude: Annotated[float | None, Query(ge=-180, le=180, allow_inf_nan=False)] = None):
    if (latitude is None) != (longitude is None):
        raise HTTPException(status_code=422, detail="Provide both latitude and longitude, or neither.")
    return DemoRestaurantDiscoveryProvider.search_catalog(q, latitude, longitude)

@app.get("/api/v2/restaurants/{restaurant_id}/menu", response_model=RestaurantMenu)
def restaurant_menu(restaurant_id: str):
    return get_menu(restaurant_id)

@app.post("/api/v2/menu/evaluate", response_model=MenuEvaluation)
def menu_evaluation(req: MenuEvaluationRequest):
    return evaluate_menu(get_menu(req.restaurant_id, req.menu_version), req.constraints)

@app.post("/api/taste/profile", response_model=TasteProfile, deprecated=True)
@app.post("/api/v2/taste/profile", response_model=TasteProfile)
def taste(req: TasteAnswers):
    if not req.favorites.strip():
        raise HTTPException(status_code=422, detail="Tell us at least one food you enjoy.")
    return guided_profile(req)

@app.post("/api/recommendations", response_model=RecommendationSession, deprecated=True)
@app.post("/api/v2/recommendation-sessions", response_model=RecommendationSession)
def recommendations(req: RecommendationRequest):
    return recommend(req)

# The legacy adapter is retained for a later authenticated integration.
# General-purpose paid inference is not exposed by this application.

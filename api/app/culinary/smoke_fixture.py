"""Existing fictional menu and synthetic profile; never a real user's data."""
import httpx
from ..schemas import DiningConstraints, RecommendationRequest, TasteProfile, TasteAxes, RecommendationTasteEvidence
from ..services.catalog import get_menu
from .context import build_context
from .demo import DemoCulinaryProvider
from ..usage_budget import MODEL


def smoke_context():
    # The guarded developer smoke path is intentionally capped at eight items.
    # The consumer demo has twenty; keep this synthetic context on its original
    # four dishes without changing the public menu or model request bound.
    menu = get_menu("casa-sol").model_copy(deep=True)
    original = {'birria', 'mushroom-taco', 'elote', 'chicken-tinga'}
    for category in menu.categories:
        category.items = [item for item in category.items if item.id in original]
    menu.categories = [category for category in menu.categories if category.items]
    menu.total_items = 4
    request = RecommendationRequest(restaurant_id=menu.restaurant.id, menu_version=menu.version,
        constraints=DiningConstraints(max_price_minor=2000),
        profile=TasteProfile(complete=True, favorites="Grilled chicken; smoky, charred food. I dislike creamy sauces and cheese.",
            axes=TasteAxes(spice=.5, richness=.35, freshness=.65, crunch=.6, aromatic=.65)),
        taste_evidence=RecommendationTasteEvidence(cooking_methods=["grilled"], textures=["tender"],
            disliked_ingredients=["cheese"]))
    return build_context(request, menu)


def mock_transport(context):
    # Deliberately labeled fixture, not a prediction of Meta's culinary judgment.
    proposal = DemoCulinaryProvider().propose(context).proposal.model_dump(mode="json")
    def respond(request):
        import json
        return httpx.Response(200, json={"id": "mock-offline", "object": "chat.completion", "created": 0, "model": MODEL,
            "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": json.dumps(proposal)}}],
            "usage": {"prompt_tokens": 1000, "completion_tokens": 300, "total_tokens": 1300}}, request=request)
    return httpx.MockTransport(respond)

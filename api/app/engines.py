"""Future engine boundaries. No live inference, parsing, or learning is wired here."""
from typing import Literal, Protocol, TYPE_CHECKING
from .schemas import BridgeProposal, MealPairingProposal, MealFeedback, RecommendationRequest, RecommendationSession, RestaurantMenu, TasteAnswers, TasteProfile
if TYPE_CHECKING:
    from .tastebridge.context import BridgeContext
    from .pairing.context import PairingContext

class TasteDetectiveEngine(Protocol):
    def build_profile(self, answers: TasteAnswers) -> TasteProfile: ...

class RecommendationEngine(Protocol):
    def recommend(self, request: RecommendationRequest) -> RecommendationSession: ...

class TasteBridgeEngine(Protocol):
    name: str
    def propose(self, context: "BridgeContext") -> BridgeProposal | None: ...

class MealPairingEngine(Protocol):
    name: str
    mode: Literal["demo", "model"]
    def propose(self, context: "PairingContext") -> list[MealPairingProposal]: ...

class MenuIntelligenceEngine(Protocol):
    async def ingest(self, source_id: str) -> RestaurantMenu: ...

class LearningEngine(Protocol):
    def observe(self, profile: TasteProfile, feedback: MealFeedback) -> TasteProfile: ...

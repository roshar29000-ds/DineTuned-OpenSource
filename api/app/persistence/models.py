"""Reuse Taste DNA/feedback contracts; storage records never imply AI verification."""
from typing import Annotated, Literal
from uuid import UUID
from pydantic import AwareDatetime, Field, model_validator
from ..schemas import (Contract, TasteProfile, RecommendationTasteEvidence, MealFeedback,
    AllergyProfile, DietaryRestriction, Identifier, SensoryAxis, Price)

Count = Annotated[int, Field(strict=True, ge=1, le=2147483647)]


class DetectiveChoicesSnapshot(Contract):
    anchors: list[Identifier] = Field(max_length=6)
    reasons: list[Identifier] = Field(max_length=6)
    contrast: list[Identifier] = Field(max_length=1)
    heat: list[Identifier] = Field(max_length=1)
    texture: list[Identifier] = Field(max_length=4)
    aromatics: list[Identifier] = Field(max_length=1)
    ingredients: list[Identifier] = Field(max_length=8)
    avoids: list[Identifier] = Field(max_length=8)
    cooking: list[Identifier] = Field(max_length=6)
    curiosity: list[Identifier] = Field(max_length=1)


class DetectiveAnswersSnapshot(Contract):
    choices: DetectiveChoicesSnapshot
    dietary_restrictions: list[DietaryRestriction] = Field(max_length=7)
    allergies: AllergyProfile


class DetectiveSnapshot(Contract):
    version: Literal[3]
    engine: Literal["deterministic-v3.1"]
    answers: DetectiveAnswersSnapshot
    savedAt: AwareDatetime


class TasteDocument(Contract):
    profile: TasteProfile
    evidence: RecommendationTasteEvidence
    detective: DetectiveSnapshot | None
    edited_axes: list[SensoryAxis] = Field(max_length=7)
    exploration_edited: bool = Field(strict=True)


class TasteBackupWrite(Contract):
    document: TasteDocument
    # null means create-only; a revision is required to replace an existing row.
    expected_revision: Count | None


class MemoryIdentity(Contract):
    user_id: UUID
    is_anonymous: bool
    storage: Literal["supabase"] = "supabase"


class PrivateRecord(Contract):
    id: UUID
    user_id: UUID
    created_at: AwareDatetime
    updated_at: AwareDatetime
    source: Literal["user_reported"]


class TasteBackupRecord(PrivateRecord):
    document: TasteDocument
    revision: Count


class TasteBackupResult(Contract):
    profile: TasteBackupRecord | None


class DiningEventWrite(Contract):
    id: UUID
    event_type: Literal["saved", "selected", "ordered", "tasted"]
    restaurant_id: Identifier
    menu_version: Identifier
    dish_id: Identifier
    occurred_at: AwareDatetime
    recommendation_id: UUID | None
    restaurant_name: str | None = Field(default=None, min_length=1, max_length=200)
    dish_name: str | None = Field(default=None, min_length=1, max_length=200)


class DiningEventRecord(PrivateRecord, DiningEventWrite):
    revision: Count = 1


FeedbackTag = Literal["too_spicy", "not_spicy_enough", "too_rich", "too_heavy", "great_texture", "disliked_texture", "would_order_again"]


class DishFeedbackWrite(Contract):
    id: UUID
    event_id: UUID | None
    feedback: MealFeedback
    rating: Annotated[int, Field(strict=True, ge=1, le=5)] | None
    tags: list[FeedbackTag] = Field(max_length=7)


class DishFeedbackRecord(PrivateRecord, DishFeedbackWrite):
    revision: Count = 1


class HistoryDish(Contract):
    id: Identifier
    name: str = Field(min_length=1, max_length=200)
    category_id: Identifier
    price: Price


class RecommendationHistoryWrite(Contract):
    id: UUID
    session_id: str = Field(min_length=1, max_length=100)
    restaurant_id: Identifier
    menu_version: Identifier
    dishes: list[HistoryDish] = Field(max_length=5)
    reported_provider: str = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_dishes(self):
        if len({dish.id for dish in self.dishes}) != len(self.dishes):
            raise ValueError("History contains duplicate dish IDs")
        return self


class RecommendationHistoryRecord(PrivateRecord, RecommendationHistoryWrite):
    pass


class DiningEventList(Contract):
    records: list[DiningEventRecord] = Field(max_length=50)


class DishFeedbackList(Contract):
    records: list[DishFeedbackRecord] = Field(max_length=50)


class RecommendationHistoryList(Contract):
    records: list[RecommendationHistoryRecord] = Field(max_length=50)


class DiningEventCorrection(Contract):
    expected_revision: Count
    event_type: Literal["saved", "selected", "ordered", "tasted"]


class FeedbackCorrection(Contract):
    expected_revision: Count
    liked: bool = Field(strict=True)
    note: str = Field(max_length=1000)
    rating: Annotated[int, Field(strict=True, ge=1, le=5)] | None
    tags: list[FeedbackTag] = Field(max_length=7)


class RecordDeletion(Contract):
    id: UUID
    deleted: Literal[True] = True


class HistoricalTasteEvidence(Contract):
    """Original reported observations, never an inferred preference or training claim."""
    feedback: DishFeedbackRecord
    event: DiningEventRecord | None
    recommendation: RecommendationHistoryRecord | None
    consumption_confirmed: bool
    uncertainty: list[str]


class HistoricalTasteEvidenceList(Contract):
    records: list[HistoricalTasteEvidence] = Field(max_length=50)
    interpretation: Literal["uninterpreted_user_reports"] = "uninterpreted_user_reports"

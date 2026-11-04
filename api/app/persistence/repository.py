"""Small user-scoped PostgREST repository. No privileged Supabase key is used."""
from typing import Protocol, TypeVar
from uuid import UUID
import httpx
from pydantic import ValidationError
from .auth import UserIdentity
from .config import SupabaseConfig, PersistenceError
from .models import (PrivateRecord, TasteBackupRecord, TasteBackupWrite, DiningEventRecord, DiningEventWrite,
    DishFeedbackRecord, DishFeedbackWrite, RecommendationHistoryRecord, RecommendationHistoryWrite,
    DiningEventCorrection, FeedbackCorrection, RecordDeletion, HistoricalTasteEvidence)

Record = TypeVar("Record", bound=PrivateRecord)


class MemoryRepository(Protocol):
    def get_profile(self) -> TasteBackupRecord | None: ...
    def save_profile(self, value: TasteBackupWrite) -> TasteBackupRecord: ...
    def events(self, offset: int = 0) -> list[DiningEventRecord]: ...
    def feedback(self, offset: int = 0) -> list[DishFeedbackRecord]: ...
    def history(self, offset: int = 0) -> list[RecommendationHistoryRecord]: ...
    def add_event(self, value: DiningEventWrite) -> DiningEventRecord: ...
    def add_feedback(self, value: DishFeedbackWrite) -> DishFeedbackRecord: ...
    def add_history(self, value: RecommendationHistoryWrite) -> RecommendationHistoryRecord: ...
    def correct_event(self, identifier: UUID, value: DiningEventCorrection) -> DiningEventRecord: ...
    def correct_feedback(self, identifier: UUID, value: FeedbackCorrection) -> DishFeedbackRecord: ...
    def delete_record(self, resource: str, identifier: UUID, revision: int) -> RecordDeletion: ...
    def evidence(self, offset: int = 0, restaurant_id: str | None = None) -> list[HistoricalTasteEvidence]: ...


class SupabaseMemoryRepository:
    def __init__(self, client: httpx.Client, config: SupabaseConfig, user: UserIdentity):
        self.client, self.config, self.user = client, config, user

    def _request(self, method: str, table: str, model: type[Record], *, params: dict | None = None, body: dict | None = None) -> list[Record]:
        # Inserts obtain ownership from auth.uid() + WITH CHECK in PostgreSQL.
        # Read/update filters use the independently verified principal.
        query = {**({"user_id": f"eq.{self.user.user_id}"} if method != "POST" else {}), **(params or {})}
        headers = {"apikey": self.config.publishable_key, "Authorization": f"Bearer {self.user.access_token}",
            "Prefer": "return=representation", "Accept": "application/json"}
        try:
            response = self.client.request(method, self.config.url + "/rest/v1/" + table, params=query, json=body, headers=headers)
            if response.status_code in (401, 403):
                raise PersistenceError(401, "Your cloud session cannot access these records.")
            if response.status_code == 409:
                raise PersistenceError(409, "A record already exists or its reference changed. Refresh before saving again.")
            if response.status_code not in (200, 201):
                raise PersistenceError(503, "Cloud storage is unavailable. Check configuration and migrations; local records are unchanged.")
            data = response.json()
            if not isinstance(data, list) or len(data) > 50:
                raise ValueError("Unexpected rows")
            records = [model.model_validate(row) for row in data]
            if any(row.user_id != self.user.user_id for row in records):
                raise ValueError("Ownership mismatch")
            return records
        except (httpx.HTTPError, ValidationError, ValueError, TypeError):
            raise PersistenceError(503, "The cloud operation could not be confirmed. Refresh cloud status before trying again.") from None

    def get_profile(self) -> TasteBackupRecord | None:
        records = self._request("GET", "taste_profiles", TasteBackupRecord, params={"limit": 2})
        if len(records) > 1:
            raise PersistenceError(503, "The cloud profile could not be verified.")
        return records[0] if records else None

    def save_profile(self, value: TasteBackupWrite) -> TasteBackupRecord:
        # No upsert: a new guest/local profile can never silently replace an old
        # cloud profile, and concurrent editors must acknowledge the latest row.
        body = {"document": value.document.model_dump(mode="json")}
        method = "POST" if value.expected_revision is None else "PATCH"
        params = {} if value.expected_revision is None else {"revision": f"eq.{value.expected_revision}"}
        records = self._request(method, "taste_profiles", TasteBackupRecord, body=body, params=params)
        if len(records) != 1:
            raise PersistenceError(409, "Your cloud profile changed. Refresh its status before replacing the backup.")
        return records[0]

    def _list(self, table: str, model: type[Record], offset: int) -> list[Record]:
        if not 0 <= offset <= 10000:
            raise PersistenceError(422, "Invalid history offset.")
        return self._request("GET", table, model, params={"limit": 50, "offset": offset, "order": "created_at.desc,id.desc"})

    def events(self, offset: int = 0) -> list[DiningEventRecord]:
        return self._list("dining_events", DiningEventRecord, offset)

    def feedback(self, offset: int = 0) -> list[DishFeedbackRecord]:
        return self._list("dish_feedback", DishFeedbackRecord, offset)

    def history(self, offset: int = 0) -> list[RecommendationHistoryRecord]:
        return self._list("recommendation_history", RecommendationHistoryRecord, offset)

    def _insert(self, table: str, model: type[Record], value) -> Record:
        try:
            rows = self._request("POST", table, model, body=value.model_dump(mode="json"))
        except PersistenceError as error:
            if error.status != 409:
                raise
            # A lost HTTP acknowledgement may be retried with the SAME UUID and
            # payload. Never upsert: mismatching content remains a conflict.
            rows = self._request("GET", table, model, params={"id": f"eq.{value.id}", "limit": 1})
            def intent(item):
                data = item.model_dump(mode="json", include=set(type(value).model_fields))
                # Duplicate tabs can record the same action milliseconds apart.
                # These immutable IDs describe one action, never a new meal.
                data.pop("occurred_at", None)
                if "feedback" in data:
                    data["feedback"].pop("date", None)
                return data
            if len(rows) != 1 or intent(rows[0]) != intent(value):
                raise error
        if len(rows) != 1:
            raise PersistenceError(503, "The cloud save could not be confirmed. Check status before saving again.")
        return rows[0]

    def _linked(self, table: str, model: type[Record], identifier: UUID) -> Record:
        rows = self._request("GET", table, model, params={"id": f"eq.{identifier}", "limit": 1})
        if not rows:
            raise PersistenceError(422, "The linked dining record is unavailable.")
        return rows[0]

    def add_event(self, value: DiningEventWrite) -> DiningEventRecord:
        if value.recommendation_id:
            parent = self._linked("recommendation_history", RecommendationHistoryRecord, value.recommendation_id)
            if (parent.restaurant_id, parent.menu_version) != (value.restaurant_id, value.menu_version) or value.dish_id not in {d.id for d in parent.dishes}:
                raise PersistenceError(422, "The event does not match its recommendation provenance.")
        return self._insert("dining_events", DiningEventRecord, value)

    def add_feedback(self, value: DishFeedbackWrite) -> DishFeedbackRecord:
        if value.event_id:
            parent = self._linked("dining_events", DiningEventRecord, value.event_id)
            if (parent.restaurant_id, parent.menu_version, parent.dish_id) != (value.feedback.restaurant_id, value.feedback.menu_version, value.feedback.dish_id):
                raise PersistenceError(422, "The feedback does not match its dining event.")
        return self._insert("dish_feedback", DishFeedbackRecord, value)

    def add_history(self, value: RecommendationHistoryWrite) -> RecommendationHistoryRecord:
        return self._insert("recommendation_history", RecommendationHistoryRecord, value)

    def _correct(self, table, model, identifier, revision, body):
        rows = self._request("PATCH", table, model, params={"id": f"eq.{identifier}", "revision": f"eq.{revision}"}, body=body)
        if len(rows) != 1:
            raise PersistenceError(409, "This dining record changed. Refresh before correcting it.")
        return rows[0]

    def correct_event(self, identifier: UUID, value: DiningEventCorrection) -> DiningEventRecord:
        return self._correct("dining_events", DiningEventRecord, identifier, value.expected_revision, {"event_type": value.event_type})

    def correct_feedback(self, identifier: UUID, value: FeedbackCorrection) -> DishFeedbackRecord:
        old = self._linked("dish_feedback", DishFeedbackRecord, identifier)
        feedback = old.feedback.model_copy(update={"liked": value.liked, "note": value.note})
        return self._correct("dish_feedback", DishFeedbackRecord, identifier, value.expected_revision,
            {"feedback": feedback.model_dump(mode="json"), "rating": value.rating, "tags": value.tags})

    def delete_record(self, resource: str, identifier: UUID, revision: int) -> RecordDeletion:
        table, model = {"events": ("dining_events", DiningEventRecord), "feedback": ("dish_feedback", DishFeedbackRecord)}[resource]
        rows = self._request("DELETE", table, model, params={"id": f"eq.{identifier}", "revision": f"eq.{revision}"})
        if not rows and self._request("GET", table, model, params={"id": f"eq.{identifier}", "limit": 1}):
            raise PersistenceError(409, "This dining record changed. Refresh before deleting it.")
        return RecordDeletion(id=identifier)

    def evidence(self, offset: int = 0, restaurant_id: str | None = None) -> list[HistoricalTasteEvidence]:
        params = {"limit": 50, "offset": offset, "order": "created_at.desc,id.desc"}
        if restaurant_id:
            params["feedback->>restaurant_id"] = f"eq.{restaurant_id}"
        ratings = self._request("GET", "dish_feedback", DishFeedbackRecord, params=params)
        event_ids = {str(row.event_id) for row in ratings if row.event_id}
        events = self._request("GET", "dining_events", DiningEventRecord,
            params={"id": "in.(" + ",".join(sorted(event_ids)) + ")", "limit": 50}) if event_ids else []
        history_ids = {str(row.recommendation_id) for row in events if row.recommendation_id}
        history = self._request("GET", "recommendation_history", RecommendationHistoryRecord,
            params={"id": "in.(" + ",".join(sorted(history_ids)) + ")", "limit": 50}) if history_ids else []
        by_event, by_history = {row.id: row for row in events}, {row.id: row for row in history}
        result = []
        for rating in ratings:
            event = by_event.get(rating.event_id)
            if event and (event.restaurant_id, event.menu_version, event.dish_id) != (rating.feedback.restaurant_id, rating.feedback.menu_version, rating.feedback.dish_id):
                event = None
            recommendation = by_history.get(event.recommendation_id) if event else None
            if recommendation and ((recommendation.restaurant_id, recommendation.menu_version) != (event.restaurant_id, event.menu_version)
                    or event.dish_id not in {dish.id for dish in recommendation.dishes}):
                recommendation = None
            consumed = bool(event and event.event_type == "tasted")
            uncertainty = ["User-reported experience; no model interpretation or restaurant verification."]
            if not consumed: uncertainty.append("Consumption was not explicitly confirmed by a linked tried-dish event.")
            if not recommendation: uncertainty.append("Recommendation provenance is unavailable.")
            result.append(HistoricalTasteEvidence(feedback=rating, event=event, recommendation=recommendation,
                consumption_confirmed=consumed, uncertainty=uncertainty))
        return result

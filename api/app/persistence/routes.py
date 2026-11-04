from typing import Annotated
from uuid import UUID
import httpx
from fastapi import APIRouter, Depends, Header, Query, Response
from .auth import UserIdentity, verify_user
from .config import SupabaseConfig
from .repository import MemoryRepository, SupabaseMemoryRepository
from .models import (MemoryIdentity, TasteBackupWrite, TasteBackupRecord, TasteBackupResult,
    DiningEventWrite, DiningEventRecord, DiningEventList, DishFeedbackWrite, DishFeedbackRecord,
    DishFeedbackList, RecommendationHistoryWrite, RecommendationHistoryRecord, RecommendationHistoryList,
    DiningEventCorrection, FeedbackCorrection, RecordDeletion, HistoricalTasteEvidenceList)
from ..schemas import Identifier


def private_response(response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Vary"] = "Authorization"


router = APIRouter(prefix="/api/v2/memory", tags=["Private memory"], dependencies=[Depends(private_response)])


def get_config() -> SupabaseConfig:
    return SupabaseConfig.from_environment()


def get_client():
    with httpx.Client(timeout=10, follow_redirects=False, trust_env=False, transport=httpx.HTTPTransport(retries=0)) as client:
        yield client


def get_user(authorization: Annotated[str | None, Header()] = None, config: SupabaseConfig = Depends(get_config),
             client: httpx.Client = Depends(get_client)) -> UserIdentity:
    return verify_user(client, config, authorization)


def get_repository(user: UserIdentity = Depends(get_user), config: SupabaseConfig = Depends(get_config),
                   client: httpx.Client = Depends(get_client)) -> MemoryRepository:
    return SupabaseMemoryRepository(client, config, user)


Repo = Annotated[MemoryRepository, Depends(get_repository)]
Offset = Annotated[int, Query(ge=0, le=10000)]


@router.get("/identity", response_model=MemoryIdentity)
def identity(user: UserIdentity = Depends(get_user)):
    return MemoryIdentity(user_id=user.user_id, is_anonymous=user.is_anonymous)


@router.get("/profile", response_model=TasteBackupResult)
def profile(repo: Repo):
    return TasteBackupResult(profile=repo.get_profile())


@router.post("/profile", response_model=TasteBackupRecord)
def save_profile(value: TasteBackupWrite, repo: Repo):
    return repo.save_profile(value)


@router.get("/events", response_model=DiningEventList)
def events(repo: Repo, offset: Offset = 0):
    return DiningEventList(records=repo.events(offset))


@router.post("/events", response_model=DiningEventRecord, status_code=201)
def add_event(value: DiningEventWrite, repo: Repo):
    return repo.add_event(value)


@router.get("/feedback", response_model=DishFeedbackList)
def feedback(repo: Repo, offset: Offset = 0):
    return DishFeedbackList(records=repo.feedback(offset))


@router.post("/feedback", response_model=DishFeedbackRecord, status_code=201)
def add_feedback(value: DishFeedbackWrite, repo: Repo):
    return repo.add_feedback(value)


@router.get("/history", response_model=RecommendationHistoryList)
def history(repo: Repo, offset: Offset = 0):
    return RecommendationHistoryList(records=repo.history(offset))


@router.post("/history", response_model=RecommendationHistoryRecord, status_code=201)
def add_history(value: RecommendationHistoryWrite, repo: Repo):
    return repo.add_history(value)


@router.patch("/events/{identifier}", response_model=DiningEventRecord)
def correct_event(identifier: UUID, value: DiningEventCorrection, repo: Repo):
    return repo.correct_event(identifier, value)


@router.patch("/feedback/{identifier}", response_model=DishFeedbackRecord)
def correct_feedback(identifier: UUID, value: FeedbackCorrection, repo: Repo):
    return repo.correct_feedback(identifier, value)


@router.delete("/events/{identifier}", response_model=RecordDeletion)
def delete_event(identifier: UUID, expected_revision: Annotated[int, Query(ge=1)], repo: Repo):
    return repo.delete_record("events", identifier, expected_revision)


@router.delete("/feedback/{identifier}", response_model=RecordDeletion)
def delete_feedback(identifier: UUID, expected_revision: Annotated[int, Query(ge=1)], repo: Repo):
    return repo.delete_record("feedback", identifier, expected_revision)


@router.get("/evidence", response_model=HistoricalTasteEvidenceList)
def evidence(repo: Repo, offset: Offset = 0, restaurant_id: Identifier | None = None):
    return HistoricalTasteEvidenceList(records=repo.evidence(offset, restaurant_id))

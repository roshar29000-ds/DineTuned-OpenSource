import httpx
from fastapi import APIRouter, Depends
from ..discovery.config import DiscoveryError
from ..persistence.routes import get_user, private_response
from ..persistence.auth import UserIdentity
from ..menu_sources.routes import get_proof, get_limits
from ..menu_sources.identity import SelectionProof
from ..menu_sources.limits import SourceJobLimits
from ..menu_sources.network import PublicWebTransport
from .authorization import ExtractionPermit
from ..real_picks.authorization import MenuSnapshotPermit
from .models import MenuExtractionRequest, MenuExtractionResult, MenuUploadRequest, ExtractionIssue
from .pipeline import MenuExtractionPipeline, ExtractionFetcher
from .upload import extract_uploaded_menu
from ..real_picks.table_store import GuestTableStore, get_table_store
from ..culinary.errors import CulinaryError

router = APIRouter(prefix='/api/v2/menu-extraction', tags=['Menu extraction'], dependencies=[Depends(private_response)])


def get_pipeline():
    with httpx.Client(transport=PublicWebTransport(), timeout=4, follow_redirects=False, trust_env=False) as client:
        yield MenuExtractionPipeline(ExtractionFetcher(client))


@router.post('/extract', response_model=MenuExtractionResult)
def extract(request: MenuExtractionRequest, user: UserIdentity = Depends(get_user), proof: SelectionProof = Depends(get_proof),
            limits: SourceJobLimits = Depends(get_limits), pipeline: MenuExtractionPipeline = Depends(get_pipeline),
            store: GuestTableStore = Depends(get_table_store)):
    proof.verify(request.selection_token, request.restaurant, user.user_id)
    ExtractionPermit(proof).verify(request.restaurant, request.sources, user.user_id)
    if request.restaurant.business_status == 'CLOSED_PERMANENTLY':
        raise DiscoveryError(409, 'Extraction is unavailable for a restaurant reported permanently closed.')
    eligible = {c.id for c in request.sources.candidates if c.suitable_for_extraction and c.access == 'checked'
                and c.branch_relevance == 'exact' and c.freshness != 'outdated' and c.menu_type in ('dine_in', 'unknown')}
    if not eligible or len(set(request.candidate_ids)) != len(request.candidate_ids) or not set(request.candidate_ids) <= eligible:
        raise DiscoveryError(422, 'Choose only distinct, corroborated menu sources from this verified discovery result.')
    limits.reserve(user.user_id, request.request_id)
    try:
        result = pipeline.extract(request)
        result.recommendation_token = MenuSnapshotPermit(proof).issue(result, user.user_id)
        try: store.save_extraction(user.user_id, request.restaurant, request.selection_token, result)
        except CulinaryError:
            result.menu.issues.append(ExtractionIssue(code='table_backup_unavailable', severity='notice',
                message='This menu could not be backed up across tabs. Keep this tab open.'))
            result.recommendation_token = MenuSnapshotPermit(proof).issue(result, user.user_id)
        return result
    finally: limits.finish(request.request_id)


@router.post('/upload', response_model=MenuExtractionResult)
def upload(request: MenuUploadRequest, user: UserIdentity = Depends(get_user), proof: SelectionProof = Depends(get_proof),
           limits: SourceJobLimits = Depends(get_limits), store: GuestTableStore = Depends(get_table_store)):
    # The branch is still a verified Google selection; the document itself is
    # explicitly user-supplied and never promoted to official-site provenance.
    proof.verify(request.selection_token, request.restaurant, user.user_id, grace_seconds=23 * 3600)
    if request.restaurant.business_status == 'CLOSED_PERMANENTLY':
        raise DiscoveryError(409, 'An uploaded menu cannot be associated with a permanently closed restaurant.')
    limits.reserve_upload(user.user_id, request.request_id)
    try:
        result = extract_uploaded_menu(request)
        result.recommendation_token = MenuSnapshotPermit(proof).issue(result, user.user_id)
        try: store.save_extraction(user.user_id, request.restaurant, request.selection_token, result)
        except CulinaryError:
            result.menu.issues.append(ExtractionIssue(code='table_backup_unavailable', severity='notice',
                message='This menu could not be backed up across tabs. Keep this tab open.'))
            result.recommendation_token = MenuSnapshotPermit(proof).issue(result, user.user_id)
        return result
    finally:
        limits.finish_upload(request.request_id)

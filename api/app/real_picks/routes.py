from collections import Counter
import logging
import os
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from ..persistence.routes import get_user, get_repository, private_response, Repo
from ..persistence.auth import UserIdentity
from ..menu_sources.routes import get_proof
from ..menu_sources.identity import SelectionProof
from ..culinary.errors import CulinaryError
from .authorization import MenuSnapshotPermit
from .models import RealPicksRequest, RealPicksResult, RealPicksCapability
from .provider import DisabledRealProvider
from .production_gate import ProductionPolicy, ProductionRealProvider
from .pipeline import recommend
from .memory import load_memory
from .illustrations import ImagePolicy, ImageStore, generate_prepared_images
from .table_store import GuestTableStore, GuestTableSnapshot, ClearGuestTable, get_table_store

router = APIRouter(prefix='/api/v2/real-picks', tags=['Real menu Picks'], dependencies=[Depends(private_response)])


def _local_technical_mode(request: Request) -> bool:
    return (request.client is not None and request.client.host in {'127.0.0.1', '::1'}
            and request.url.hostname in {'127.0.0.1', 'localhost'}
            and os.getenv('DINETUNED_LOCAL_TECHNICAL_TEST') == 'true'
            and os.getenv('DINETUNED_VALIDATION_PHASE_ENABLED') == 'true')


def get_provider(request: Request, user: UserIdentity = Depends(get_user)):
    # Key presence alone never authorizes spending. All owner approval, per-guest
    # idempotency, the private cache and the cumulative ledger must be configured.
    try:
        policy = ProductionPolicy.from_environment()
    except CulinaryError:
        policy = None
    if not policy:
        return DisabledRealProvider()
    if _local_technical_mode(request):
        from ..usage_budget import UsageBudget
        from .production_gate import MILESTONE
        from .live_gate import TechnicalTestMetaProvider
        budget = UsageBudget(extra_limits={MILESTONE: (policy.cap_usd, policy.max_attempts)})
        return ProductionRealProvider(user.user_id, policy, budget=budget,
            delegate=TechnicalTestMetaProvider(milestone=MILESTONE, budget=budget))
    return ProductionRealProvider(user.user_id, policy)


def get_capability():
    try:
        ready = ProductionPolicy.from_environment() is not None
    except CulinaryError:
        ready = False
    technical = ready and os.getenv('DINETUNED_LOCAL_TECHNICAL_TEST') == 'true' and os.getenv('DINETUNED_VALIDATION_PHASE_ENABLED') == 'true'
    return RealPicksCapability(available=ready, mode='meta' if ready else 'disabled',
        message=('TECHNICAL TEST ONLY · No-beef and no-pork suitability may be unverified for an authenticated local guest who selected both. Explicitly named beef/pork dishes and allergy conflicts remain excluded; confirm ingredients with staff.' if technical
            else 'Muse Spark Picks are available for authenticated guests within the owner-approved limits.' if ready
            else 'Real-menu Meta Picks are prepared but live requests are disabled pending explicit approval. The full menu remains available.'))


def get_request_policy(request: Request):
    # An explicitly configured, loopback-only validation mode. Production keeps
    # hard dietary rules; this mode never changes the guest's saved Taste DNA.
    if _local_technical_mode(request):
        from .live_gate import LocalValidationDietPolicy
        return LocalValidationDietPolicy()
    return None


def _diagnose(result: RealPicksResult) -> None:
    """Runner-only counts; never log a profile, dish, prompt, token, or model body."""
    if os.getenv('DINETUNED_REAL_PICKS_DIAGNOSTICS') != '1':
        return
    reasons = Counter(reason for exclusion in result.exclusions for reason in exclusion.reasons)
    logging.getLogger('uvicorn.error').warning(
        'real-picks result status=%s mode=%s error_code=%s picks=%d exclusions=%s',
        result.status, result.mode, result.error_code, len(result.recommendations), dict(reasons))


@router.get('/config', response_model=RealPicksCapability)
def config(capability: RealPicksCapability = Depends(get_capability)): return capability


@router.get('/table', response_model=GuestTableSnapshot)
def table_snapshot(user: UserIdentity = Depends(get_user), proof: SelectionProof = Depends(get_proof),
                   store: GuestTableStore = Depends(get_table_store)):
    try: return store.load(user.user_id, proof)
    except CulinaryError as error: raise HTTPException(status_code=503, detail=str(error)) from None


@router.post('/table/clear')
def clear_table(request: ClearGuestTable, user: UserIdentity = Depends(get_user),
                store: GuestTableStore = Depends(get_table_store)):
    try: store.clear_if_selected(user.user_id, request.selection_token)
    except CulinaryError as error: raise HTTPException(status_code=503, detail=str(error)) from None
    return {'cleared': True}


@router.post('/sessions', response_model=RealPicksResult)
def create(request: RealPicksRequest, repo: Repo, background: BackgroundTasks, user: UserIdentity = Depends(get_user),
           proof: SelectionProof = Depends(get_proof), provider=Depends(get_provider),
           policy=Depends(get_request_policy), store: GuestTableStore = Depends(get_table_store)):
    try:
        MenuSnapshotPermit(proof).verify(request.extraction, user.user_id)
        if isinstance(provider, DisabledRealProvider):
            return recommend(request, provider)
        working = policy.prepare(request) if policy else request
        memory, warning = load_memory(repo, user.user_id)
        result = recommend(working, provider, memory=memory, memory_warning=warning)
        _diagnose(result)
        result = policy.label(result) if policy else result
        if result.mode in ('meta', 'mock'):
            try: store.save_picks(user.user_id, request, result)
            except CulinaryError:
                result.limitations.append('This selection could not be backed up. Keep this tab open until the table is available again.')
        image_policy = ImagePolicy.from_environment()
        if image_policy and result.mode == 'meta' and result.status == 'ready':
            try:
                work = ImageStore().prepare(user.user_id, result)
                if work: background.add_task(generate_prepared_images, user.user_id, work, image_policy)
            except CulinaryError:
                pass  # Illustrations never suppress validated primary Picks.
        return result
    except CulinaryError as error:
        raise HTTPException(status_code=409 if error.code == 'invalid_menu_authorization' else 422, detail=str(error)) from None


@router.get('/illustrations/{context_digest}/{item_id}')
def illustration(context_digest: str, item_id: str, user: UserIdentity = Depends(get_user)):
    result = ImageStore().read(user.user_id, context_digest, item_id)
    if result and result[0] == 'ready' and result[1]:
        return Response(content=result[1], media_type='image/webp', headers={'Cache-Control': 'private, no-store', 'X-DineTuned-Illustration': 'muse-image-1.0'})
    if result and result[0] == 'pending':
        return Response(content='{"status":"pending"}', status_code=202, media_type='application/json', headers={'Cache-Control': 'private, no-store'})
    raise HTTPException(status_code=404, detail='No generated illustration is available for this Pick.')

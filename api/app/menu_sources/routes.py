import httpx
from fastapi import APIRouter, Depends
from ..discovery.config import DiscoveryError
from ..persistence.routes import get_user, private_response
from ..persistence.auth import UserIdentity
from .agent import MenuSourceDiscoveryProvider, PublicWebsiteMenuDiscovery
from .fetch import SourceFetcher
from .identity import SelectionProof
from .limits import SourceJobLimits
from .models import MenuSourceRequest, MenuSourceResult
from .network import PublicWebTransport
from .urls import source_url, SourceBlocked
from ..menu_extraction.authorization import ExtractionPermit

router = APIRouter(prefix="/api/v2/menu-sources", tags=["Menu source discovery"], dependencies=[Depends(private_response)])


def get_proof(): return SelectionProof.local()
def get_limits(): return SourceJobLimits()


def get_agent():
    with httpx.Client(transport=PublicWebTransport(), timeout=4, follow_redirects=False, trust_env=False) as client:
        yield PublicWebsiteMenuDiscovery(SourceFetcher(client))


@router.post("/discover", response_model=MenuSourceResult)
def discover(request: MenuSourceRequest, user: UserIdentity = Depends(get_user), proof: SelectionProof = Depends(get_proof),
             limits: SourceJobLimits = Depends(get_limits), agent: MenuSourceDiscoveryProvider = Depends(get_agent)):
    # An explicit, same-guest source check may use the original signed branch
    # snapshot for at most six hours after selection. This recovers a tab kept
    # open during menu review without another paid Places request. All other
    # proof checks retain the one-hour expiry.
    proof.verify(request.selection_token, request.restaurant, user.user_id, grace_seconds=5 * 3600)
    if request.restaurant.business_status == "CLOSED_PERMANENTLY":
        raise DiscoveryError(409, "This restaurant is reported permanently closed. Menu discovery is not available for this selection.")
    try: source_url(request.website_url)
    except SourceBlocked as error: raise DiscoveryError(422, str(error)) from None
    limits.reserve(user.user_id, request.request_id)
    try:
        result = agent.discover(request)
        result.extraction_token = ExtractionPermit(proof).issue(request.restaurant, result, user.user_id)
        return result
    finally:
        limits.finish(request.request_id)

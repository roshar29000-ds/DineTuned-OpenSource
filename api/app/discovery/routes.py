import httpx
from fastapi import APIRouter, Depends
from .config import PlacesConfig, DiscoveryError
from .models import DiscoveryConfig, DiscoverySearch, DiscoverySelection, DiscoverySession, DiscoveryResults, MenuDiscoveryHandoff
from .limits import DiscoveryLimits
from .providers import GooglePlacesProvider, RestaurantDiscoveryProvider
from ..persistence.routes import get_user, private_response
from ..persistence.auth import UserIdentity
from ..menu_sources.identity import SelectionProof
from ..real_picks.table_store import GuestTableStore, get_table_store
from ..culinary.errors import CulinaryError


router = APIRouter(prefix="/api/v2/discovery", tags=["Restaurant discovery"], dependencies=[Depends(private_response)])


def get_config():
    return PlacesConfig.from_environment()


def approved(config: PlacesConfig = Depends(get_config)):
    config.ready()
    return config


def get_limits(config: PlacesConfig = Depends(approved)):
    return DiscoveryLimits(config.usage_path, controlled_test_id=config.controlled_test_id,
                           extra_controlled_details=config.extra_controlled_details)


def get_provider(config: PlacesConfig = Depends(approved)):
    with httpx.Client(timeout=httpx.Timeout(6.0, connect=3.0), follow_redirects=False, trust_env=False,
                      transport=httpx.HTTPTransport(retries=0)) as client:
        yield GooglePlacesProvider(config, client)


@router.get("/config", response_model=DiscoveryConfig)
def configuration(config: PlacesConfig = Depends(get_config)):
    try:
        config.ready()
    except DiscoveryError as error:
        return DiscoveryConfig(google_enabled=False, message=str(error))
    return DiscoveryConfig(google_enabled=True, message="Real restaurant discovery uses Google Maps. Choose an exact branch, then review its website menu sources.")


@router.post("/sessions", response_model=DiscoverySession, dependencies=[Depends(approved)])
def session(user: UserIdentity = Depends(get_user), limits: DiscoveryLimits = Depends(get_limits)):
    return limits.start(user.user_id)


@router.post("/autocomplete", response_model=DiscoveryResults, dependencies=[Depends(approved)])
def autocomplete(value: DiscoverySearch, user: UserIdentity = Depends(get_user), limits: DiscoveryLimits = Depends(get_limits),
                 provider: RestaurantDiscoveryProvider = Depends(get_provider)):
    limits.reserve(user.user_id, value.session_token, "autocomplete")
    result = provider.autocomplete(value)
    limits.remember_ids(value.session_token, [p.place_id for p in result.predictions])
    return result


@router.post("/selection", response_model=MenuDiscoveryHandoff, dependencies=[Depends(approved)])
def selection(value: DiscoverySelection, user: UserIdentity = Depends(get_user), limits: DiscoveryLimits = Depends(get_limits),
              provider: RestaurantDiscoveryProvider = Depends(get_provider),
              store: GuestTableStore = Depends(get_table_store)):
    # Consume before the single Details attempt, even if the request fails or times out.
    limits.reserve(user.user_id, value.session_token, "details", value.place_id)
    result = provider.details(value)
    try:
        result.source_discovery_token = SelectionProof.local().issue(result.restaurant, user.user_id)
    except DiscoveryError:
        # A local signing problem must not suppress otherwise valid Places identity.
        result.limitations.append("Menu source verification is temporarily unavailable for this selection.")
    if result.source_discovery_token:
        try: store.save_selection(user.user_id, result)
        except CulinaryError:
            result.limitations.append('This branch could not be backed up. Keep this tab open until the table is available again.')
    return result

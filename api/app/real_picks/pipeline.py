from pydantic import ValidationError
from ..culinary.errors import CulinaryError
from .context import build_context
from .models import RealPicksResult
from .validation import validate_output


def recommend(request, provider, *, memory=(), memory_warning=None):
    context = build_context(request, memory, memory_warning)
    menu = context.request.extraction.menu
    base = dict(request_id=request.request_id, restaurant_id=menu.restaurant_id, menu_version=menu.version,
        context_digest=context.digest, recommendations=[], exclusions=list(context.exclusions), mode='not_run', model=None,
        limitations=['Based only on the selected extracted sources, not a verified complete or current restaurant menu.',
            'Prices are as printed, per dish, excluding tax, tip and fees. No currency conversion is performed.',
            'Reported Taste Memory is context, not trained model learning.',
            *(['The uploaded menu document is user-supplied; its official origin, branch association, freshness and availability are unverified.']
              if any(s.candidate.provenance == 'user_upload' for s in menu.sources) else []),
            *([memory_warning] if memory_warning else [])])
    if not context.eligible_ids:
        return RealPicksResult(**base, status='no_eligible_items', message='No dishes have enough verified price and restriction evidence for these preferences. Review the menu and confirm requirements with staff.')
    if not any(p.polarity == 'like' for p in context.preferences):
        return RealPicksResult(**base, status='insufficient_taste', message='Add a favorite dish or a known flavor, texture or cooking preference in Taste DNA before asking for personal picks.')
    try:
        output = provider.propose(context)
        picks, rejected, stretch, bridges, combinations = validate_output(output, context)
    except (CulinaryError, ValidationError) as error:
        # Never leak SDK bodies, prompts, private profiles or unvalidated proposals.
        return RealPicksResult(**base, status='unavailable', error_code=error.code if isinstance(error, CulinaryError) else 'malformed_output',
            message=str(error) if isinstance(error, CulinaryError) else 'The provider response could not be validated. No recommendations were substituted.')
    base.update(mode=output.mode, model=output.model, recommendations=picks, worth_the_stretch=stretch,
        taste_bridges=bridges, meal_combinations=combinations, exclusions=[*context.exclusions, *rejected])
    if not picks and request.refinements.avoid_dish_ids:
        message = 'No unseen strong dishes remain under these preferences. Reset refinements to reconsider earlier picks.'
    elif not picks and request.refinements.preferences:
        message = 'No strong matches support this temporary direction from the available menu text. Remove a refinement or explore the full menu.'
    else:
        message = 'A selection grounded in your taste and the extracted menu.' if picks else 'No sufficiently strong, supported matches were returned. No dishes were added to fill slots.'
    return RealPicksResult(**base, status='ready' if picks else 'no_matches',
        message=message)

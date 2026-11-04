"""Developer-only, loopback real-menu test runner. OFFLINE unless BOTH live flags are supplied.

Start only after the owner separately approves ONE paid Muse Spark request and the
browser holds a current signed extraction for the selected guest. No retry/reload.
"""
import argparse
from datetime import datetime, timezone
from decimal import Decimal
import os
from pathlib import Path
import re
import sys
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--confirm-spend', action='store_true')
    parser.add_argument('--technical-diet-test', action='store_true',
                        help='Runner-only, explicitly approved soft preference evaluation; never changes saved Taste DNA.')
    parser.add_argument('--image-review', action='store_true',
                        help='Separately approved one-call recovery with up to three Muse Image illustrations.')
    parser.add_argument('--user-id', type=UUID, help='Guest UUID shown in Memory; never an access token.')
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args(argv)
    if args.live != args.confirm_spend or args.live and not args.user_id:
        parser.error('One approved live invocation requires --live --confirm-spend --user-id UUID together.')
    if args.technical_diet_test and not args.live:
        parser.error('--technical-diet-test requires the separately approved live invocation.')
    if args.image_review and not (args.live and args.technical_diet_test):
        parser.error('--image-review requires --live --confirm-spend --technical-diet-test.')

    # Read backend-only configuration. No key or profile is printed or sent to Next.
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / '.env', override=False)
    if not args.live:
        from app.usage_budget import Ledger, LEDGER_PATH, MILESTONES, CUMULATIVE_LIMIT
        from pydantic import ValidationError
        print('OFFLINE PREFLIGHT. No network or paid request; the normal real-menu API remains disabled.')
        print('MODEL_API_KEY:', 'configured' if os.getenv('MODEL_API_KEY') else 'missing')
        try:
            ledger = Ledger.model_validate_json(LEDGER_PATH.read_text())
            spent = sum((row.accounted_usd for row in ledger.entries), Decimal(0))
            attempts = sum(row.milestone == '4D.5A' for row in ledger.entries)
            print(f'Local accounting: ${spent}; ${CUMULATIVE_LIMIT - spent} remaining of $10; '
                  f'4D.5A attempts: {attempts}/{MILESTONES["4D.5A"][1]}. Not provider billing.')
        except (OSError, ValueError, ValidationError):
            print('Local ledger unavailable; live dispatch would fail closed.')
        return 0
    if not 1024 <= args.port <= 65535:
        parser.error('Choose a non-privileged local port.')
    os.environ['GOOGLE_PLACES_ENABLED'] = 'false'
    os.environ['GOOGLE_PLACES_LIVE_APPROVED'] = 'false'
    os.environ['DINETUNED_REAL_PICKS_DIAGNOSTICS'] = '1'
    from app.culinary.errors import CulinaryError
    from app.culinary.meta import LiveConsent, MetaConfig
    from app.usage_budget import (UsageBudget, MILESTONES, CUMULATIVE_LIMIT, MAX_REQUEST_BYTES,
        MAX_OUTPUT_TOKENS, PRICE_VERIFIED, PRICE_EXPIRES, token_cost)
    from app.real_picks.illustrations import ImagePolicy, MILESTONE as IMAGE_MILESTONE
    recovery_milestone = '4D.IMAGE_REVIEW'
    milestone = recovery_milestone if args.image_review else '4D.5A'
    try:
        MetaConfig.from_environment().validate()
        key = os.getenv('MODEL_API_KEY', '')
        if not key or key != key.strip() or not re.fullmatch(r'[!-~]+', key):
            raise CulinaryError('missing_credentials', 'Configure MODEL_API_KEY in the backend environment before starting this approved test.')
        if not PRICE_VERIFIED <= datetime.now(timezone.utc).date() <= PRICE_EXPIRES:
            raise CulinaryError('pricing_expired', 'Re-verify official Standard pricing before live use.')
        image_policy = ImagePolicy.from_environment() if args.image_review else None
        if args.image_review and (image_policy is None or image_policy.cap_usd != Decimal('0.03')
                                  or image_policy.max_images != 3):
            raise CulinaryError('image_policy', 'This approved review requires an exact $0.03 / three-image policy.')
        budget = UsageBudget(extra_limits={recovery_milestone: (Decimal('0.08'), 1),
            IMAGE_MILESTONE: (Decimal('0.03'), 3)} if args.image_review else None)
        summary = budget.summary(milestone)
        image_summary = budget.summary(IMAGE_MILESTONE) if args.image_review else None
        worst_case = token_cost(2 * MAX_REQUEST_BYTES + 2048, MAX_OUTPUT_TOKENS)
        if (summary['attempts'] >= budget.limits[milestone][1]
            or Decimal(summary['milestone_remaining_usd']) < worst_case
            or Decimal(summary['remaining_usd']) < worst_case + (Decimal('0.03') if args.image_review else 0)
            or image_summary and image_summary['attempts'] != 0
            or CUMULATIVE_LIMIT != Decimal('10')):
            raise CulinaryError('budget_exceeded', 'No safe one-call allowance remains. Review the local ledger and Meta dashboard.')
    except CulinaryError as error:
        print(f'Preflight failed [{error.code}]: {error}', file=sys.stderr)
        return 1

    from fastapi import HTTPException
    from app.main import app
    from app.menu_sources import routes as sources
    from app.menu_extraction import routes as extraction
    from app.real_picks.live_gate import OneShotProvider, TechnicalDietTestPolicy, TechnicalTestMetaProvider, bind_approved_user
    from app.real_picks.provider import MetaRealMenuProvider
    import uvicorn

    def no_website_fetch():
        raise HTTPException(status_code=503, detail='Website jobs are disabled during the one-call Meta test.')

    app.dependency_overrides[sources.get_agent] = no_website_fetch
    app.dependency_overrides[extraction.get_pipeline] = no_website_fetch
    provider = (OneShotProvider(lambda: TechnicalTestMetaProvider(milestone=milestone, budget=budget)) if args.technical_diet_test
                else OneShotProvider(lambda: MetaRealMenuProvider(consent=LiveConsent(live=True, confirm_spend=True))))
    bind_approved_user(app, args.user_id, provider,
        TechnicalDietTestPolicy() if args.technical_diet_test else None)
    print('REAL META RUNNER: loopback only, one verified guest, at most one reserved Muse Spark request.')
    if args.image_review: print('Muse Image: at most three distinct validated primary Picks, $0.03 local estimate, no retries.')
    print(f'Model: {MetaConfig.from_environment().model}; conservative maximum one-request estimate: ${worst_case}.')
    print(f'Local remaining development target before this call: ${summary["remaining_usd"]}; provider billing may differ.')
    print('Google Places and website jobs are disabled in this process. Stop the server after the test; check the Meta dashboard.')
    uvicorn.run(app, host='127.0.0.1', port=args.port, workers=1, reload=False, access_log=False)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

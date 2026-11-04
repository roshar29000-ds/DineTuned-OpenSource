"""OFFLINE by default. Live flags require separate user approval for ONE call."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.culinary.errors import CulinaryError
from app.culinary.meta import LiveConsent, MetaConfig, MetaCulinaryProvider, request_body
from app.culinary.smoke_fixture import mock_transport, smoke_context
from app.culinary.validation import validate_output
from app.usage_budget import estimate_request, token_cost


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Request ONE real Standard Muse Spark completion (requires separate approval).")
    parser.add_argument("--confirm-spend", action="store_true", help="Explicit per-invocation spending confirmation; never sets an environment default.")
    args = parser.parse_args()
    provider = None
    try:
        if args.live != args.confirm_spend:
            raise CulinaryError("live_disabled", "Both --live and --confirm-spend are required together. Without flags this command is offline.")
        label = "REAL META" if args.live else "MOCKED/OFFLINE — in-memory response; $0 API cost"
        print(label)
        context = smoke_context()
        config = MetaConfig.from_environment() if args.live else MetaConfig()
        estimate = estimate_request(request_body(context, config))
        print(f"Model: {config.model}; reasoning effort: {config.reasoning_effort}; maximum completion: {config.max_output_tokens} tokens (reasoning + JSON)")
        print(f"Conservative live reservation estimate: ${estimate.upper_usd} (not actual billing)")
        provider = MetaCulinaryProvider(config, consent=LiveConsent(args.live, args.confirm_spend),
            mock_transport=None if args.live else mock_transport(context))
        result = validate_output(provider.propose(context), context)
        print(f"Validation: {len(result.recommendations)} primary picks; {len(result.rejected)} rejected proposals")
        for pick in result.recommendations:
            print(f"- {pick.dish.id}: {pick.dish.name} — ${pick.dish.price.amount_minor / 100:.2f}; over target ${pick.budget.overage_minor / 100:.2f}")
            print(f"  {pick.explanation}")
        if result.rejected:
            print("Rejected:", json.dumps(result.rejected))
        if not result.recommendations:
            print("No supported strong picks. No filler dishes were invented.")
        return 0
    except CulinaryError as error:
        print(f"Error [{error.code}]: {error}", file=sys.stderr)
        return 1
    finally:
        if provider and provider.trace:
            trace = provider.trace
            if trace.finish_reason:
                print(f"Completion finish reason: {trace.finish_reason}")
            if trace.usage:
                print(("Reported" if args.live else "MOCK") + " token usage:", trace.usage.model_dump_json())
                if args.live and trace.pricing_verified:
                    print(f"Token-based estimated USD cost: ${token_cost(trace.usage.input_tokens, trace.usage.output_tokens)} (not provider billing)")
                elif args.live:
                    print("Returned model pricing is unverified; full reservation retained and further calls blocked.")
            else:
                print("Usage unknown; any live reservation remains accounted in full.")
            if trace.budget:
                print("Cumulative local accounting:", json.dumps(trace.budget))
        if args.live:
            print("Local accounting is not a Meta-enforced cap and excludes external API usage. Check the Meta dashboard. Do not retry automatically.")
        else:
            print("No real API call; ledger unchanged. Mock token counts are synthetic.")


if __name__ == "__main__":
    raise SystemExit(main())

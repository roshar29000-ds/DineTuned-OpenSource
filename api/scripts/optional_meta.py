"""Operator-only optional Meta model calls. No command dispatches without both flags.

The public web app never imports this script. Use mocked pytest tests for normal
development; live calls require separate owner approval and backend-only keys.
"""
import argparse
import json
import os
from pathlib import Path
import sys
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.culinary.meta import LiveConsent
from app.optional_models.sam import SamImageSegmenter
from app.optional_models.wonder import DeepCulinaryReasoner
from app.real_picks.models import RealMemoryObservation, RealPicksRequest, RealPicksResult


def private_output(path: str | None, data: dict):
    if not path:
        return
    destination = Path(path)
    descriptor = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        json.dump(data, stream, indent=2)


def main():
    parser = argparse.ArgumentParser(description='Owner-approved, bounded optional Meta integrations')
    sub = parser.add_subparsers(dest='model', required=True)
    wonder = sub.add_parser('wonder', help='Compare existing signed, genuine Muse Spark Picks')
    wonder.add_argument('--guest', required=True, help='Authenticated guest UUID')
    wonder.add_argument('--request-file', required=True, help='Private signed RealPicksRequest JSON')
    wonder.add_argument('--picks-file', required=True, help='Private RealPicksResult JSON')
    wonder.add_argument('--memory-file', help='Private array of the exact memory observations used for Picks')
    wonder.add_argument('--output', help='Create a private JSON result file, mode 0600')
    sam = sub.add_parser('sam', help='Segment original fictional-dish artwork')
    sam.add_argument('--asset', required=True, help='Whitelisted file name in web/public/demo-food')
    sam.add_argument('--concept', choices=['food', 'plate'], default='food')
    sam.add_argument('--output', help='Create a private JSON result file, mode 0600')
    for command in (wonder, sam):
        command.add_argument('--live', action='store_true')
        command.add_argument('--confirm-spend', action='store_true')
    args = parser.parse_args()
    if not args.live or not args.confirm_spend:
        parser.error('Live dispatch requires both --live and --confirm-spend plus an approved server-side policy.')
    consent = LiveConsent(live=True, confirm_spend=True)
    if args.model == 'wonder':
        request = RealPicksRequest.model_validate_json(Path(args.request_file).read_text())
        picks = RealPicksResult.model_validate_json(Path(args.picks_file).read_text())
        memory = tuple(RealMemoryObservation.model_validate(item) for item in
            json.loads(Path(args.memory_file).read_text())) if args.memory_file else ()
        result = DeepCulinaryReasoner(consent=consent).compare(UUID(args.guest), request, picks, memory=memory)
        private_output(args.output, result.model_dump(mode='json'))
        print(f'Muse Wonder {result.mode} comparison: {len(result.comparisons)} grounded tradeoff(s).')
    else:
        result = SamImageSegmenter(consent=consent).segment(args.asset, args.concept)
        private_output(args.output, result.model_dump(mode='json'))
        print(f'SAM {result.mode} segmentation: {len(result.regions)} region(s); '
              'geometry only, no verified food identification.')


if __name__ == '__main__':
    main()

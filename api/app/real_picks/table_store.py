"""Private, guest-scoped view cache for a verified restaurant table.

Only existing authenticated API routes write here, after their normal signature,
menu and recommendation validation. A restored expired proof is read-only.
No browser storage, model dispatch, or Google request is involved in reading it.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import sqlite3
from uuid import UUID

from pydantic import ValidationError
from pydantic import Field

from ..culinary.errors import CulinaryError
from ..discovery.models import DiscoveredRestaurant, MenuDiscoveryHandoff
from ..menu_extraction.models import MenuExtractionResult
from ..menu_sources.identity import SelectionProof
from ..schemas import Contract
from .models import RealPicksRequest, RealPicksResult

ROOT = Path(__file__).resolve().parents[3] / '.local' / 'real_picks' / 'guest_tables.sqlite3'


class GuestTableSnapshot(Contract):
    selection: MenuDiscoveryHandoff | None = None
    extraction: MenuExtractionResult | None = None
    request: RealPicksRequest | None = None
    picks: RealPicksResult | None = None
    updated_at: datetime | None = None


class ClearGuestTable(Contract):
    selection_token: str = Field(min_length=20, max_length=2048, repr=False)


def get_table_store():
    return GuestTableStore()


class GuestTableStore:
    def __init__(self, path: Path | None = None):
        self.path = Path(path or os.getenv('DINETUNED_TABLE_STORE_PATH') or ROOT)

    def _connect(self):
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if self.path.is_symlink(): raise OSError('Symlink table cache')
            db = sqlite3.connect(self.path, timeout=5)
            os.chmod(self.path, 0o600)
            db.execute('''CREATE TABLE IF NOT EXISTS guest_tables (
                guest_id TEXT PRIMARY KEY, selection_json TEXT, extraction_json TEXT,
                request_json TEXT, picks_json TEXT, updated_at TEXT NOT NULL)''')
            return db
        except (OSError, sqlite3.Error):
            raise CulinaryError('table_cache', 'Your private table could not be backed up or restored.') from None

    @staticmethod
    def _time(): return datetime.now(timezone.utc).isoformat()

    def save_selection(self, guest: UUID, selection: MenuDiscoveryHandoff):
        if not selection.source_discovery_token:
            raise CulinaryError('table_cache', 'The selected branch has no signed verification.')
        try:
            with self._connect() as db:
                db.execute('''INSERT INTO guest_tables VALUES (?,?,NULL,NULL,NULL,?)
                    ON CONFLICT(guest_id) DO UPDATE SET selection_json=excluded.selection_json,
                    extraction_json=NULL, request_json=NULL, picks_json=NULL, updated_at=excluded.updated_at''',
                    (str(guest), selection.model_dump_json(), self._time()))
        except sqlite3.Error:
            raise CulinaryError('table_cache', 'The selected branch could not be backed up.') from None

    def save_extraction(self, guest: UUID, restaurant: DiscoveredRestaurant, token: str, extraction: MenuExtractionResult):
        if (extraction.restaurant_id != restaurant.place_id or extraction.menu.restaurant_id != restaurant.place_id
                or extraction.menu.restaurant.place_id != restaurant.place_id):
            raise CulinaryError('table_cache', 'The extracted menu does not match the selected branch.')
        try:
            with self._connect() as db:
                db.execute('BEGIN IMMEDIATE')
                row = db.execute('SELECT selection_json FROM guest_tables WHERE guest_id=?', (str(guest),)).fetchone()
                current = MenuDiscoveryHandoff.model_validate_json(row[0]) if row and row[0] else None
                if current and (current.restaurant.place_id != restaurant.place_id
                                or current.source_discovery_token != token):
                    raise CulinaryError('stale_table', 'A different restaurant was selected. This menu was not restored.')
                selection = current or MenuDiscoveryHandoff(restaurant=restaurant, source_discovery_token=token,
                    limitations=['Recovered from a verified branch selection; menu provenance remains in the extracted source.'])
                db.execute('''INSERT INTO guest_tables VALUES (?,?,?,?,?,?)
                    ON CONFLICT(guest_id) DO UPDATE SET selection_json=excluded.selection_json,
                    extraction_json=excluded.extraction_json, request_json=NULL, picks_json=NULL,
                    updated_at=excluded.updated_at''',
                    (str(guest), selection.model_dump_json(), extraction.model_dump_json(), None, None, self._time()))
        except (sqlite3.Error, ValidationError):
            raise CulinaryError('table_cache', 'The extracted menu could not be backed up.') from None

    def save_picks(self, guest: UUID, request: RealPicksRequest, result: RealPicksResult):
        menu = request.extraction.menu
        if (result.request_id != request.request_id or result.restaurant_id != menu.restaurant_id
                or result.menu_version != menu.version):
            raise CulinaryError('table_cache', 'These Picks do not match the verified menu request.')
        try:
            with self._connect() as db:
                db.execute('BEGIN IMMEDIATE')
                row = db.execute('SELECT selection_json, extraction_json FROM guest_tables WHERE guest_id=?',
                                 (str(guest),)).fetchone()
                if row and row[1]:
                    extraction = MenuExtractionResult.model_validate_json(row[1])
                    if (extraction.restaurant_id != menu.restaurant_id or extraction.menu.version != menu.version):
                        raise CulinaryError('stale_table', 'A newer menu was selected. These Picks were not saved.')
                else:
                    extraction = request.extraction
                selection = (MenuDiscoveryHandoff.model_validate_json(row[0]) if row and row[0] else
                    MenuDiscoveryHandoff(restaurant=menu.restaurant,
                        limitations=['Read-only restaurant identity recovered from a verified menu snapshot.']))
                if selection.restaurant.place_id != menu.restaurant_id:
                    raise CulinaryError('stale_table', 'A different restaurant was selected. These Picks were not saved.')
                db.execute('''INSERT INTO guest_tables VALUES (?,?,?,?,?,?)
                    ON CONFLICT(guest_id) DO UPDATE SET selection_json=excluded.selection_json,
                    extraction_json=excluded.extraction_json, request_json=excluded.request_json,
                    picks_json=excluded.picks_json, updated_at=excluded.updated_at''',
                    (str(guest), selection.model_dump_json(), extraction.model_dump_json(),
                     request.model_dump_json(), result.model_dump_json(), self._time()))
        except (sqlite3.Error, ValidationError):
            raise CulinaryError('table_cache', 'These Picks could not be backed up.') from None

    def load(self, guest: UUID, proof: SelectionProof) -> GuestTableSnapshot:
        try:
            with self._connect() as db:
                row = db.execute('SELECT selection_json, extraction_json, request_json, picks_json, updated_at '
                                 'FROM guest_tables WHERE guest_id=?', (str(guest),)).fetchone()
            if not row: return GuestTableSnapshot()
            selection = MenuDiscoveryHandoff.model_validate_json(row[0]) if row[0] else None
            extraction = MenuExtractionResult.model_validate_json(row[1]) if row[1] else None
            request = RealPicksRequest.model_validate_json(row[2]) if row[2] else None
            picks = RealPicksResult.model_validate_json(row[3]) if row[3] else None
            if not selection or (extraction and extraction.restaurant_id != selection.restaurant.place_id
                    or request and (not extraction or request.extraction.menu.version != extraction.menu.version)
                    or picks and (not request or picks.request_id != request.request_id
                                  or picks.restaurant_id != selection.restaurant.place_id
                                  or picks.menu_version != extraction.menu.version)):
                raise ValueError('Inconsistent guest table')
            updated = datetime.fromisoformat(row[4])
            if datetime.now(timezone.utc) - updated > timedelta(hours=24):
                return GuestTableSnapshot()
            # Google branch details are retained only during the signed proof's
            # narrow, existing upload grace. Expired data stays on disk for audit,
            # but is not presented as a current verified branch.
            if selection.source_discovery_token:
                try:
                    proof.verify(selection.source_discovery_token, selection.restaurant,
                                 guest, grace_seconds=23 * 3600)
                except Exception:
                    return GuestTableSnapshot()
            return GuestTableSnapshot(selection=selection, extraction=extraction, request=request,
                                      picks=picks, updated_at=updated)
        except (sqlite3.Error, ValidationError, ValueError):
            raise CulinaryError('table_cache', 'Your private table could not be restored safely.') from None

    def clear_if_selected(self, guest: UUID, token: str):
        try:
            with self._connect() as db:
                row = db.execute('SELECT selection_json FROM guest_tables WHERE guest_id=?', (str(guest),)).fetchone()
                if row and row[0] and MenuDiscoveryHandoff.model_validate_json(row[0]).source_discovery_token == token:
                    db.execute('DELETE FROM guest_tables WHERE guest_id=?', (str(guest),))
        except (sqlite3.Error, ValidationError):
            raise CulinaryError('table_cache', 'The old table could not be cleared safely.') from None

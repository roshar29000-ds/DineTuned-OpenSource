import type { DiningEventWrite, DiningEventRecord, DishFeedbackWrite, DishFeedbackRecord, RecommendationHistoryWrite,
  RecommendationHistoryRecord, DiningEventCorrection, FeedbackCorrection, RecommendationSession, Recommendation, MealFeedback } from '../contracts';
import { isContract } from '../validation';
import type { MemoryRepository } from '../memory-repository';

export type EventValue = DiningEventWrite | DiningEventRecord;
export type FeedbackValue = DishFeedbackWrite | DishFeedbackRecord;
export type Entry<T> = { value: T; status: 'local' | 'pending' | 'synced' };
export type Journal = {
  events: Entry<EventValue>[]; feedback: Entry<FeedbackValue>[];
  history: Entry<RecommendationHistoryWrite | RecommendationHistoryRecord>[];
};
export const emptyJournal = (): Journal => ({ events: [], feedback: [], history: [] });
export const eventLabels = { saved: 'Saved', selected: 'Selected', ordered: 'Ordered', tasted: 'Tried' };
export const feedbackTags = { too_spicy: 'Too spicy', not_spicy_enough: 'Not spicy enough', too_rich: 'Too rich', too_heavy: 'Too heavy',
  great_texture: 'Great texture', disliked_texture: 'Disliked texture', would_order_again: 'Would order again' };
const contracts = { events: ['DiningEventWrite', 'DiningEventRecord'], feedback: ['DishFeedbackWrite', 'DishFeedbackRecord'], history: ['RecommendationHistoryWrite', 'RecommendationHistoryRecord'] };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The cloud operation could not be confirmed.';
export const recordRevision = (value: object): number => 'revision' in value && typeof value.revision === 'number' ? value.revision : 1;
function intent(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(intent));
  if (value && typeof value === 'object') return JSON.stringify(Object.entries(value).filter(([key]) => !['user_id','source','created_at','updated_at','revision','occurred_at','date'].includes(key))
    .sort(([a],[b]) => a.localeCompare(b)).map(([key, item]) => [key, intent(item)]));
  return JSON.stringify(value);
}

/** Deterministic UUID, scoped by owner/session/action. Duplicate tabs and retries use the same key. */
export async function memoryId(key: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('dinetuned-memory-v1:' + key))).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 128; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export async function actionRecords(owner: string, session: RecommendationSession, rec: Recommendation, kind: DiningEventWrite['event_type']) {
  if (![...session.recommendations, ...(session.worth_the_stretch?.picks || [])].some(item => item.dish.id === rec.dish.id)) throw new Error('This dish is no longer part of the selection.');
  const historyId = await memoryId(`${owner}:${session.id}:history`);
  const history: RecommendationHistoryWrite = { id: historyId, session_id: session.id, restaurant_id: session.restaurant.id,
    menu_version: session.menu_version, reported_provider: session.engine, dishes: [...session.recommendations, ...(session.worth_the_stretch?.picks || [])]
      .map(item => ({ id: item.dish.id, name: item.dish.name, category_id: item.dish.category_id, price: item.dish.price })) };
  const event: DiningEventWrite = { id: await memoryId(`${owner}:${session.id}:${rec.dish.id}:${kind}`), event_type: kind,
    restaurant_id: session.restaurant.id, restaurant_name: session.restaurant.name, dish_id: rec.dish.id, dish_name: rec.dish.name,
    menu_version: session.menu_version, occurred_at: session.created_at, recommendation_id: historyId };
  // The original session timestamp makes retry payloads stable; the explicit action time is set once in the journal.
  return { history, event };
}

/** Small durable outbox. No background uploads, automatic profile changes, or culinary interpretation. */
export class DiningJournal {
  data = emptyJournal();
  error = '';
  private active = true;
  private version = 0;
  private saving: Promise<void> | null = null;
  private storageAvailable = true;
  readonly key: string;
  constructor(readonly owner: string, private storage: Storage, readonly repository: MemoryRepository | null, private changed: () => void) {
    this.key = 'dinetuned-dining-v1:' + owner;
    try {
      const raw = storage.getItem(this.key);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const kind of ['events','feedback','history'] as const) {
          if (!Array.isArray(parsed[kind])) throw new Error('Invalid cache');
          if (parsed[kind].some((entry: Entry<unknown>) => !entry || !['local','pending','synced'].includes(entry.status)
            || !contracts[kind].some(contract => isContract(contract, entry.value))
            || (entry.status === 'synced' && (!entry.value || (entry.value as { user_id: string }).user_id !== owner)))) throw new Error('Invalid cache');
        }
        this.data = parsed;
      }
    } catch { this.storageAvailable = false; this.error = 'The local dining cache could not be read. Existing data has been left intact.'; }
  }
  dispose() { this.active = false; }
  private publish(data = this.data) {
    if (!this.active) return;
    if (!this.storageAvailable) throw new Error(this.error);
    try { this.storage.setItem(this.key, JSON.stringify(data)); }
    catch { throw new Error('Browser storage is unavailable. This dining action has not been saved.'); }
    this.data = data; this.version++; this.changed();
  }
  private assertActive() { if (!this.active) throw new Error('Your dining session changed. Please try again in the current session.'); }
  async refresh() {
    if (!this.repository) return;
    const version = this.version;
    const all = async (kind: 'events' | 'feedback' | 'history') => {
      const rows = [];
      for (let offset = 0; offset <= 10000; offset += 50) {
        const page = await this.repository![kind](offset);
        rows.push(...page.records);
        if (page.records.length < 50) break;
      }
      return rows.map(value => ({ value, status: 'synced' as const }));
    };
    try {
      const [events, feedback, history] = await Promise.all([all('events'), all('feedback'), all('history')]);
      if (!this.active || version !== this.version) return;
      const next = { events, feedback, history } as Journal;
      let conflict = false;
      for (const kind of ['events','feedback','history'] as const) {
        for (const pending of this.data[kind].filter(entry => entry.status !== 'synced')) {
          const existing = next[kind].find(entry => entry.value.id === pending.value.id);
          if (existing && intent(existing.value) === intent(pending.value)) continue;
          if (existing) { conflict = true; (next[kind] as Entry<unknown>[]) = next[kind].filter(entry => entry.value.id !== pending.value.id); }
          (next[kind] as Entry<unknown>[]).push(pending);
        }
      }
      this.error = conflict ? 'A pending browser record differs from its cloud version. It has been preserved; no cloud record was overwritten.' : ''; this.publish(next);
    } catch (error) { if (this.active) { this.error = errorText(error); this.changed(); } }
  }
  async record(history: RecommendationHistoryWrite, event: DiningEventWrite, feedback?: DishFeedbackWrite) {
    this.assertActive();
    const status = this.repository ? 'pending' as const : 'local' as const;
    const next = { ...this.data };
    if (!next.history.some(entry => entry.value.id === history.id)) next.history = [...next.history, { value: history, status }];
    if (!next.events.some(entry => entry.value.id === event.id)) next.events = [{ value: { ...event, occurred_at: new Date().toISOString() }, status }, ...next.events];
    if (feedback && !next.feedback.some(entry => entry.value.id === feedback.id)) next.feedback = [{ value: feedback, status }, ...next.feedback];
    this.publish(next);
    await this.sync();
  }
  async sync(): Promise<void> {
    if (!this.repository) return;
    if (this.saving) { await this.saving; return this.sync(); }
    this.saving = this.flush();
    try { await this.saving; } finally { this.saving = null; }
  }
  private async flush() {
    this.error = '';
    try {
      for (const kind of ['history','events','feedback'] as const) {
        for (const entry of this.data[kind].filter(item => item.status === 'pending')) {
          this.assertActive();
          const method = kind === 'history' ? 'addHistory' : kind === 'events' ? 'addEvent' : 'addFeedback';
          // Sending only write fields preserves idempotency and never supplies an owner ID.
          const saved = await (this.repository![method] as (value: unknown) => Promise<typeof entry.value>)(entry.value);
          this.assertActive();
          this.publish({ ...this.data, [kind]: this.data[kind].map(item => item.value.id === saved.id ? { value: saved, status: 'synced' } : item) });
        }
      }
    } catch (error) { if (this.active) { this.error = errorText(error); this.changed(); } throw error; }
  }
  async correct(kind: 'events', entry: Entry<EventValue>, value: DiningEventCorrection): Promise<void>;
  async correct(kind: 'feedback', entry: Entry<FeedbackValue>, value: FeedbackCorrection): Promise<void>;
  async correct(kind: 'events' | 'feedback', entry: Entry<EventValue | FeedbackValue>, value: DiningEventCorrection | FeedbackCorrection) {
    this.assertActive();
    if (entry.status === 'pending') throw new Error('Retry the pending cloud save before correcting this record.');
    let saved: EventValue | FeedbackValue;
    if (entry.status === 'synced') {
      if (!this.repository) throw new Error('Reconnect to correct this cloud record.');
      saved = kind === 'events' ? await this.repository.correctEvent(entry.value.id, value as DiningEventCorrection)
        : await this.repository.correctFeedback(entry.value.id, value as FeedbackCorrection);
    } else if (kind === 'events') saved = { ...entry.value as EventValue, event_type: (value as DiningEventCorrection).event_type };
    else {
      const change = value as FeedbackCorrection, old = entry.value as FeedbackValue;
      saved = { ...old, rating: change.rating, tags: change.tags, feedback: { ...old.feedback, liked: change.liked, note: change.note } };
    }
    this.assertActive();
    this.publish({ ...this.data, [kind]: this.data[kind].map(item => item.value.id === saved.id ? { value: saved, status: entry.status } : item) });
  }
  async remove(kind: 'events' | 'feedback', entry: Entry<EventValue | FeedbackValue>) {
    this.assertActive();
    if (entry.status === 'pending') throw new Error('The cloud save may have succeeded. Retry it before deleting this record.');
    if (kind === 'events' && this.data.feedback.some(item => item.value.event_id === entry.value.id)) throw new Error('Delete the linked rating first, then delete this dining event.');
    if (entry.status === 'synced') {
      if (!this.repository) throw new Error('Reconnect to delete this cloud record.');
      await this.repository.deleteRecord(kind, entry.value.id, recordRevision(entry.value));
    }
    this.assertActive();
    this.publish({ ...this.data, [kind]: this.data[kind].filter(item => item.value.id !== entry.value.id) });
  }
  async importLegacy(feedback: MealFeedback[]) {
    if (!this.repository) throw new Error('Connect cloud identity first.');
    const additions = await Promise.all(feedback.map(async value => ({ status: 'pending' as const, value: {
      id: await memoryId(`${this.owner}:legacy:${value.id}`), event_id: null, feedback: value, rating: null, tags: [],
    } satisfies DishFeedbackWrite })));
    this.assertActive();
    const ids = new Set(this.data.feedback.map(item => item.value.feedback.id));
    this.publish({ ...this.data, feedback: [...this.data.feedback, ...additions.filter(item => !ids.has(item.value.feedback.id))] });
    await this.sync();
  }
  browserRecords() {
    if (this.owner === 'local') return emptyJournal();
    const local = new DiningJournal('local', this.storage, null, () => {});
    if (local.error) throw new Error(local.error);
    return local.data;
  }
  async importBrowserRecords() {
    if (!this.repository) throw new Error('Connect cloud identity first.');
    const local = this.browserRecords();
    const next = { ...this.data };
    for (const kind of ['history','events','feedback'] as const) {
      const additions = await Promise.all(local[kind].map(async entry => {
        const value = { ...entry.value, id: await memoryId(`${this.owner}:import:${entry.value.id}`) };
        if ('recommendation_id' in value && value.recommendation_id) value.recommendation_id = await memoryId(`${this.owner}:import:${value.recommendation_id}`);
        if ('event_id' in value && value.event_id) value.event_id = await memoryId(`${this.owner}:import:${value.event_id}`);
        return { value, status: 'pending' as const };
      }));
      const ids = new Set(next[kind].map(entry => entry.value.id));
      (next[kind] as Entry<unknown>[]) = [...next[kind], ...additions.filter(entry => !ids.has(entry.value.id))];
    }
    this.assertActive(); this.publish(next); await this.sync();
  }
}

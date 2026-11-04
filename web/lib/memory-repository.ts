import type { DiningEventList, DiningEventRecord, DiningEventWrite, DishFeedbackList, DishFeedbackRecord, DishFeedbackWrite,
  MemoryIdentity, RecommendationHistoryList, RecommendationHistoryRecord, RecommendationHistoryWrite,
  TasteBackupRecord, TasteBackupResult, TasteBackupWrite, TasteDocument, DiningEventCorrection, FeedbackCorrection,
  RecordDeletion, HistoricalTasteEvidenceList } from './contracts';
import { decodeContract } from './validation';
import { recommendationEvidence } from './recommendations';
import type { SavedState } from './storage';

export interface MemoryRepository {
  identity(): Promise<MemoryIdentity>;
  profile(): Promise<TasteBackupResult>;
  saveProfile(value: TasteBackupWrite): Promise<TasteBackupRecord>;
  events(offset?: number): Promise<DiningEventList>;
  feedback(offset?: number): Promise<DishFeedbackList>;
  history(offset?: number): Promise<RecommendationHistoryList>;
  addEvent(value: DiningEventWrite): Promise<DiningEventRecord>;
  addFeedback(value: DishFeedbackWrite): Promise<DishFeedbackRecord>;
  addHistory(value: RecommendationHistoryWrite): Promise<RecommendationHistoryRecord>;
  correctEvent(id: string, value: DiningEventCorrection): Promise<DiningEventRecord>;
  correctFeedback(id: string, value: FeedbackCorrection): Promise<DishFeedbackRecord>;
  deleteRecord(kind: 'events' | 'feedback', id: string, revision: number): Promise<RecordDeletion>;
  evidence(offset?: number, restaurantId?: string): Promise<HistoricalTasteEvidenceList>;
}

/** No restaurant-specific mood, appetite, budget or transient refinement is saved as Taste DNA. */
export function tasteDocument(state: Pick<SavedState, 'taste' | 'detective' | 'tasteEdits'>): TasteDocument {
  return { profile: state.taste, evidence: recommendationEvidence(state.detective, state.tasteEdits.axes),
    detective: state.detective, edited_axes: state.tasteEdits.axes, exploration_edited: state.tasteEdits.exploration };
}

export class CloudMemoryRepository implements MemoryRepository {
  constructor(private readonly credentials: () => Promise<{ token: string; userId: string }>) {}
  private async request<T>(resource: string, contract: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
    const { token, userId } = await this.credentials();
    let response: Response;
    try {
      response = await fetch(`/api/dinetuned/memory/${resource}`, { method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(15000) });
    } catch { throw new Error('Cloud storage could not be reached. Local records remain available. Refresh cloud status before saving again.'); }
    if (!response.ok) throw new Error(response.status === 409
      ? resource === 'profile' ? 'Your cloud backup changed or this record already exists. Refresh cloud status before saving again.'
        : 'This dining record changed, already exists with different content, or is linked to feedback. Refresh dining history before trying again.'
      : response.status === 401 ? 'Your cloud session needs attention. Local records are unchanged.'
      : 'Cloud storage is unavailable. Check connection and database setup; local records are unchanged.');
    const result = decodeContract<T>(contract, await response.json());
    if ((await this.credentials()).userId !== userId) throw new Error('Cloud identity changed during this request. Refresh before continuing.');
    if (contract === 'RecordDeletion') return result;
    // Defense in depth if a misconfigured service ever returns another owner's row.
    const root = result as Record<string, unknown>;
    const rows = Array.isArray(root.records) ? root.records : 'profile' in root ? root.profile ? [root.profile] : [] : [root];
    const owned = contract === 'HistoricalTasteEvidenceList' ? (result as HistoricalTasteEvidenceList).records.flatMap(row => [row.feedback, row.event, row.recommendation].filter(Boolean)) : rows;
    if (owned.some(row => !row || typeof row !== 'object' || (row as { user_id?: unknown }).user_id !== userId)) {
      throw new Error('Cloud record ownership could not be verified.');
    }
    return result;
  }
  identity() { return this.request<MemoryIdentity>('identity', 'MemoryIdentity'); }
  profile() { return this.request<TasteBackupResult>('profile', 'TasteBackupResult'); }
  saveProfile(value: TasteBackupWrite) { return this.request<TasteBackupRecord>('profile', 'TasteBackupRecord', value); }
  events(offset = 0) { return this.request<DiningEventList>(`events?offset=${offset}`, 'DiningEventList'); }
  feedback(offset = 0) { return this.request<DishFeedbackList>(`feedback?offset=${offset}`, 'DishFeedbackList'); }
  history(offset = 0) { return this.request<RecommendationHistoryList>(`history?offset=${offset}`, 'RecommendationHistoryList'); }
  addEvent(value: DiningEventWrite) { return this.request<DiningEventRecord>('events', 'DiningEventRecord', value); }
  addFeedback(value: DishFeedbackWrite) { return this.request<DishFeedbackRecord>('feedback', 'DishFeedbackRecord', value); }
  addHistory(value: RecommendationHistoryWrite) { return this.request<RecommendationHistoryRecord>('history', 'RecommendationHistoryRecord', value); }
  correctEvent(id: string, value: DiningEventCorrection) { return this.request<DiningEventRecord>(`events/${id}`, 'DiningEventRecord', value, 'PATCH'); }
  correctFeedback(id: string, value: FeedbackCorrection) { return this.request<DishFeedbackRecord>(`feedback/${id}`, 'DishFeedbackRecord', value, 'PATCH'); }
  async deleteRecord(kind: 'events' | 'feedback', id: string, revision: number) {
    const result = await this.request<RecordDeletion>(`${kind}/${id}?expected_revision=${revision}`, 'RecordDeletion', undefined, 'DELETE');
    if (result.id !== id) throw new Error('The deletion response does not match this dining record. Refresh dining history.');
    return result;
  }
  evidence(offset = 0, restaurantId?: string) { return this.request<HistoricalTasteEvidenceList>(`evidence?offset=${offset}${restaurantId ? '&restaurant_id=' + encodeURIComponent(restaurantId) : ''}`, 'HistoricalTasteEvidenceList'); }
}

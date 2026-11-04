import { decodeContract } from './validation';
import { withOptionalTasteBridges } from './tastebridge';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}
export async function apiRequest<T>(path: string, contract: string, body?: unknown, signal?: AbortSignal, onResponse?: () => void): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/dinetuned/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal, cache: 'no-store',
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError('We could not reach your dining concierge. Please try again.', 503);
  }
  onResponse?.();
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data && typeof data === 'object' && 'detail' in data ? data.detail : null;
    throw new ApiError(typeof detail === 'string' ? detail : response.status === 422
      ? 'Some preferences could not be read. Please check your selections and try again.'
      : 'Your menu is temporarily unavailable. Please try again.', response.status);
  }
  return decodeContract<T>(contract, contract === 'RecommendationSession' ? withOptionalTasteBridges(data) : data);
}

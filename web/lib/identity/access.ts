import type { SupabaseClient } from '@supabase/supabase-js';

/** Stable per verified identity, never a snapshot of its expiring JWT. */
export class IdentityAccess {
  private active = true;
  constructor(private readonly auth: Pick<SupabaseClient['auth'], 'getSession'>, readonly userId: string) {}
  revoke() { this.active = false; }
  readonly credentials = async () => {
    if (!this.active) throw new Error('Your cloud session changed. Local records are unchanged.');
    const { data, error } = await this.auth.getSession();
    if (!this.active || error || !data.session || data.session.user.id !== this.userId) {
      throw new Error('Your cloud session changed. Local records are unchanged.');
    }
    return { token: data.session.access_token, userId: this.userId };
  };
  readonly getAccessToken = async () => (await this.credentials()).token;
}

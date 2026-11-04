import type { BridgeFact, StructuredTasteBridge } from './contracts';
import { isContract } from './validation';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Presentation integrity only. Culinary meaning and relations belong to Python.
 * An optional, older or broken comparison must not discard otherwise valid picks.
 */
export function readableTasteBridge(value: unknown): StructuredTasteBridge | null {
  if (!isContract<StructuredTasteBridge>('StructuredTasteBridge', value)) return null;
  if (value.status === 'unavailable') {
    return value.anchor === null && !value.shared.length && !value.differences.length && !value.explanation ? value : null;
  }
  const { anchor, evidence } = value;
  if (!anchor?.label.trim() || !value.shared.length || !value.explanation.trim() || value.unavailable_reason !== null) return null;
  const facts = new Map(evidence.map(fact => [fact.id, fact]));
  if (facts.size !== evidence.length || !anchor.evidence_ids.length) return null;
  const subject = anchor.kind === 'liked_dish' ? 'familiar_dish' : 'user';
  if (!anchor.evidence_ids.every(id => facts.get(id)?.subject === subject)) return null;
  if (anchor.kind === 'liked_dish' && !anchor.evidence_ids.some(id => {
    const fact = facts.get(id)!;
    return fact.attribute === 'liked' && fact.source === 'reported_feedback' && fact.basis === 'reported' && !!fact.feedback_id;
  })) return null;
  const pairs = new Set<string>();
  const cited = new Set(anchor.evidence_ids);
  for (const [links, shared] of [[value.shared, true], [value.differences, false]] as const) {
    for (const link of links) {
      const a = facts.get(link.anchor_fact_id), b = facts.get(link.target_fact_id);
      const key = JSON.stringify([link.anchor_fact_id, link.target_fact_id]);
      if (!a || !b || !anchor.evidence_ids.includes(a.id) || b.subject !== 'target'
        || b.restaurant_id !== value.restaurant_id || b.menu_version !== value.menu_version || b.dish_id !== value.dish_id
        || a.attribute !== link.attribute || b.attribute !== link.attribute || !link.text.trim()
        || (link.relation === 'shared') !== shared || pairs.has(key)) return null;
      pairs.add(key);
      cited.add(b.id);
    }
  }
  // Provenance shown in the disclosure must belong to this comparison too.
  if (evidence.some(fact => !cited.has(fact.id))) return null;
  return value;
}

export function withOptionalTasteBridges(value: unknown): unknown {
  if (!record(value) || !Array.isArray(value.recommendations)) return value;
  const normalize = (item: unknown) => record(item) ? { ...item, taste_bridge: readableTasteBridge(item.taste_bridge) } : item;
  const result: Record<string, unknown> = { ...value, recommendations: value.recommendations.map(normalize) };
  // Only the optional comparison is tolerant. All dish, price and envelope fields
  // still pass the complete generated response contract in apiRequest.
  if (record(value.worth_the_stretch) && Array.isArray(value.worth_the_stretch.picks)) {
    result.worth_the_stretch = { ...value.worth_the_stretch, picks: value.worth_the_stretch.picks.map(normalize) };
  }
  return result;
}

export const bridgeSourceLabels: Record<BridgeFact['source'], string> = {
  taste_dna: 'Taste DNA', taste_detective: 'Taste Detective', menu_fixture: 'Demo menu', reported_feedback: 'Dining memory',
};
export const bridgeBasisLabels: Record<BridgeFact['basis'], string> = {
  stated: 'Your stated preference', inferred: 'Inferred from your answers', curated_demo: 'Curated fictional detail', reported: 'Your reported experience',
};

export function bridgeFallback(reason?: StructuredTasteBridge['unavailable_reason']): string {
  switch (reason) {
    case 'insufficient_evidence': return 'A few more taste clues could help us make a meaningful connection.';
    case 'contradictory_evidence': return 'Some saved preferences or feedback conflict with this comparison, so we’re leaving the connection open.';
    case 'ineligible': return 'A comparison is unavailable under your current restrictions.';
    case 'invalid_proposal': return 'We couldn’t support this comparison with the available evidence.';
    case 'provider_unavailable': return 'The comparison is temporarily unavailable. Your dish selection is still here.';
    default: return 'We don’t have a supported taste connection to share for this pick yet.';
  }
}

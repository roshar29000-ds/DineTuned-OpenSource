import type { ExtractedPriceOption, MenuSourceCandidate } from '../contracts';

/** UI availability mirrors the signed-source gate; Python remains authoritative. */
export function extractableSource(source: MenuSourceCandidate) {
  return source.suitable_for_extraction && source.access === 'checked' && source.branch_relevance === 'exact'
    && source.freshness !== 'outdated' && ['dine_in', 'unknown'].includes(source.menu_type)
    && ['html', 'pdf'].includes(source.format);
}

export function printedAmount(option: ExtractedPriceOption): string {
  if (option.amount_minor === null || !option.currency) return option.raw;
  // Presentation only. The backend owns amounts, variants and budget eligibility.
  const format = new Intl.NumberFormat('en-US', { style: 'currency', currency: option.currency, currencyDisplay: 'code' });
  const decimals = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(option.amount_minor / 10 ** decimals);
}

export function sourcePage(url: string, page: number | null) {
  const value = new URL(url);
  if (page !== null) value.hash = `page=${page}`;
  return value.href;
}

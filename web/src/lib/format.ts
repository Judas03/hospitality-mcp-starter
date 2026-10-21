import type { ProviderType, SearchResult } from '../contract/types';

export function priceLabel(result: SearchResult): string {
  if (result.price === 0) return 'Free to book';
  let amount: string;
  try {
    amount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: result.currency,
      maximumFractionDigits: 0,
    }).format(result.price);
  } catch {
    amount = `${result.price} ${result.currency}`;
  }
  return result.provider_type === 'hotel' ? `${amount} / night` : amount;
}

export function partyLabel(size: number, provider: ProviderType): string {
  if (provider === 'hotel') return size === 1 ? '1 guest' : `${size} guests`;
  return size === 1 ? '1 person' : `${size} people`;
}

/** "max_party_size" -> "Max party size" */
export function humanizeKey(key: string): string {
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A readable form of any JSON value, for fields the contract does not describe. */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.map(displayValue).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

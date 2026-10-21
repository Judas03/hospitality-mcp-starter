import type { Availability, ProviderType } from '../contract/types';

export function priceLabel(result: Availability): string {
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

/** "2 hours", "45 min" */
export function durationLabel(start: string, end: string): string {
  const minutes = Math.round((Date.parse(end) - Date.parse(start)) / 60_000);
  if (minutes >= 120 && minutes % 60 === 0) return `${minutes / 60} hours`;
  if (minutes === 60) return '1 hour';
  return `${minutes} min`;
}

export function partyLabel(size: number, provider: ProviderType): string {
  if (provider === 'hotel') return size === 1 ? '1 guest' : `${size} guests`;
  return size === 1 ? '1 person' : `${size} people`;
}

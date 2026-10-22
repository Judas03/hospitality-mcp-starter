import { describe, expect, it } from 'vitest';
import type { Availability } from '../contract/types';
import { findSlotAt, groupByPlace, slotLabel } from './places';

function slot(listing_id: string, time: string, extra: Partial<Availability> = {}): Availability {
  return {
    availability_id: `${listing_id}_${time}_${extra.service_type ?? extra.room_type ?? ''}`,
    listing_id,
    name: listing_id,
    provider_type: 'restaurant',
    location: 'Bangkok',
    start_time: `2026-10-23T${time}:00+07:00`,
    end_time: `2026-10-23T${time}:00+07:00`,
    party_size: 2,
    service_type: null,
    room_type: null,
    price: 0,
    currency: 'THB',
    reason: '',
    ...extra,
  };
}

// Currency formatting puts a non-breaking space after "THB"; compare with plain spaces.
const labels = (slots: Availability[]) => {
  const [place] = groupByPlace(slots);
  return place.slots.map((option) => slotLabel(option, place).replace(/ /g, ' '));
};

describe('findSlotAt', () => {
  const evening = [slot('rest', '19:00'), slot('rest', '19:30')];

  it('finds the option at that time', () => {
    expect(findSlotAt(evening, '19:30')?.start_time).toBe('2026-10-23T19:30:00+07:00');
  });

  it('reads a bare morning hour as the evening when only the evening has it', () => {
    expect(findSlotAt(evening, '07:30')?.start_time).toBe('2026-10-23T19:30:00+07:00');
    expect(findSlotAt([slot('salon', '10:00'), slot('salon', '22:00')], '10:00')?.start_time).toBe(
      '2026-10-23T10:00:00+07:00',
    );
  });

  it('finds nothing when no option starts then', () => {
    expect(findSlotAt(evening, '08:15')).toBeNull();
    expect(findSlotAt(evening, '12:00')).toBeNull();
  });
});

describe('groupByPlace', () => {
  it('keeps the server order, places by their best option', () => {
    const places = groupByPlace([slot('a', '19:00'), slot('b', '19:00'), slot('a', '18:30')]);
    expect(places.map((place) => [place.listing_id, place.slots.length])).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
  });
});

describe('slotLabel', () => {
  it('shows the times of a place with several', () => {
    expect(labels([slot('rest', '19:00'), slot('rest', '18:30')])).toEqual(['7:00 PM', '6:30 PM']);
  });

  it('shows the time of a place with only one option', () => {
    expect(labels([slot('rest', '19:00')])).toEqual(['7:00 PM']);
    expect(labels([slot('salon', '13:00', { provider_type: 'salon', service_type: 'haircut', price: 900 })])).toEqual([
      '1:00 PM · Haircut',
    ]);
  });

  it('names the service when one place offers several at different times', () => {
    const salon = { provider_type: 'salon' as const };
    expect(
      labels([
        slot('salon', '13:00', { ...salon, service_type: 'haircut', price: 700 }),
        slot('salon', '14:00', { ...salon, service_type: 'manicure', price: 500 }),
      ]),
    ).toEqual(['1:00 PM · Haircut · THB 700', '2:00 PM · Manicure · THB 500']);
  });

  it('leaves the shared check-in time to the card for hotel rooms', () => {
    const hotel = { provider_type: 'hotel' as const };
    expect(
      labels([
        slot('hotel', '15:00', { ...hotel, room_type: 'deluxe', price: 4200 }),
        slot('hotel', '15:00', { ...hotel, room_type: 'standard', price: 2800 }),
      ]),
    ).toEqual(['Deluxe · THB 4,200 / night', 'Standard · THB 2,800 / night']);
    expect(labels([slot('hotel', '15:00', { ...hotel, room_type: 'suite', price: 5100 })])).toEqual(['Suite']);
  });
});

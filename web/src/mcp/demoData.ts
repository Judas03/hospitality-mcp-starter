import type { Listing } from '../contract/types';

// A copy of the backend's seed inventory (server/repository.py on backend-codex), so demo
// mode shows the same places, times and prices as the live server. Keep the two in step.

export interface DemoTemplate {
  template_id: string;
  listing_id: string;
  /** HH:MM local start time, repeated every day. */
  local_start: string;
  duration_minutes: number;
  max_party_size: number;
  service_type: string | null;
  room_type: string | null;
  price: number;
  currency: string;
}

/** How far from the asked-for time a slot may start and still be offered. */
export const SEARCH_WINDOW_MINUTES = 180;
export const MAX_RESULTS = 10;
export const HOLD_SECONDS = 300;

export const DEMO_LISTINGS: Listing[] = [
  {
    listing_id: 'rest_001',
    name: 'Siam Serenity',
    provider_type: 'restaurant',
    location: 'Bangkok',
    timezone: 'Asia/Bangkok',
    description: 'A calm Thai dining room designed for quiet dinners.',
    features: ['quiet', 'indoor seating', 'thai cuisine'],
    service_types: [],
    room_types: [],
  },
  {
    listing_id: 'rest_002',
    name: 'Riverside Social',
    provider_type: 'restaurant',
    location: 'Bangkok',
    timezone: 'Asia/Bangkok',
    description: 'A lively riverside restaurant with group seating.',
    features: ['river view', 'lively', 'outdoor seating'],
    service_types: [],
    room_types: [],
  },
  {
    listing_id: 'salon_001',
    name: 'Lotus Glow Salon',
    provider_type: 'salon',
    location: 'Bangkok',
    timezone: 'Asia/Bangkok',
    description: 'A neighborhood salon offering hair and nail appointments.',
    features: ['quiet', 'accessible'],
    service_types: ['haircut', 'manicure'],
    room_types: [],
  },
  {
    listing_id: 'salon_002',
    name: 'Sukhumvit Style Studio',
    provider_type: 'salon',
    location: 'Bangkok',
    timezone: 'Asia/Bangkok',
    description: 'A modern salon specializing in styling and manicures.',
    features: ['modern', 'near transit'],
    service_types: ['haircut', 'manicure'],
    room_types: [],
  },
  {
    listing_id: 'hotel_001',
    name: 'Chao Phraya Stay',
    provider_type: 'hotel',
    location: 'Bangkok',
    timezone: 'Asia/Bangkok',
    description: 'A compact riverside hotel with one-night demo inventory.',
    features: ['river view', 'breakfast'],
    service_types: [],
    room_types: ['standard', 'deluxe'],
  },
  {
    listing_id: 'hotel_002',
    name: 'Old Town House',
    provider_type: 'hotel',
    location: 'Bangkok',
    timezone: 'Asia/Bangkok',
    description: "A small hotel near Bangkok's historic district.",
    features: ['quiet', 'historic district'],
    service_types: [],
    room_types: ['standard', 'suite'],
  },
];

function restaurantTemplates(listingId: string, capacity: number): DemoTemplate[] {
  return ['18:00', '18:30', '19:00', '19:30', '20:00'].map((start) => ({
    template_id: `${listingId}_${start.replace(':', '')}`,
    listing_id: listingId,
    local_start: start,
    duration_minutes: 120,
    max_party_size: capacity,
    service_type: null,
    room_type: null,
    price: 0,
    currency: 'THB',
  }));
}

function template(
  template_id: string,
  listing_id: string,
  local_start: string,
  duration_minutes: number,
  max_party_size: number,
  service_type: string | null,
  room_type: string | null,
  price: number,
): DemoTemplate {
  return {
    template_id,
    listing_id,
    local_start,
    duration_minutes,
    max_party_size,
    service_type,
    room_type,
    price,
    currency: 'THB',
  };
}

export const DEMO_TEMPLATES: DemoTemplate[] = [
  ...restaurantTemplates('rest_001', 4),
  ...restaurantTemplates('rest_002', 6),
  template('salon_001_1000_haircut', 'salon_001', '10:00', 60, 1, 'haircut', null, 700),
  template('salon_001_1300_haircut', 'salon_001', '13:00', 60, 1, 'haircut', null, 700),
  template('salon_001_1600_haircut', 'salon_001', '16:00', 60, 1, 'haircut', null, 700),
  template('salon_001_1100_manicure', 'salon_001', '11:00', 45, 1, 'manicure', null, 500),
  template('salon_001_1400_manicure', 'salon_001', '14:00', 45, 1, 'manicure', null, 500),
  template('salon_002_1300_haircut', 'salon_002', '13:00', 60, 1, 'haircut', null, 900),
  template('salon_002_1500_manicure', 'salon_002', '15:00', 45, 1, 'manicure', null, 650),
  template('hotel_001_1500_standard', 'hotel_001', '15:00', 1200, 2, null, 'standard', 2800),
  template('hotel_001_1500_deluxe', 'hotel_001', '15:00', 1200, 3, null, 'deluxe', 4200),
  template('hotel_002_1500_standard', 'hotel_002', '15:00', 1200, 2, null, 'standard', 2400),
  template('hotel_002_1500_suite', 'hotel_002', '15:00', 1200, 4, null, 'suite', 5100),
];

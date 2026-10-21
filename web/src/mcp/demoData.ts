import type { ProviderType } from '../contract/types';

/** A sample business for demo mode. Only the demo client reads these extra fields. */
export interface DemoListing {
  listing_id: string;
  name: string;
  provider_type: ProviderType;
  location: string;
  area: string;
  description: string;
  /** Matched against the search's preferences, lower case. */
  features: string[];
  max_party: number;
  /** HH:MM opening hours; for hotels, opens is the earliest check-in. */
  opens: string;
  closes: string;
  /** Salon menu: service -> length and price. */
  services?: Record<string, { minutes: number; price: number }>;
  /** Hotel rooms: room type -> price per night. */
  rooms?: Record<string, number>;
}

export const RESTAURANT_TABLE_MINUTES = 120;
export const HOTEL_CHECK_OUT = '12:00';
export const CURRENCY = 'THB';

export const DEMO_LISTINGS: DemoListing[] = [
  {
    listing_id: 'rest_001',
    name: 'Baan Suan Garden Kitchen',
    provider_type: 'restaurant',
    location: 'Bangkok',
    area: 'Ari',
    description: 'Thai home cooking in a leafy courtyard, away from the traffic.',
    features: ['quiet', 'garden', 'outdoor', 'vegetarian'],
    max_party: 8,
    opens: '11:00',
    closes: '22:30',
  },
  {
    listing_id: 'rest_002',
    name: 'Chao Phraya Terrace',
    provider_type: 'restaurant',
    location: 'Bangkok',
    area: 'Riverside',
    description: 'Grilled seafood on an open terrace over the river.',
    features: ['river view', 'outdoor', 'romantic'],
    max_party: 6,
    opens: '17:00',
    closes: '23:30',
  },
  {
    listing_id: 'rest_003',
    name: 'Silom Quiet Room',
    provider_type: 'restaurant',
    location: 'Bangkok',
    area: 'Silom',
    description: 'A small tasting-menu dining room with widely spaced tables.',
    features: ['quiet', 'romantic', 'private room'],
    max_party: 4,
    opens: '18:00',
    closes: '23:00',
  },
  {
    listing_id: 'rest_004',
    name: 'Soi 38 Noodle House',
    provider_type: 'restaurant',
    location: 'Bangkok',
    area: 'Thong Lo',
    description: 'A busy, casual noodle bar that welcomes big groups.',
    features: ['family', 'casual', 'late night'],
    max_party: 10,
    opens: '10:00',
    closes: '23:30',
  },
  {
    listing_id: 'salon_001',
    name: 'Lumpini Hair Studio',
    provider_type: 'salon',
    location: 'Bangkok',
    area: 'Lumpini',
    description: 'Cuts and colour by senior stylists in a calm studio.',
    features: ['quiet'],
    max_party: 2,
    opens: '10:00',
    closes: '20:00',
    services: {
      haircut: { minutes: 60, price: 600 },
      'hair colour': { minutes: 120, price: 2200 },
      'blow dry': { minutes: 45, price: 450 },
    },
  },
  {
    listing_id: 'salon_002',
    name: 'Orchid Nail & Spa',
    provider_type: 'salon',
    location: 'Bangkok',
    area: 'Sukhumvit',
    description: 'Nails, massage and facials, with side-by-side chairs for friends.',
    features: ['quiet', 'couples'],
    max_party: 3,
    opens: '10:00',
    closes: '21:00',
    services: {
      manicure: { minutes: 45, price: 400 },
      pedicure: { minutes: 60, price: 550 },
      massage: { minutes: 60, price: 800 },
      facial: { minutes: 60, price: 1200 },
    },
  },
  {
    listing_id: 'salon_003',
    name: 'Ari Barber Club',
    provider_type: 'salon',
    location: 'Bangkok',
    area: 'Ari',
    description: 'A neighbourhood barber with quick, booked slots.',
    features: ['quick'],
    max_party: 2,
    opens: '09:00',
    closes: '20:00',
    services: {
      haircut: { minutes: 45, price: 350 },
      'beard trim': { minutes: 30, price: 250 },
    },
  },
  {
    listing_id: 'hotel_001',
    name: 'Riverside Residence Bangkok',
    provider_type: 'hotel',
    location: 'Bangkok',
    area: 'Riverside',
    description: 'Rooms over the river with a rooftop pool.',
    features: ['river view', 'pool', 'breakfast'],
    max_party: 4,
    opens: '14:00',
    closes: '23:59',
    rooms: { double: 2400, twin: 2400, suite: 5200 },
  },
  {
    listing_id: 'hotel_002',
    name: 'Sukhumvit Garden Hotel',
    provider_type: 'hotel',
    location: 'Bangkok',
    area: 'Sukhumvit',
    description: 'A low-rise hotel around a quiet garden and pool.',
    features: ['quiet', 'garden', 'pool', 'family'],
    max_party: 5,
    opens: '14:00',
    closes: '23:59',
    rooms: { double: 1800, family: 3200 },
  },
  {
    listing_id: 'hotel_003',
    name: 'Old Town Boutique Stay',
    provider_type: 'hotel',
    location: 'Bangkok',
    area: 'Rattanakosin',
    description: 'A restored shophouse near the Grand Palace.',
    features: ['quiet', 'historic', 'breakfast'],
    max_party: 2,
    opens: '14:00',
    closes: '23:59',
    rooms: { single: 1300, double: 2100 },
  },
];

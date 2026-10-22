import { describe, expect, it } from 'vitest';
import { DEMO_LISTINGS } from '../mcp/demoData';
import { details } from './replies';

const listing = (id: string) => DEMO_LISTINGS.find((candidate) => candidate.listing_id === id)!;

describe('details', () => {
  it('says what the details sheet shows', () => {
    expect(details(listing('rest_002'))).toBe(
      'Riverside Social: a lively riverside restaurant with group seating. Features: river view, lively, outdoor seating.',
    );
    expect(details(listing('salon_001'))).toBe(
      'Lotus Glow Salon: a neighborhood salon offering hair and nail appointments. Features: quiet, accessible. Services: haircut, manicure.',
    );
    expect(details(listing('hotel_002'))).toBe(
      "Old Town House: a small hotel near Bangkok's historic district. Features: quiet, historic district. Rooms: standard, suite.",
    );
  });
});

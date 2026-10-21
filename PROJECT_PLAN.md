# Project Plan: Hospitality Reservation MCP

## Product statement

An Alexa-style conversational reservation agent that searches and manages restaurant tables, salon services, and hotel rooms through one MCP interface.

## Demonstration scope

Implement one complete flow end to end and show shorter examples for the other provider types:

1. Search by location, date, time, party size, service, or room type.
2. Display options with transparent reasons.
3. Create a short booking hold.
4. Confirm the booking after explicit user approval.
5. Modify or cancel the booking.
6. Handle a slot conflict and suggest alternatives.

## Smallest useful tool set

- `search_availability`
- `get_listing_details`
- `create_booking_hold`
- `confirm_booking`
- `modify_booking`
- `cancel_booking`
- `get_booking`

Avoid separate tools for every provider. Use a `provider_type` field with values `restaurant`, `salon`, or `hotel`.

## Suggested demo script

“Find a quiet restaurant for two tomorrow at 7 PM.”

The agent searches, shows options, creates a hold, and asks for confirmation. Then show a conflict: the held time expires or becomes unavailable, and the agent proposes two nearby times. Finish by modifying or cancelling the confirmed booking.

## Architecture

```text
React web simulator
        |
        | Streamable HTTP / MCP
        v
Python MCP server
        |
        +-- reservation service
        +-- provider adapters
        +-- SQLite/seed data
        +-- optional LLM intent layer
```

## Scope rule

The three provider types should share schemas and business logic. Do not build three independent products. A coherent cross-provider workflow scores better than three unfinished dashboards.

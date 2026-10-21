# MCP Contract v0.2

This is the shared implementation contract for the backend and frontend. Any
breaking change must be agreed by both teammates before code using it is merged.

The server exposes exactly the seven tools documented below. Health checks use
the plain HTTP route `GET /health` and must not appear in `tools/list`.

## Protocol and transport

- Endpoint: `http://127.0.0.1:8000/mcp` in local development.
- Transport: MCP Streamable HTTP, not the legacy standalone SSE transport.
- Demo protocol version: `2025-11-25` so the browser visibly performs
  `initialize`, `tools/list`, and `tools/call`.
- The browser must retain and resend `Mcp-Session-Id` when the server returns it.
- Tool success payloads are returned as structured content.
- JSON-RPC envelope and protocol failures use normal MCP/JSON-RPC errors.
- Tool dispatch and input-schema validation failures use the official SDK's
  `isError: true` tool result with a text diagnostic. Clients must not parse
  that diagnostic as a stable structured payload.
- Business failures use an MCP tool result with `isError: true` and the
  structured error payload described below.

## Common values

`provider_type`: `restaurant` | `salon` | `hotel`

`booking_status`: `held` | `confirmed` | `cancelled` | `expired`

Rules:

- Dates use `YYYY-MM-DD`.
- Search times use local `HH:MM` time.
- Returned timestamps use timezone-aware RFC 3339, for example
  `2026-10-23T19:00:00+07:00`.
- Monetary `price` values are JSON numbers and always include a three-letter
  `currency` code.
- Identifiers are opaque strings. Clients must not parse or manufacture them.
- Demo data is synthetic. Do not enter real customer information.

## Shared availability object

Every result from `search_availability` has this shape. `availability_id` is the
stable identifier passed to `create_booking_hold` or `modify_booking`.

```json
{
  "availability_id": "avail_rest_001_20261023_1900",
  "listing_id": "rest_001",
  "name": "Example Table",
  "provider_type": "restaurant",
  "location": "Bangkok",
  "start_time": "2026-10-23T19:00:00+07:00",
  "end_time": "2026-10-23T21:00:00+07:00",
  "party_size": 2,
  "service_type": null,
  "room_type": null,
  "price": 0,
  "currency": "THB",
  "reason": "Quiet seating and a two-person table are available"
}
```

## Shared booking result

Booking tools return the current booking plus a user-readable summary.
`expires_at` is a timestamp while a booking is held and `null` otherwise.

```json
{
  "booking": {
    "booking_id": "booking_001",
    "availability_id": "avail_rest_001_20261023_1900",
    "listing_id": "rest_001",
    "provider_type": "restaurant",
    "status": "held",
    "start_time": "2026-10-23T19:00:00+07:00",
    "end_time": "2026-10-23T21:00:00+07:00",
    "guest_name": "Demo Guest",
    "guest_contact": "demo@example.com",
    "party_size": 2,
    "service_type": null,
    "room_type": null,
    "expires_at": "2026-10-23T18:35:00+07:00",
    "created_at": "2026-10-23T18:30:00+07:00",
    "updated_at": "2026-10-23T18:30:00+07:00"
  },
  "summary": "Table held for Demo Guest at 7:00 PM until 6:35 PM."
}
```

## Shared business-error payload

The MCP tool result sets `isError: true`. `alternatives` is included for an
availability conflict and otherwise is an empty array.

```json
{
  "error": {
    "code": "slot_unavailable",
    "message": "That time is no longer available.",
    "retryable": true,
    "booking_id": null,
    "current_status": null
  },
  "alternatives": []
}
```

Stable business error codes:

- `availability_not_found`
- `listing_not_found`
- `booking_not_found`
- `slot_unavailable`
- `hold_expired`
- `confirmation_required`
- `invalid_state`

## `search_availability`

Searches one provider type. `party_size` defaults to `1`; provider-specific
fields can be `null`. A restaurant uses party size and preferences, a salon uses
service type, and a hotel uses room type and occupancy. Missing service or room
type means "show all matching options."

Input:

```json
{
  "provider_type": "restaurant",
  "location": "Bangkok",
  "date": "2026-10-23",
  "time": "19:00",
  "party_size": 2,
  "service_type": null,
  "room_type": null,
  "preferences": ["quiet"]
}
```

Output:

```json
{
  "results": [
    {
      "availability_id": "avail_rest_001_20261023_1900",
      "listing_id": "rest_001",
      "name": "Example Table",
      "provider_type": "restaurant",
      "location": "Bangkok",
      "start_time": "2026-10-23T19:00:00+07:00",
      "end_time": "2026-10-23T21:00:00+07:00",
      "party_size": 2,
      "service_type": null,
      "room_type": null,
      "price": 0,
      "currency": "THB",
      "reason": "Quiet seating and a two-person table are available"
    }
  ]
}
```

An empty search is a successful response with `"results": []`.

## `get_listing_details`

Input:

```json
{ "listing_id": "rest_001" }
```

Output:

```json
{
  "listing": {
    "listing_id": "rest_001",
    "name": "Example Table",
    "provider_type": "restaurant",
    "location": "Bangkok",
    "timezone": "Asia/Bangkok",
    "description": "A quiet neighborhood restaurant.",
    "features": ["quiet", "indoor seating"],
    "service_types": [],
    "room_types": []
  }
}
```

## `create_booking_hold`

Creates a five-minute hold. The server derives the listing and timestamps from
`availability_id`; it never trusts client-supplied availability timestamps.

Input:

```json
{
  "availability_id": "avail_rest_001_20261023_1900",
  "guest_name": "Demo Guest",
  "guest_contact": "demo@example.com",
  "party_size": 2
}
```

Output: the shared booking result with `status: "held"` and `expires_at`.

## `confirm_booking`

Input:

```json
{
  "booking_id": "booking_001",
  "user_confirmed": true
}
```

Rules:

- `user_confirmed` must be exactly `true`; otherwise return
  `confirmation_required` without changing state.
- An active hold becomes `confirmed` and its `expires_at` becomes `null`.
- Confirming an already confirmed booking is idempotent and returns it unchanged.
- An expired or cancelled booking cannot be confirmed.

Output: the shared booking result.

## `modify_booking`

The client first searches for a replacement availability and passes its stable
identifier. At least one of `new_availability_id` or `party_size` is required.

Input:

```json
{
  "booking_id": "booking_001",
  "new_availability_id": "avail_rest_001_20261023_1930",
  "party_size": 2
}
```

Rules:

- Held and confirmed bookings can be modified.
- A held booking keeps its original expiry deadline.
- A confirmed booking stays confirmed.
- The change is atomic: on conflict the original booking is unchanged and the
  error includes up to two nearby alternatives.
- Cancelled and expired bookings cannot be modified.

Output: the shared booking result.

## `cancel_booking`

Input:

```json
{ "booking_id": "booking_001" }
```

Rules:

- Held and confirmed bookings become `cancelled`.
- Cancelling an already cancelled booking is idempotent.
- An expired booking remains expired and returns `invalid_state`.

Output: the shared booking result.

## `get_booking`

Input:

```json
{ "booking_id": "booking_001" }
```

The server applies hold expiry before returning the booking. Output is the shared
booking result with the current status.

## Conflict alternatives

`create_booking_hold` and `modify_booking` return up to two availability objects
when the requested option conflicts. Alternatives must match the provider,
listing constraints, requested party size, service type or room type, and be the
nearest available times on the requested date.

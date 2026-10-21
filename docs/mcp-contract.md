# MCP Contract v0.1

The backend and frontend must follow this contract. Change it only after both teammates agree.

## Common values

`provider_type`: `restaurant` | `salon` | `hotel`

## `search_availability`

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
      "listing_id": "rest_001",
      "name": "Example Table",
      "provider_type": "restaurant",
      "location": "Bangkok",
      "start_time": "2026-10-23T19:00:00+07:00",
      "end_time": "2026-10-23T21:00:00+07:00",
      "price": 0,
      "currency": "THB",
      "reason": "Quiet seating and two-person table available"
    }
  ]
}
```

## `get_listing_details`

Input: `{ "listing_id": "rest_001" }`

## `create_booking_hold`

Input:

```json
{
  "listing_id": "rest_001",
  "start_time": "2026-10-23T19:00:00+07:00",
  "end_time": "2026-10-23T21:00:00+07:00",
  "guest_name": "Demo Guest",
  "guest_contact": "demo@example.com",
  "party_size": 2
}
```

Output includes `booking_id`, `status: "held"`, `expires_at`, and a summary.

## `confirm_booking`, `modify_booking`, `cancel_booking`, `get_booking`

All operations must return the current booking status and a human-readable summary. Confirmation must be an explicit action; never confirm solely because the user searched.

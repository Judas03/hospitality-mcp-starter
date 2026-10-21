from __future__ import annotations

from datetime import date

import pytest
from mcp import Client

from server.mcp_server import create_mcp_server
from server.service import ReservationService
from tests.conftest import MutableClock


@pytest.mark.asyncio
async def test_tool_discovery_and_calls_use_structured_results(
    service: ReservationService,
) -> None:
    mcp = create_mcp_server(service)
    async with Client(mcp, mode="legacy") as client:
        listed = await client.list_tools()
        names = [tool.name for tool in listed.tools]
        assert names == [
            "search_availability",
            "get_listing_details",
            "create_booking_hold",
            "confirm_booking",
            "modify_booking",
            "cancel_booking",
            "get_booking",
        ]
        assert all(tool.input_schema.get("type") == "object" for tool in listed.tools)

        searched = await client.call_tool(
            "search_availability",
            {
                "provider_type": "restaurant",
                "location": "Bangkok",
                "date": date(2026, 10, 23).isoformat(),
                "time": "19:00:00",
                "party_size": 2,
                "preferences": ["quiet"],
            },
        )
        assert searched.is_error is False
        option = searched.structured_content["results"][0]

        held = await client.call_tool(
            "create_booking_hold",
            {
                "availability_id": option["availability_id"],
                "guest_name": "Demo Guest",
                "guest_contact": "demo@example.com",
                "party_size": 2,
            },
        )
        assert held.is_error is False
        booking_id = held.structured_content["booking"]["booking_id"]

        refused = await client.call_tool(
            "confirm_booking",
            {"booking_id": booking_id, "user_confirmed": False},
        )
        assert refused.is_error is True
        assert refused.structured_content["error"]["code"] == "confirmation_required"

        confirmed = await client.call_tool(
            "confirm_booking",
            {"booking_id": booking_id, "user_confirmed": True},
        )
        assert confirmed.is_error is False
        assert confirmed.structured_content["booking"]["status"] == "confirmed"


@pytest.mark.asyncio
async def test_mcp_lifecycle_errors_and_idempotency(
    service: ReservationService,
    clock: MutableClock,
) -> None:
    mcp = create_mcp_server(service)
    search_args = {
        "provider_type": "restaurant",
        "location": "Bangkok",
        "date": date(2026, 10, 23).isoformat(),
        "time": "19:00:00",
        "party_size": 2,
        "preferences": ["quiet"],
    }

    async with Client(mcp, mode="legacy") as client:
        invalid_provider = await client.call_tool(
            "search_availability",
            {**search_args, "provider_type": "spa"},
        )
        assert invalid_provider.is_error is True

        unavailable = await client.call_tool(
            "search_availability",
            {**search_args, "location": "Phuket"},
        )
        assert unavailable.is_error is False
        assert unavailable.structured_content == {"results": []}

        searched = await client.call_tool("search_availability", search_args)
        options = searched.structured_content["results"]
        original_availability_id = options[0]["availability_id"]
        replacement_availability_id = options[1]["availability_id"]

        held = await client.call_tool(
            "create_booking_hold",
            {
                "availability_id": original_availability_id,
                "guest_name": "Judge One",
                "guest_contact": "judge-one@example.com",
                "party_size": 2,
            },
        )
        assert held.is_error is False
        booking_id = held.structured_content["booking"]["booking_id"]

        conflict = await client.call_tool(
            "create_booking_hold",
            {
                "availability_id": original_availability_id,
                "guest_name": "Judge Two",
                "guest_contact": "judge-two@example.com",
                "party_size": 2,
            },
        )
        assert conflict.is_error is True
        assert conflict.structured_content["error"]["code"] == "slot_unavailable"

        first_confirmation = await client.call_tool(
            "confirm_booking",
            {"booking_id": booking_id, "user_confirmed": True},
        )
        duplicate_confirmation = await client.call_tool(
            "confirm_booking",
            {"booking_id": booking_id, "user_confirmed": True},
        )
        assert first_confirmation.is_error is False
        assert duplicate_confirmation.is_error is False
        assert duplicate_confirmation.structured_content["booking"]["status"] == "confirmed"

        modified = await client.call_tool(
            "modify_booking",
            {
                "booking_id": booking_id,
                "new_availability_id": replacement_availability_id,
                "party_size": 2,
            },
        )
        assert modified.is_error is False
        assert modified.structured_content["booking"]["status"] == "confirmed"
        assert (
            modified.structured_content["booking"]["availability_id"]
            == replacement_availability_id
        )

        cancelled = await client.call_tool("cancel_booking", {"booking_id": booking_id})
        repeated_cancel = await client.call_tool("cancel_booking", {"booking_id": booking_id})
        assert cancelled.is_error is False
        assert repeated_cancel.is_error is False
        assert repeated_cancel.structured_content["booking"]["status"] == "cancelled"

        expiry_search = await client.call_tool("search_availability", search_args)
        expiry_availability_id = expiry_search.structured_content["results"][0]["availability_id"]
        expiring_hold = await client.call_tool(
            "create_booking_hold",
            {
                "availability_id": expiry_availability_id,
                "guest_name": "Expiry Judge",
                "guest_contact": "expiry@example.com",
                "party_size": 2,
            },
        )
        expiring_booking_id = expiring_hold.structured_content["booking"]["booking_id"]
        clock.advance(seconds=301)

        expired = await client.call_tool(
            "get_booking",
            {"booking_id": expiring_booking_id},
        )
        assert expired.is_error is False
        assert expired.structured_content["booking"]["status"] == "expired"

        expired_confirmation = await client.call_tool(
            "confirm_booking",
            {"booking_id": expiring_booking_id, "user_confirmed": True},
        )
        assert expired_confirmation.is_error is True
        assert expired_confirmation.structured_content["error"]["code"] == "hold_expired"

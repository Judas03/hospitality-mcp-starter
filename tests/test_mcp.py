from __future__ import annotations

from datetime import date

import pytest
from mcp import Client

from server.mcp_server import create_mcp_server
from server.service import ReservationService


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

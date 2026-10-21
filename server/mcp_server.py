"""Hospitality reservation MCP server and Streamable HTTP application."""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import date as Date
from datetime import time as Time
from typing import Annotated

import uvicorn
from dotenv import load_dotenv
from mcp.server import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import CallToolResult, TextContent
from pydantic import BaseModel, Field, StrictBool
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Mount

from server.models import (
    BookingIdRequest,
    ConfirmBookingRequest,
    CreateBookingHoldRequest,
    ModifyBookingRequest,
    ProviderType,
    SearchAvailabilityRequest,
)
from server.repository import ReservationRepository
from server.service import BusinessError, ReservationService


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8000
    database_path: str = "data/hospitality.db"
    hold_ttl_seconds: int = 300
    allowed_hosts: tuple[str, ...] = ("127.0.0.1", "localhost")
    allowed_origins: tuple[str, ...] = (
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    )

    @classmethod
    def from_env(cls) -> Settings:
        load_dotenv()
        return cls(
            host=os.getenv("MCP_HOST", cls.host),
            port=int(os.getenv("MCP_PORT", str(cls.port))),
            database_path=os.getenv("HOSPITALITY_DB_PATH", cls.database_path),
            hold_ttl_seconds=int(os.getenv("HOLD_TTL_SECONDS", str(cls.hold_ttl_seconds))),
            allowed_hosts=tuple(
                item.strip()
                for item in os.getenv("MCP_ALLOWED_HOSTS", ",".join(cls.allowed_hosts)).split(",")
                if item.strip()
            ),
            allowed_origins=tuple(
                item.strip()
                for item in os.getenv(
                    "MCP_ALLOWED_ORIGINS", ",".join(cls.allowed_origins)
                ).split(",")
                if item.strip()
            ),
        )


def _as_tool_result(payload: BaseModel, *, is_error: bool = False) -> CallToolResult:
    structured = payload.model_dump(mode="json")
    return CallToolResult(
        content=[
            TextContent(
                type="text",
                text=json.dumps(structured, ensure_ascii=False, separators=(",", ":")),
            )
        ],
        structuredContent=structured,
        isError=is_error,
    )


def _execute(action: Callable[[], BaseModel]) -> CallToolResult:
    try:
        return _as_tool_result(action())
    except BusinessError as error:
        return _as_tool_result(error.response, is_error=True)


def create_mcp_server(service: ReservationService) -> MCPServer:
    mcp = MCPServer(
        "Hospitality Reservation MCP",
        version="0.2.0",
        instructions=(
            "Search restaurant, salon, and hotel availability; create a temporary hold; "
            "confirm only after explicit user approval; then retrieve, modify, or cancel bookings."
        ),
    )

    @mcp.custom_route("/health", methods=["GET"])
    async def health_check(request: Request) -> Response:
        return JSONResponse({"status": "ok", "service": "hospitality-reservation-mcp"})

    @mcp.tool()
    def search_availability(
        provider_type: Annotated[
            ProviderType,
            Field(description="Reservation category: restaurant, salon, or hotel."),
        ],
        location: Annotated[
            str,
            Field(min_length=1, max_length=200, description="City or service area, such as Bangkok."),
        ],
        date: Annotated[Date, Field(description="Requested local date in YYYY-MM-DD format.")],
        time: Annotated[Time, Field(description="Preferred local start time in HH:MM format.")],
        party_size: Annotated[
            int, Field(ge=1, le=20, description="Number of guests; use 1 for a salon appointment.")
        ] = 1,
        service_type: Annotated[
            str | None,
            Field(max_length=100, description="Salon service such as haircut or manicure."),
        ] = None,
        room_type: Annotated[
            str | None,
            Field(max_length=100, description="Hotel room type such as standard, deluxe, or suite."),
        ] = None,
        preferences: Annotated[
            list[str] | None,
            Field(description="Desired listing features such as quiet or river view."),
        ] = None,
    ) -> CallToolResult:
        """Search real demo inventory and explain why each option matches."""
        request = SearchAvailabilityRequest(
            provider_type=provider_type,
            location=location,
            date=date,
            time=time,
            party_size=party_size,
            service_type=service_type,
            room_type=room_type,
            preferences=preferences or [],
        )
        return _execute(lambda: service.search_availability(request))

    @mcp.tool()
    def get_listing_details(
        listing_id: Annotated[
            str,
            Field(min_length=1, max_length=200, description="Listing ID returned by search_availability."),
        ],
    ) -> CallToolResult:
        """Return descriptive details and supported services or room types for one listing."""
        return _execute(lambda: service.get_listing_details(listing_id))

    @mcp.tool()
    def create_booking_hold(
        availability_id: Annotated[
            str,
            Field(
                min_length=1,
                max_length=200,
                description="Opaque availability ID returned by search_availability.",
            ),
        ],
        guest_name: Annotated[
            str, Field(min_length=1, max_length=200, description="Synthetic demo guest name.")
        ],
        guest_contact: Annotated[
            str,
            Field(min_length=1, max_length=200, description="Synthetic demo email or phone contact."),
        ],
        party_size: Annotated[int, Field(ge=1, le=20, description="Number of guests.")],
    ) -> CallToolResult:
        """Create a short booking hold without confirming the reservation."""
        request = CreateBookingHoldRequest(
            availability_id=availability_id,
            guest_name=guest_name,
            guest_contact=guest_contact,
            party_size=party_size,
        )
        return _execute(lambda: service.create_booking_hold(request))

    @mcp.tool()
    def confirm_booking(
        booking_id: Annotated[
            str,
            Field(min_length=1, max_length=200, description="Booking ID returned by create_booking_hold."),
        ],
        user_confirmed: Annotated[
            StrictBool,
            Field(description="Must be true only after the user explicitly approves the booking."),
        ],
    ) -> CallToolResult:
        """Confirm an active hold only after explicit user approval."""
        request = ConfirmBookingRequest(
            booking_id=booking_id,
            user_confirmed=user_confirmed,
        )
        return _execute(lambda: service.confirm_booking(request))

    @mcp.tool()
    def modify_booking(
        booking_id: Annotated[
            str, Field(min_length=1, max_length=200, description="Existing booking ID.")
        ],
        new_availability_id: Annotated[
            str | None,
            Field(
                min_length=1,
                max_length=200,
                description="Replacement availability ID returned by a new search.",
            ),
        ] = None,
        party_size: Annotated[
            int | None,
            Field(ge=1, le=20, description="Replacement party size, if it is changing."),
        ] = None,
    ) -> CallToolResult:
        """Atomically change an active held or confirmed booking."""
        if new_availability_id is None and party_size is None:
            from server.models import BusinessErrorCode, BusinessErrorResponse, ErrorDetails

            return _as_tool_result(
                BusinessErrorResponse(
                    error=ErrorDetails(
                        code=BusinessErrorCode.INVALID_STATE,
                        message="new_availability_id or party_size is required.",
                        retryable=True,
                        booking_id=booking_id,
                    )
                ),
                is_error=True,
            )
        request = ModifyBookingRequest(
            booking_id=booking_id,
            new_availability_id=new_availability_id,
            party_size=party_size,
        )
        return _execute(lambda: service.modify_booking(request))

    @mcp.tool()
    def cancel_booking(
        booking_id: Annotated[
            str, Field(min_length=1, max_length=200, description="Booking ID to cancel.")
        ],
    ) -> CallToolResult:
        """Cancel an active booking; repeating the call is safe."""
        request = BookingIdRequest(booking_id=booking_id)
        return _execute(lambda: service.cancel_booking(request))

    @mcp.tool()
    def get_booking(
        booking_id: Annotated[
            str, Field(min_length=1, max_length=200, description="Booking ID to retrieve.")
        ],
    ) -> CallToolResult:
        """Return the current booking status after applying hold expiry."""
        request = BookingIdRequest(booking_id=booking_id)
        return _execute(lambda: service.get_booking(request))

    return mcp


def _expanded_hosts(hosts: tuple[str, ...]) -> list[str]:
    expanded: list[str] = []
    for host in hosts:
        if host not in expanded:
            expanded.append(host)
        if ":" not in host and f"{host}:*" not in expanded:
            expanded.append(f"{host}:*")
    return expanded


def create_http_app(mcp: MCPServer, settings: Settings) -> Starlette:
    security = TransportSecuritySettings(
        allowed_hosts=_expanded_hosts(settings.allowed_hosts),
        allowed_origins=list(settings.allowed_origins),
    )
    mcp_app = mcp.streamable_http_app(
        streamable_http_path="/mcp",
        json_response=True,
        stateless_http=False,
        transport_security=security,
        host=settings.host,
    )

    @asynccontextmanager
    async def lifespan(app: Starlette):
        async with mcp.session_manager.run():
            yield

    return Starlette(
        routes=[Mount("/", app=mcp_app)],
        middleware=[
            Middleware(
                CORSMiddleware,
                allow_origins=list(settings.allowed_origins),
                allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
                allow_headers=[
                    "Accept",
                    "Authorization",
                    "Content-Type",
                    "Last-Event-ID",
                    "Mcp-Protocol-Version",
                    "Mcp-Session-Id",
                ],
                expose_headers=["Mcp-Session-Id"],
            )
        ],
        lifespan=lifespan,
    )


def create_default_components() -> tuple[Settings, ReservationService, MCPServer, Starlette]:
    settings = Settings.from_env()
    repository = ReservationRepository(settings.database_path)
    repository.initialize()
    service = ReservationService(
        repository,
        hold_ttl_seconds=settings.hold_ttl_seconds,
    )
    mcp = create_mcp_server(service)
    app = create_http_app(mcp, settings)
    return settings, service, mcp, app


settings, service, mcp, app = create_default_components()


if __name__ == "__main__":
    uvicorn.run(app, host=settings.host, port=settings.port)

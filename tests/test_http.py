from __future__ import annotations

from starlette.testclient import TestClient

from server.mcp_server import Settings, create_http_app, create_mcp_server
from server.service import ReservationService


def test_streamable_http_initialize_list_call_and_health(
    service: ReservationService,
) -> None:
    mcp = create_mcp_server(service)
    settings = Settings(
        database_path="unused-in-this-test.db",
        allowed_hosts=("testserver",),
        allowed_origins=("http://testclient",),
    )
    app = create_http_app(mcp, settings)
    base_headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        "Origin": "http://testclient",
    }

    with TestClient(app, base_url="http://testserver") as client:
        health = client.get("/health", headers={"Origin": "http://testclient"})
        assert health.status_code == 200
        assert health.json()["status"] == "ok"

        initialized = client.post(
            "/mcp",
            headers=base_headers,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "clientInfo": {"name": "pytest-browser", "version": "1.0"},
                },
            },
        )
        assert initialized.status_code == 200
        assert initialized.json()["result"]["protocolVersion"] == "2025-11-25"
        session_id = initialized.headers["mcp-session-id"]
        session_headers = {**base_headers, "Mcp-Session-Id": session_id}

        notification = client.post(
            "/mcp",
            headers=session_headers,
            json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        )
        assert notification.status_code in (200, 202)

        tools = client.post(
            "/mcp",
            headers=session_headers,
            json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
        )
        assert tools.status_code == 200
        names = [tool["name"] for tool in tools.json()["result"]["tools"]]
        assert len(names) == 7
        assert "health_check" not in names

        called = client.post(
            "/mcp",
            headers=session_headers,
            json={
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "search_availability",
                    "arguments": {
                        "provider_type": "hotel",
                        "location": "Bangkok",
                        "date": "2026-10-23",
                        "time": "15:00:00",
                        "party_size": 2,
                        "room_type": "standard",
                    },
                },
            },
        )
        assert called.status_code == 200
        result = called.json()["result"]
        assert result["isError"] is False
        assert result["structuredContent"]["results"]

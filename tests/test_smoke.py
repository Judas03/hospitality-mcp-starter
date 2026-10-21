from server.mcp_server import health_check


def test_health_check() -> None:
    assert health_check()["status"] == "ok"

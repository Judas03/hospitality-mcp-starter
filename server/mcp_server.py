"""Minimal placeholder MCP server.

The backend owner should implement the tools from docs/mcp-contract.md.
This file intentionally starts with a health-check tool so the environment
can be verified before the full booking logic is added.
"""

from mcp.server.mcpserver import MCPServer

mcp = MCPServer("Hospitality Reservation MCP", version="0.1.0")


@mcp.tool()
def health_check() -> dict[str, str]:
    """Return server status while the remaining tools are being implemented."""
    return {"status": "ok", "service": "hospitality-reservation-mcp"}


if __name__ == "__main__":
    mcp.run(transport="streamable-http", host="127.0.0.1", port=8000)

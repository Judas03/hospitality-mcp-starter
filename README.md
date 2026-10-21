# Hospitality Reservation MCP

An Alexa-style restaurant, salon, and hotel reservation experience built for the Alexa+ hackathon track.

## What this project contains

- A Python MCP server using Streamable HTTP and MCP `2025-11-25` or later.
- A shared tool contract for both teammates.
- Seed data and adapter boundaries for restaurant, salon, and hotel providers.
- A simple browser-client placeholder.

## Important hackathon interpretation

Amazon's Alexa+ developer console and gated Alexa+ SDK tools are not available to ordinary hackathon participants. This project follows the allowed self-hosted MCP route and demonstrates it through a real browser MCP client. The endpoint uses Streamable HTTP and supports MCP protocol `2025-11-25` or later.

For the recorded demo, the browser must visibly send `initialize`, `tools/list`, and `tools/call`. This is a hackathon integration, not a claim that the project is connected to the production Alexa+ service.

Do not put production credentials or real customer data in this repository.

## Prerequisites

- Python 3.10+
- Node.js 20.19+ or 22.12+
- Git
- Python's built-in `venv` and `pip`

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate       # Windows: .venv\\Scripts\\activate
python -m pip install --upgrade pip
pip install -r requirements-dev.txt
cp .env.example .env            # Windows: copy .env.example .env
python -m server.mcp_server
```

The server will listen at `http://127.0.0.1:8000/mcp`.

The plain HTTP health endpoint is `http://127.0.0.1:8000/health`. It is not an MCP tool.

In a second terminal:

```bash
cd web
npm install
npm run dev
```

The backend includes deterministic restaurant, salon, and hotel inventory, SQLite booking holds, explicit confirmation, modification, cancellation, expiry, and conflict alternatives. Runtime data is created at `data/hospitality.db`; delete that generated file when you intentionally want to reset the demo.

The web app on this branch is currently a placeholder. The completed client must use the schemas in `docs/mcp-contract.md`, negotiate protocol `2025-11-25`, preserve `Mcp-Session-Id`, and show protocol calls in the demo UI.

## Verify the MCP server

```bash
python -m pytest
```

You can also use an MCP client or Inspector that supports Streamable HTTP and connect it to:

```text
http://127.0.0.1:8000/mcp
```

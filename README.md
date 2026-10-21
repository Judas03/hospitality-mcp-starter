# Hospitality Reservation MCP

An Alexa-style restaurant, salon, and hotel reservation experience built for the Alexa+ hackathon track.

## What this project contains

- A Python MCP server using Streamable HTTP and MCP `2025-11-25` or later.
- A shared tool contract for both teammates.
- Seed data and adapter boundaries for restaurant, salon, and hotel providers.
- A React web simulator (`web/`) that uses the server as a real MCP client and shows every protocol message.

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

## Web simulator

Open `http://127.0.0.1:5173` once both are running. The web simulator is an Alexa-style conversation for booking restaurant tables, salon appointments, and hotel rooms:

- It talks to the server with the official MCP TypeScript SDK over Streamable HTTP: `initialize` on protocol `2025-11-25`, then `tools/list` and `tools/call`, keeping `Mcp-Session-Id`. The MCP activity panel shows every message with its arguments and result.
- A request such as "Find a quiet restaurant for two tomorrow at 7 PM" becomes a `search_availability` call. Results show the server's reason for each option, and anything the assistant assumed is marked.
- A booking is held with a live countdown and confirmed only after the guest says yes (`user_confirmed: true`). It can then be moved to another time, changed to another party size, or cancelled. On a conflict, the page offers the server's alternatives.
- If the server restarts, the page opens a new session and retries. If the server is down, a banner says so.
- `?mode=demo` runs the same flow on a browser copy of the backend's inventory and rules, clearly labelled, for working without the server.
- `?script=main` plays the scripted demo for the video, including another guest taking a slot first. `docs/demo-script.md` has the narration and clicks.

To verify the web simulator:

```bash
cd web
npm test
npm run typecheck
npm run build
```

`web/README.md` covers other server addresses and ports, the tests that run against a live server, and the code layout.

## Verify the MCP server

```bash
python -m pytest
```

You can also use an MCP client or Inspector that supports Streamable HTTP and connect it to:

```text
http://127.0.0.1:8000/mcp
```

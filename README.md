# Hospitality Reservation MCP — Amazon Alexa+ Hackathon Starter

This starter is for a two-person team building a restaurant, salon, and hotel reservation experience for the Alexa+ track.

## What this starter contains

- A Python MCP server using Streamable HTTP and MCP `2025-11-25` or later.
- A shared tool contract for both teammates.
- Seed data and adapter boundaries for restaurant, salon, and hotel providers.
- A simple browser-client placeholder.
- Separate task prompts for Codex and Claude Code.
- A submission checklist and a three-day execution plan.

## Important hackathon interpretation

Amazon's Alexa+ developer console and gated Alexa+ SDK tools are not available to ordinary hackathon participants. This project follows the allowed self-hosted MCP route and demonstrates it through a real browser MCP client. The endpoint uses Streamable HTTP and supports MCP protocol `2025-11-25` or later.

For the recorded demo, the browser must visibly send `initialize`, `tools/list`, and `tools/call`. This is a hackathon integration, not a claim that the project is connected to the production Alexa+ service.

Do not put production credentials or real customer data in this repository.

## Prerequisites

- Python 3.10+
- Node.js 20.19+ or 22.12+
- Git
- Python's built-in `venv` and `pip`
- Codex or Claude Code

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

The web app is intentionally a placeholder. The frontend owner should implement the MCP client and conversation UI using the frozen schemas in `docs/mcp-contract.md`. The browser should negotiate protocol `2025-11-25`, preserve `Mcp-Session-Id`, and show the protocol calls in the demo UI.

## Verify the MCP server

```bash
python -m pytest
```

You can also use an MCP client or Inspector that supports Streamable HTTP and connect it to:

```text
http://127.0.0.1:8000/mcp
```

## Team workflow

1. Read `docs/mcp-contract.md` before coding.
2. Person A owns `server/` and `tests/`.
3. Person B owns `web/`.
4. Commit small changes and push frequently.
5. Never store API keys in Git.

## Amazon Devices Builder Tools

They are primarily for Fire TV/Vega development and are optional for this Alexa+ project. If you want to install them for AI coding context, run this from your normal terminal:

```bash
npx -y @amazon-devices/amazon-devices-buildertools-mcp@latest init-context
```

## Submission checklist

- Working MCP server using Streamable HTTP.
- Browser simulator visibly calling `initialize`, `tools/list`, and `tools/call`.
- Exactly seven functional reservation tools; health checks stay outside `tools/list`.
- GitHub repository with setup instructions.
- Public English demo video under three minutes.
- Product feedback for every SDK/API/tool used.
- Explanation of what was built or significantly changed during the hackathon.

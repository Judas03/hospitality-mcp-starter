# Hospitality Reservation MCP — Amazon Alexa+ Hackathon Starter

This starter is for a two-person team building a restaurant, salon, and hotel reservation experience for the Alexa+ track.

## What this starter contains

- A Python MCP server scaffold using Streamable HTTP.
- A shared tool contract for both teammates.
- Seed data and adapter boundaries for restaurant, salon, and hotel providers.
- A simple browser-client placeholder.
- Separate task prompts for Codex and Claude Code.
- A submission checklist and a three-day execution plan.

## Important hackathon interpretation

Amazon's Alexa+ developer console and gated Alexa+ SDK tools are not available to ordinary hackathon participants. The valid route is a self-hosted MCP server or Agent Skill, demonstrated through your own web client. The MCP endpoint must use Streamable HTTP and the required current protocol version.

Do not put production credentials or real customer data in this repository.

## Prerequisites

- Python 3.10+
- Node.js 18+
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

In a second terminal:

```bash
cd web
npm install
npm run dev
```

The web app is intentionally a placeholder. The frontend owner should implement the MCP client and conversation UI using `docs/mcp-contract.md`.

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

## Prompts

- Codex: `docs/codex-task-plan.md`
- Claude Code: `docs/claude-task-plan.md`

## Amazon Devices Builder Tools

They are primarily for Fire TV/Vega development and are optional for this Alexa+ project. If you want to install them for AI coding context, run this from your normal terminal:

```bash
npx -y @amazon-devices/amazon-devices-buildertools-mcp@latest init-context
```

## Submission checklist

- Working MCP server using Streamable HTTP.
- Browser simulator visibly calling `tools/list` and `tools/call`.
- GitHub repository with setup instructions.
- Public English demo video under three minutes.
- Product feedback for every SDK/API/tool used.
- Explanation of what was built or significantly changed during the hackathon.

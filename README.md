# Hospitality Concierge MCP

An Alexa-style hospitality concierge that searches and books restaurants, salons, and hotels through the Model Context Protocol (MCP). A React client turns conversational requests into real MCP tool calls while a Python service manages availability, temporary holds, confirmations, modifications, cancellations, and conflicts.

The assistant can handle one reservation or build an **Occasion Concierge** plan containing multiple reservations for the same day. Push-to-talk voice input is available in supported browsers, and every MCP request and response is visible in the activity panel.

This repository demonstrates a self-hosted MCP integration through a simulated Alexa+ web experience. It does not claim a connection to the production Alexa+ service, use real provider inventory, or process payments.

## What it demonstrates

- One shared reservation workflow works across three hospitality provider types.
- One request can create a coordinated salon, restaurant, and hotel itinerary.
- The browser uses the official MCP TypeScript SDK and visibly shows `initialize`, `tools/list`, and `tools/call` traffic.
- The Python server uses the official MCP SDK with Streamable HTTP.
- A reservation is never confirmed without explicit user approval.
- Holds expire, conflicts return nearby alternatives, and modifications are atomic.
- Multi-part plans release earlier holds if a later part fails.
- Push-to-talk fills the message box for review; voice alone never books or cancels anything.
- Deterministic synthetic data makes the complete scenario repeatable.

## Architecture

```text
React web simulator
  ├─ deterministic conversational request parser
  ├─ single-booking and Occasion Concierge workflows
  ├─ push-to-talk input and MCP activity log
  └─ official MCP TypeScript client
                    │
                    │ Streamable HTTP (/mcp)
                    ▼
Python MCP server
  ├─ seven typed MCP tools
  ├─ reservation service
  ├─ restaurant, salon, and hotel adapters
  └─ SQLite repository with deterministic inventory
```

## MCP tools

| Tool | Purpose |
| --- | --- |
| `search_availability` | Find matching restaurant, salon, or hotel options. |
| `get_listing_details` | Return provider details and supported services or room types. |
| `create_booking_hold` | Temporarily reserve an available option. |
| `confirm_booking` | Confirm an active hold after explicit approval. |
| `modify_booking` | Atomically change the time or party size. |
| `cancel_booking` | Cancel an active booking safely and idempotently. |
| `get_booking` | Read the current booking state after applying hold expiry. |

The complete schemas and error behavior are documented in [`docs/mcp-contract.md`](docs/mcp-contract.md).

## Requirements

- Python 3.10+
- Node.js 20.19+ or 22.12+
- Git

No external API key is required. All listings and guest details used by the demo are synthetic.

## Quick start

Create the Python environment and install the project dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements-dev.txt
cp .env.example .env            # Windows: copy .env.example .env
```

Start the MCP server:

```bash
python -m server.mcp_server
```

The endpoints are:

- MCP: `http://127.0.0.1:8000/mcp`
- Health: `http://127.0.0.1:8000/health`

In a second terminal, start the web client:

```bash
cd web
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`.

Try requests such as:

- `Find a quiet restaurant for two tomorrow at 7 PM`
- `Book a haircut for one tomorrow at 1 PM`
- `Find a river-view hotel for two tomorrow`
- `Plan my anniversary tomorrow: a manicure at 3 PM, a quiet dinner for two at 7 PM, and a river-view hotel`

For a single reservation, choose an option, create a temporary hold, and explicitly confirm it. For a multi-part request, review the Occasion Concierge panel, hold the whole plan, and then confirm the whole plan. You can modify or cancel a single booking and cancel an entire plan.

The microphone button uses the browser's speech-recognition support. It only transcribes speech into the message box; review the text and press Send to continue. Typing remains available when speech recognition is unsupported.

## Demo modes

- `http://127.0.0.1:5173/` uses the live Python MCP server.
- `http://127.0.0.1:5173/?script=main` runs a guided booking walkthrough against the live server.
- `http://127.0.0.1:5173/?mode=demo` uses deterministic in-browser data when a server is unavailable. The interface labels this mode clearly.

The guided walkthrough demonstrates search, a competing guest conflict, alternatives, hold, explicit confirmation, modification, and cancellation. Live mode is the primary integration path; browser-only demo mode is a clearly labeled fallback.

## How the booking flow stays safe

- Search results do not create a booking.
- A hold temporarily reserves a slot and expires automatically.
- Confirmation requires a live hold and `user_confirmed: true`.
- Duplicate confirmation and cancellation requests are safe.
- Conflicting holds return a stable error and nearby alternatives.
- A failed modification leaves the original confirmed booking unchanged.
- Occasion Concierge verifies every hold before confirmation and performs compensating cancellation if a multi-part operation fails.

## Configuration

Copy `.env.example` to `.env` and adjust values only when needed:

| Variable | Default | Description |
| --- | --- | --- |
| `MCP_HOST` | `127.0.0.1` | Server bind address. |
| `MCP_PORT` | `8000` | Server port. |
| `MCP_ALLOWED_HOSTS` | `127.0.0.1,localhost` | Accepted HTTP host names. |
| `MCP_ALLOWED_ORIGINS` | local Vite origins | Browser origins allowed by CORS. |
| `HOSPITALITY_DB_PATH` | `data/hospitality.db` | Runtime SQLite database path. |
| `HOLD_TTL_SECONDS` | `300` | Maximum hold duration in seconds. |

For a web client using another MCP address, create `web/.env.local` with:

```dotenv
VITE_MCP_URL=http://127.0.0.1:8000/mcp
```

Local `.env`, `.env.local`, databases, dependencies, and build artifacts are excluded from Git.

## Verification

Backend tests:

```bash
python -m pytest -q
```

Frontend tests, type checking, and production build:

```bash
cd web
npm test
npm run typecheck
npm run build
```

With the backend running, include the live MCP integration tests:

```bash
cd web
MCP_TEST_URL=http://127.0.0.1:8000/mcp npm test
```

The live suite verifies protocol negotiation, the seven-tool inventory, restaurant/salon/hotel parity, conflicts, alternatives, holds, confirmation, modification, cancellation, and invalid input handling.

## Data and safety

- Demo inventory and guest identities are synthetic.
- Secrets are read from local environment files and are not required for the included providers.
- Availability identifiers are opaque; the server derives trusted times and listing data from its own repository.
- Confirmation requires `user_confirmed: true`.
- SQLite overlap checks prevent held or confirmed bookings from sharing a slot.
- Expired holds are applied before availability or booking state is returned.

Runtime state is stored in `data/hospitality.db`. Use only disposable demo information when running this project.

## Scope and limitations

- Provider inventory is deterministic sample data behind replaceable restaurant, salon, and hotel adapters.
- The conversational parser is deterministic and intentionally supports a focused set of booking phrases; it is not a general-purpose language model.
- Browser speech recognition availability and processing depend on the browser vendor.
- SQLite is appropriate for this single-instance demonstration, not a horizontally scaled production deployment.
- The local server has no user authentication. Any internet deployment must add HTTPS, authentication, authorization, rate limiting, monitoring, and a production database.
- Multi-part plans use compensating cancellation rather than a distributed transaction, so the UI reports and retries any cleanup that the server has not confirmed.

## Repository layout

```text
server/                 Python MCP transport and reservation domain
tests/                  Backend, HTTP, lifecycle, and portability tests
web/src/mcp/            Live and deterministic MCP clients
web/src/booking/        Frontend booking workflow
web/src/itinerary/      Multi-reservation Occasion Concierge workflow
web/src/hooks/          Push-to-talk and UI support hooks
web/src/components/     Conversation, booking, and activity interfaces
docs/mcp-contract.md    Public tool and error contract
```

## License

This project is available under the [MIT License](LICENSE).

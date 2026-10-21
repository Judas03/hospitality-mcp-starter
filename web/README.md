# Web simulator

The browser client for the hospitality reservation MCP server. It talks to the server over
Streamable HTTP with the official MCP TypeScript SDK (`initialize` on protocol `2025-11-25`,
then `tools/list` and `tools/call`) and shows every message in the MCP activity panel.

## Run

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173. The page connects to `http://127.0.0.1:8000/mcp`, so start the
server first (`python -m server.mcp_server` in the repository root).

- **Different server address:** create `web/.env.local` with `VITE_MCP_URL=http://127.0.0.1:8100/mcp`
  (any `*.local` file stays out of Git). If the page itself runs on another port, add that
  origin to the server's `MCP_ALLOWED_ORIGINS` in the root `.env`.
- **Demo data:** add `?mode=demo` to the address, or use the switch in the top bar. Demo mode
  answers in the browser from a copy of the backend's sample inventory and rules, and every
  message in the activity panel is tagged `demo`.
- **Short holds for a recording (demo mode):** `?mode=demo&hold=20` makes holds last 20 seconds.

## Check

```bash
npm run typecheck
npm test
npm run build
```

`npm test` skips the tests that need a running server. To include them:

```bash
MCP_TEST_URL=http://127.0.0.1:8000/mcp npm test
```

They connect to the server, compare its search results with demo mode's, and run a booking
from hold to cancel on 15 January 2027, cancelling what they create.

## Where things are

- `src/contract/types.ts`: the fields from `docs/mcp-contract.md`, in one place.
- `src/mcp/liveClient.ts`, `src/mcp/loggingTransport.ts`: the MCP connection and the activity log feed.
- `src/mcp/demoClient.ts`, `src/mcp/demoData.ts`: demo mode, kept in step with the backend.
- `src/conversation/`: reading typed requests, replies and suggestion chips.
- `src/booking/`: the booking steps and the hook that runs them.
- `src/components/`: the conversation, booking panel and activity log.

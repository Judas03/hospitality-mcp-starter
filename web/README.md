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

## Occasion Concierge

One request can book a salon visit, a meal and a hotel stay together, for example "Plan my
anniversary tomorrow: a manicure for me at 3 PM, a quiet dinner for two at 7 PM and a river-view
hotel for two" (also a suggestion chip on the empty screen).

- A request becomes a plan only when it has parts in at least two of salon, restaurant and
  hotel. Everything else goes to the single-booking flow as before. A plan has one part per kind
  and one day.
- Every part is searched and shown in the plan panel. Each part takes the cheapest option at the
  first-ranked place and time, and you can change it there. Nothing is held until **Hold whole
  plan**.
- Parts are held one by one. If one can't be held, the earlier holds are released, and checked
  with the server, before the plan shows that part's alternatives.
- **Confirm whole plan** (or "yes") first checks every hold with the server and confirms nothing
  if one ran out. If a confirmation fails, everything held or booked is released.
- **Cancel whole plan** releases every booking. A booking the server doesn't show as released
  stays listed with its ID until **Retry cleanup** succeeds.
- If a hold request gets no answer, a hold the page can't see may exist. The plan stays locked
  (nothing can be held, dropped or started) until that hold has certainly run out (5 minutes),
  or **Check again** finds the option free in a fresh search.
- "Don't …" never does the step: "Don't confirm it" or "Do not cancel the plan" changes nothing,
  here and in single bookings.

## Push-to-talk

Hold the microphone button next to the message box (or focus it and hold Space or Enter) and
speak; let go to stop. What was heard goes into the message box for you to read and send.
Nothing is sent, held, confirmed or cancelled by voice alone, and Escape throws it away.

- It needs a browser with Web Speech recognition (Chrome, Edge or Safari). Elsewhere the button is
  off and typing works as usual.
- The app does not record or store audio. The browser does the speech recognition, which may be
  processed by the browser vendor's speech service and depends on that browser's microphone
  permission, availability and network. Typing always works.

## Recording the demo

Open the page with `?script=main` (add `&mode=demo` to run without the server). The only
suggestion is the next line of the script, so one click per step plays the whole story:

1. Find a quiet restaurant for two tomorrow at 7 PM
2. Hold the first one: just before this, another guest holds that 7:00 PM table through a
   second MCP session, so the hold fails and the server offers 6:30 or 7:30
3. Hold the 7:30 PM one
4. Yes, confirm it
5. Move it to 8 PM
6. Make it 3 people
7. Cancel my booking

The other guest's tool call is tagged "Another guest" in the activity panel, and the newest tool
call opens by itself so its arguments and result are on screen. The mode switch is hidden while
scripting. To record again against the live server, reload the same tab: it first cancels the
bookings the last take made, so the same slots are free.

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

In PowerShell: `$env:MCP_TEST_URL="http://127.0.0.1:8000/mcp"; npm test`.

They connect to the server, compare its search results with demo mode's, and run a booking
from hold to cancel on 15 January 2027. They also run an Occasion Concierge plan on 16 January
2027, including a second guest taking a table or a room so the plan has to release its earlier
holds. They cancel what they create.

## Where things are

- `src/contract/types.ts`: the fields from `docs/mcp-contract.md`, in one place.
- `src/mcp/liveClient.ts`, `src/mcp/loggingTransport.ts`: the MCP connection and the activity log feed.
- `src/mcp/demoClient.ts`, `src/mcp/demoData.ts`: demo mode, kept in step with the backend.
- `src/conversation/`: reading typed requests, replies and suggestion chips.
- `src/booking/`: the booking steps and the hook that runs them.
- `src/itinerary/`: the Occasion Concierge: reading a plan, its steps, and the MCP calls that run them.
- `src/hooks/useVoiceInput.ts`: push-to-talk.
- `src/components/`: the conversation, booking and plan panels, and the activity log.

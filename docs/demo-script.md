# Demo video script (2 minutes 45 seconds)

One take, seven clicks, English narration. The video must be public, in English and under
three minutes. This script runs 2:45, leaving 15 seconds of slack.

What the judges need to see, and where it happens:

| Requirement | Where |
| --- | --- |
| Browser sends `initialize`, `tools/list`, `tools/call` | Activity panel from 0:00; a `tools/call` on every click |
| MCP server over Streamable HTTP | Top bar: "Live server · MCP 2025-11-25"; closing line |
| One complete booking flow | Clicks 1 to 4 |
| Conflict | Click 2 |
| Modification and cancellation | Clicks 5 to 7 |

## Before you record

1. **Start the MCP server** from the repository root: `python -m server.mcp_server`.
   It listens on `http://127.0.0.1:8000/mcp`. On Windows it needs the `tzdata` package
   (`pip install tzdata`) until it is added to `requirements.txt`.
2. **Start the web page**: `cd web`, then `npm run dev`, then open
   `http://127.0.0.1:5173/?script=main`.
3. **Check the page is live**:
   - The top bar shows **Live server · MCP 2025-11-25**.
   - There is **no yellow "Demo mode" strip**.
   - The activity panel lists `initialize`, `notifications/initialized` and `tools/list`.
   - The only suggestion chip reads **Find a quiet restaurant for two tomorrow at 7 PM**.
4. **Set up the window**:
   - Browser at 1920×1080 and 100% zoom, with no other tabs and the bookmarks bar hidden.
   - Leave **Read replies aloud** off, so the page doesn't talk over you.
5. **Recorder**: record the browser window at 1080p with your microphone on.
6. **Retakes**: reload the same tab. It first cancels the bookings the last take made, so the
   7:00 PM table is free again. A new tab can't do this, so you'd have to wait 5 minutes for the
   old holds to expire.

Every click below is on the **single suggestion chip** under the conversation. Wait for the
assistant's reply (the ring stops spinning) before you click again. Speak over the screen; the
timings are for the narration.

## Run of show

| Time | Click | Tool calls in the activity panel |
| --- | --- | --- |
| 0:00 | None | `initialize`, `notifications/initialized`, `tools/list` (already there) |
| 0:20 | 1. Find a quiet restaurant for two tomorrow at 7 PM | `search_availability` |
| 0:40 | 2. Hold the first one | `create_booking_hold` tagged "Another guest" ✓, then yours ✕ |
| 1:05 | 3. Hold the 7:30 PM one | `create_booking_hold` ✓ |
| 1:20 | 4. Yes, confirm it | `confirm_booking` ✓ |
| 1:40 | 5. Move it to 8 PM | `search_availability`, `modify_booking` ✓ |
| 2:00 | 6. Make it 3 people | `modify_booking` ✓ |
| 2:15 | 7. Cancel my booking | `cancel_booking` ✓ |
| 2:25 | None | Closing |

## Narration

### 0:00 to 0:20: Opening (no click)

**On screen:** the empty page; the activity panel shows the three handshake messages.

**Say:** "This is our Alexa-style reservation assistant for the Alexa+ hackathon. It books
restaurant tables, salon appointments and hotel rooms through one self-hosted MCP server. On
the right is the real protocol traffic: the browser has already sent initialize and tools/list,
and found our seven tools."

### 0:20 to 0:40: Search (click 1)

**Click:** *Find a quiet restaurant for two tomorrow at 7 PM*

**On screen:** five times at Siam Serenity, each with a reason. The city chip is marked
"assumed". The newest `tools/call` opens in the activity panel.

**Say:** "Let's ask for a quiet restaurant for two tomorrow at 7 PM. That becomes one
search_availability call, and the server answers with five times at Siam Serenity, each with a
reason. Anything I didn't say, like the city, is marked as assumed."

### 0:40 to 1:05: Conflict (click 2)

**Click:** *Hold the first one*

**On screen:**
- A call tagged **Another guest** appears in the activity panel, then our `create_booking_hold` fails (✕).
- A yellow notice: "That option isn't available."
- The booking panel shows the two alternatives, 6:30 PM and 7:30 PM.

**Say:** "I'll hold the first one. But another guest, in a separate MCP session, grabs that
7 o'clock table a moment before us. You can see their call tagged in the log. Our hold fails
with slot unavailable, and instead of a dead end the server sends the two nearest free times."

### 1:05 to 1:20: Hold (click 3)

**Click:** *Hold the 7:30 PM one*

**On screen:** the hold card with a five-minute countdown, and "Nothing is booked until you confirm."

**Say:** "I'll take seven thirty. The table is held for five minutes, but nothing is booked
yet. The assistant asks first."

### 1:20 to 1:40: Confirm (click 4)

**Click:** *Yes, confirm it*

**On screen:** the green **Confirmed** ticket with its booking ID. In the activity panel,
`confirm_booking` with `"user_confirmed": true`.

**Say:** "Yes, confirm it. Only now does the browser call confirm booking, with user confirmed
set to true. The server never confirms just because we searched or held. Explicit approval
is part of our contract."

### 1:40 to 2:00: Change the time (click 5)

**Click:** *Move it to 8 PM*

**On screen:** `search_availability`, then `modify_booking`; the ticket now reads 8:00 PM.

**Say:** "Plans change. Move it to 8 PM. The client searches again, finds the 8 PM option at
the same restaurant, and calls modify booking with its ID. The change is atomic: if 8 PM were
taken, the original booking would stay exactly as it was."

### 2:00 to 2:15: Change the party (click 6)

**Click:** *Make it 3 people*

**On screen:** `modify_booking` again; the ticket reads 3 people.

**Say:** "Make it three people. That's another modify booking call, checked against the
table's capacity, and the booking stays confirmed."

### 2:15 to 2:25: Cancel (click 7)

**Click:** *Cancel my booking*

**On screen:** `cancel_booking`; the card turns to **Cancelled**.

**Say:** "And finally, cancel my booking. Cancelling is safe to repeat, so a retry on a bad
connection can never fail strangely."

### 2:25 to 2:45: Close (no click)

**On screen:** the cancelled card and the full activity log.

**Say:** "Under the hood: a Python MCP server on the official SDK over Streamable HTTP, with
SQLite holds that expire, and a React client on the official TypeScript MCP SDK. Every step
you saw was a real tools call, built during this hackathon. Thanks for watching."

## If something goes wrong

- **Step 1 shows fewer than five times, or no 7:00 PM:** an earlier booking still holds a
  slot. Reload the same tab, or stop the server, delete `data/hospitality.db` and start it again.
- **A red "Not connected" banner:** the server stopped. Start it again, click **Try again**, and
  start the take over.
- **Step 2 doesn't fail:** the other guest could not reach the server. Reload and start over.
- **The server can't run at all:** `?script=main&mode=demo` plays the same script on demo
  data in the browser. The yellow "Demo mode" strip stays visible, so if you use that take,
  say so in the narration.

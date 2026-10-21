# Claude Code task plan — frontend/demo owner

Use these prompts in order. The backend contract in `docs/mcp-contract.md` is authoritative.

## Task 1 — UI plan

```text
Read README.md, PROJECT_PLAN.md, and docs/mcp-contract.md. Design a polished but fast React web simulator for an Alexa-style hospitality reservation agent. It must show conversation, provider type, search results, booking holds, confirmation, modification, cancellation, conflict handling, and a visible MCP activity log. Return a component plan before editing.
```

## Task 2 — interface

```text
Implement the React interface in web/. Use realistic seed prompts and clear empty, loading, success, and error states. Keep the design accessible and focused on a three-minute demo. Do not invent backend fields; follow docs/mcp-contract.md.
```

## Task 3 — MCP client

```text
Connect the web client to the Python MCP server through Streamable HTTP. Implement initialize, tools/list, and tools/call. Show the actual tool name and result in the activity log. Handle session errors and unavailable server states clearly.
```

## Task 4 — demo quality

```text
Create a reliable demo mode that uses the same UI and tool-call flow but clearly indicates when local seed data is being used. Add one scripted conflict scenario and one modify/cancel scenario. Remove distracting features and optimize the main path for screen recording.
```

## Task 5 — handoff

```text
Write docs/demo-script.md with a 2-minute-45-second English narration and exact clicks. Verify that a clean checkout can install and run the frontend using the README instructions. List any backend contract mismatch without silently changing the contract.
```

# Codex task plan — backend owner

Use these prompts in order. Keep the MCP contract unchanged unless the teammate agrees.

## Task 1 — architecture

```text
Read README.md, PROJECT_PLAN.md, and docs/mcp-contract.md. Act as the backend lead. Inspect the repository and propose the smallest implementation that satisfies Alexa+ hackathon requirements: MCP protocol 2025-11-25 or later, Streamable HTTP, explicit confirmation, booking holds, conflicts, cancellation, and three provider adapters. Do not write code yet. Return risks and a file-by-file plan.
```

## Task 2 — server

```text
Implement the Python MCP server described by docs/mcp-contract.md. Use the official MCP Python SDK and Streamable HTTP. Add deterministic seed data, typed input/output models, provider adapters for restaurant, salon, and hotel, and clear errors. Keep secrets out of source. Run tests after implementation.
```

## Task 3 — quality

```text
Review the MCP server as a hackathon judge. Test tools/list and tools/call, booking hold expiry, duplicate confirmation, modification, cancellation, invalid provider_type, and unavailable slots. Fix bugs and add meaningful tests. Do not rewrite working code without evidence.
```

## Task 4 — integration

```text
Review the frontend contract and implement or fix the Streamable HTTP client integration. Make sure the browser can initialize the MCP session, list tools, call tools, and display structured results. Add a local demo mode only as a fallback, clearly labelled.
```

## Task 5 — submission review

```text
Perform a final submission audit against the Amazon Alexa+ rules. Check that the repository demonstrates real runtime MCP usage, Streamable HTTP, setup instructions, English documentation, and no secrets. Produce a short list of remaining blockers.
```

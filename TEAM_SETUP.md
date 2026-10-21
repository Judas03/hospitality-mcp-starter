# Two-person setup checklist

## Both teammates

1. Install Python 3.10+, Node.js 18+, Git, and `pip` (included with Python).
2. Extract the zip or clone the GitHub repository.
3. Run `./setup.sh` on macOS/Linux, or run the equivalent commands in `README.md` on Windows.
4. Create a branch using your name.
5. Do not commit `.env`, API keys, real customer data, or generated `node_modules`.

## Recommended branch ownership

- `backend-codex`: server, adapters, database, tests.
- `frontend-claude`: web UI, MCP client, demo experience.

## Before merging

```bash
python -m pytest
python -m server.mcp_server
```

The endpoint must remain `http://127.0.0.1:8000/mcp` unless both teammates update the contract and README.

## AI coding rule

Give both agents the same `docs/mcp-contract.md`. Ask each agent to inspect existing files before editing. Make one agent responsible for each file or directory, and review every generated change before committing.

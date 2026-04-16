# @relayon/mcp

Model Context Protocol (MCP) server for Relayon.io. Exposes the Relayon job engine to Claude Desktop, Cursor, VS Code, and any other MCP-capable AI agent through a zero-dep stdio server.

## What it does

Runs locally next to your agent, speaks JSON-RPC 2.0 over stdio, and wraps the Relayon REST API. Every job it creates is tagged `source="agent"` so the dashboard can segregate agent-driven traffic from developer-driven traffic.

Implemented tools:

| Tool | Description |
|---|---|
| `create_job` | Schedule a job (delay / run_at / cron, priority, approval gate) |
| `list_jobs` | List jobs filtered by status and/or source |
| `get_job` | Fetch full details for one job |
| `cancel_job` | Cancel a pending or paused job (destructive) |
| `pause_job` / `resume_job` | Pause / resume a pending job |
| `approve_job` | Approve a job waiting behind a human-approval gate (destructive) |
| `list_dlq` | List entries in the dead-letter queue |
| `replay_dlq` | Replay a DLQ entry as a fresh job |

## Install

```bash
npm install -g @relayon/mcp
# or run without installing:
npx @relayon/mcp
```

## Configure your agent

### Claude Desktop
`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "relayon": {
      "command": "npx",
      "args": ["-y", "@relayon/mcp"],
      "env": {
        "RELAYON_API_KEY": "rl_live_...",
        "RELAYON_BASE_URL": "https://api.relayon.io"
      }
    }
  }
}
```

### Cursor
`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "relayon": {
      "command": "npx",
      "args": ["-y", "@relayon/mcp"],
      "env": { "RELAYON_API_KEY": "rl_live_..." }
    }
  }
}
```

### VS Code
`.vscode/mcp.json`:

```json
{
  "servers": {
    "relayon": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@relayon/mcp"],
      "env": { "RELAYON_API_KEY": "rl_live_..." }
    }
  }
}
```

## Environment

| Variable | Required | Default | Notes |
|---|---|---|---|
| `RELAYON_API_KEY` | yes | — | Your `rl_live_...` key |
| `RELAYON_BASE_URL` | no | `http://localhost:3000` | Point at your Relayon instance |
| `RELAYON_TIMEOUT_MS` | no | `15000` | Per-request HTTP timeout |

## Protocol

- Transport: stdio, newline-delimited JSON-RPC 2.0
- MCP protocol version: `2024-11-05`
- Capabilities advertised: `tools`
- All diagnostics are written to `stderr` so they don't corrupt the protocol stream on `stdout`.

## License

MIT

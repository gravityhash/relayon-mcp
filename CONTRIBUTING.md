# Contributing to @relayon/mcp

Thanks for your interest! This is the official Model Context Protocol (MCP)
server for [Relayon.io](https://relayon.io), letting AI agents (Claude,
Cursor, VS Code, etc.) schedule and manage background jobs.

## Development

```bash
git clone git@github.com:gravityhash/relayon-mcp.git
cd relayon-mcp
npm install
npm run check        # clean + typecheck + build
npm run dev          # run against http://localhost:3000 with ts-node
```

## Testing against a local Relayon

The MCP server wraps the Relayon REST API. To test end-to-end you'll need a
running Relayon API + worker. Once you have one, point the MCP server at it:

```bash
RELAYON_API_KEY="rl_live_..." \
RELAYON_BASE_URL="http://localhost:3000" \
npm run start
```

Then connect an MCP client (Claude Desktop, Cursor, etc.) — see the README
for config snippets.

## Adding a new tool

1. Add a `ToolDef` to `src/tools.ts` with a JSON Schema and handler.
2. If it hits a new REST endpoint, add the client method to `src/client.ts`.
3. Update the tool list in `README.md`.
4. `npm run check`.

Tools that mutate state should be flagged with `destructive: true` in the
schema so agent UIs can surface a confirmation.

## Pull requests

- Branch from `main`, keep PRs focused (one tool / fix per PR).
- Every PR must pass `npm run check`.
- Update `README.md` if you change the tool surface.
- Don't introduce runtime dependencies — the package is deliberately zero-dep.

## Releasing (maintainers only)

```bash
# 1. Bump version in package.json
# 2. Commit: "chore: release vX.Y.Z"
# 3. Tag:   git tag -a vX.Y.Z -m "vX.Y.Z"
# 4. Push:  git push && git push --tags
# 5. npm:   npm run release
```

## Code of conduct

Be kind. Assume good intent. Disagree technically, not personally.

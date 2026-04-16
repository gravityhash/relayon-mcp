#!/usr/bin/env node
// =============================================
// @relayon/mcp — CLI entrypoint
//
// Usage (typically via Claude Desktop / Cursor MCP config):
//   RELAYON_API_KEY=rl_live_... relayon-mcp
//
// Optional env:
//   RELAYON_BASE_URL   REST base URL (default http://localhost:3000)
//   RELAYON_TIMEOUT_MS Request timeout (default 15000)
// =============================================

import { RelayonClient } from './client';
import { MCPServer } from './server';

function getEnv(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

async function main(): Promise<void> {
  const apiKey = getEnv('RELAYON_API_KEY');
  if (!apiKey) {
    process.stderr.write(
      'relayon-mcp: RELAYON_API_KEY is required. ' +
      'Set it in your MCP client configuration (e.g. claude_desktop_config.json).\n'
    );
    process.exit(1);
  }

  const baseUrl   = getEnv('RELAYON_BASE_URL', 'http://localhost:3000')!;
  const timeoutMs = Number(getEnv('RELAYON_TIMEOUT_MS', '15000'));

  const client = new RelayonClient({ apiKey, baseUrl, timeoutMs });
  const server = new MCPServer(client);

  // Graceful shutdown — stdin closing is the normal exit path, but
  // handle signals too for robust behavior when launched from IDE hosts.
  const shutdown = (sig: string) => {
    process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'signal received', sig }) + '\n');
    process.exit(0);
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await server.run();
}

main().catch(err => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'fatal', error: msg }) + '\n');
  process.exit(1);
});

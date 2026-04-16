// =============================================
// Relayon MCP — JSON-RPC 2.0 stdio server
// Implements the minimum surface of the Model Context Protocol:
//   - initialize / initialized
//   - ping
//   - tools/list
//   - tools/call
// Transport: newline-delimited JSON on stdin / stdout.
// All diagnostics go to stderr (stdout is reserved for protocol frames).
// =============================================

import * as readline from 'readline';
import { RelayonClient } from './client';
import { TOOLS, callTool } from './tools';

// MCP protocol version we implement. 2024-11-05 is widely supported by
// Claude Desktop, Cursor, and most current agent clients.
const PROTOCOL_VERSION = '2024-11-05';

const SERVER_INFO = {
  name: 'relayon-mcp',
  version: '1.0.0',
};

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
}

interface JsonRpcErrorResp {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: { code: number; message: string; data?: unknown };
}

const ERR = {
  ParseError:     -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams:  -32602,
  InternalError:  -32603,
};

export class MCPServer {
  private readonly client: RelayonClient;
  private readonly log: (msg: string, extra?: Record<string, unknown>) => void;

  constructor(client: RelayonClient) {
    this.client = client;
    // Structured JSON logs to stderr — stdout is reserved for JSON-RPC frames.
    this.log = (msg, extra) => {
      const entry = { ts: new Date().toISOString(), level: 'info', msg, ...(extra || {}) };
      process.stderr.write(JSON.stringify(entry) + '\n');
    };
  }

  /** Start the stdio loop. Resolves when stdin closes. */
  async run(): Promise<void> {
    this.log('relayon-mcp starting', { tools: TOOLS.length, protocol: PROTOCOL_VERSION });

    const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

    for await (const rawLine of rl) {
      const line = rawLine.trim();
      if (!line) continue;

      let req: JsonRpcRequest | null = null;
      try {
        req = JSON.parse(line) as JsonRpcRequest;
      } catch {
        // Can't associate with an id when parse fails — emit a parse error
        // with id=null per JSON-RPC 2.0 §5.1.
        this.send(this.errorResponse(null, ERR.ParseError, 'Parse error'));
        continue;
      }

      if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
        this.send(this.errorResponse(req?.id ?? null, ERR.InvalidRequest, 'Invalid request'));
        continue;
      }

      // Notifications (no id) MUST NOT receive a response.
      const isNotification = req.id === undefined;

      try {
        const result = await this.dispatch(req.method, req.params || {});
        if (!isNotification) {
          this.send({ jsonrpc: '2.0', id: req.id as JsonRpcId, result } satisfies JsonRpcSuccess);
        }
      } catch (err) {
        if (!isNotification) {
          const message = err instanceof Error ? err.message : String(err);
          const code = (err as { rpcCode?: number }).rpcCode ?? ERR.InternalError;
          this.send(this.errorResponse(req.id as JsonRpcId, code, message));
        } else {
          this.log('notification handler failed', { method: req.method, err: String(err) });
        }
      }
    }

    this.log('relayon-mcp shutting down (stdin closed)');
  }

  // ─────────────────────────────────────────────────────────────
  // Method dispatch
  // ─────────────────────────────────────────────────────────────

  private async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return this.handleInitialize(params);

      case 'notifications/initialized':
      case 'initialized':
        // Fire-and-forget notification — nothing to do.
        return undefined;

      case 'ping':
        return {};

      case 'tools/list':
        return this.handleToolsList();

      case 'tools/call':
        return this.handleToolsCall(params);

      // Minimal stubs for optional capabilities the client may probe.
      case 'resources/list': return { resources: [] };
      case 'prompts/list':   return { prompts: [] };

      default: {
        const e = new Error(`Method not found: ${method}`);
        (e as { rpcCode?: number }).rpcCode = ERR.MethodNotFound;
        throw e;
      }
    }
  }

  private handleInitialize(_params: Record<string, unknown>) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
      },
      serverInfo: SERVER_INFO,
    };
  }

  private handleToolsList() {
    return {
      tools: TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  }

  private async handleToolsCall(params: Record<string, unknown>) {
    const name = params.name;
    if (typeof name !== 'string' || !name) {
      const e = new Error("'name' is required");
      (e as { rpcCode?: number }).rpcCode = ERR.InvalidParams;
      throw e;
    }
    const args = (params.arguments && typeof params.arguments === 'object')
      ? params.arguments as Record<string, unknown>
      : {};

    this.log('tool call', { name, argKeys: Object.keys(args) });

    try {
      const text = await callTool(this.client, name, args);
      return {
        content: [{ type: 'text', text }],
        isError: false,
      };
    } catch (err) {
      // Report tool errors as a normal MCP "isError" response so the
      // model can see the failure and adapt, rather than killing the RPC.
      const message = err instanceof Error ? err.message : String(err);
      this.log('tool error', { name, error: message });
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Transport helpers
  // ─────────────────────────────────────────────────────────────

  private errorResponse(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcErrorResp {
    return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
  }

  private send(obj: JsonRpcSuccess | JsonRpcErrorResp): void {
    process.stdout.write(JSON.stringify(obj) + '\n');
  }
}

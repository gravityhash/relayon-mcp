// =============================================
// Relayon MCP — Tool definitions
// Each tool is a thin wrapper around the REST API.
// =============================================

import { RelayonClient, RelayonError } from './client';

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  description?: string;
  minimum?: number;
  maximum?: number;
  default?: unknown;
  additionalProperties?: boolean | JsonSchema;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  handler: (client: RelayonClient, args: Record<string, unknown>) => Promise<string>;
}

// Human-readable one-liner for a job row.
function summarizeJob(j: Record<string, unknown>): string {
  return `[${j.status}] ${j.method} ${j.endpoint} (id=${j.id}, priority=${j.priority}, run_at=${j.run_at})`;
}

function asString(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`'${field}' must be a non-empty string`);
  return v;
}

function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) out[k] = v;
  return out as Partial<T>;
}

export const TOOLS: ToolDef[] = [
  // ───────────────────────── create_job ─────────────────────────
  {
    name: 'create_job',
    description:
      'Schedule a new background job on Relayon. Supports delayed execution, cron schedules, ' +
      'retries, priorities, and human-approval gates. The job is tagged source="agent" automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        endpoint: { type: 'string', description: 'Full URL to invoke (must be https:// or http://)' },
        method:   { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'POST' },
        payload:  { type: 'object', description: 'JSON body passed to the endpoint', additionalProperties: true },
        headers:  { type: 'object', description: 'Additional request headers', additionalProperties: { type: 'string' } },
        delay:    { type: 'string', description: 'Relative delay like "30m", "2h", "1d". Mutually exclusive with run_at and cron.' },
        run_at:   { type: 'string', description: 'Absolute ISO-8601 run time. Mutually exclusive with delay and cron.' },
        cron:     { type: 'string', description: 'Five-field cron expression. Mutually exclusive with delay and run_at.' },
        priority: { type: 'integer', minimum: 1, maximum: 4, default: 3, description: '1=critical, 4=low' },
        requires_approval: { type: 'boolean', default: false, description: 'Block execution until a human approves.' },
        throttle: {
          type: 'object',
          description: 'Rate-limit requests to this endpoint. Prevents 429 storms on third-party APIs.',
          properties: {
            max_concurrent: { type: 'integer', minimum: 1, maximum: 1000, description: 'Max concurrent in-flight requests' },
            max_per_second: { type: 'number', minimum: 0.1, maximum: 1000, description: 'Max requests per second' },
            throttle_key: { type: 'string', description: 'Override throttle key (default: endpoint hostname)' },
          },
        },
      },
      required: ['endpoint'],
    },
    handler: async (client, args) => {
      const endpoint = asString(args.endpoint, 'endpoint');
      const input = pickDefined({
        endpoint,
        method:   args.method,
        payload:  args.payload,
        headers:  args.headers,
        delay:    args.delay,
        run_at:   args.run_at,
        cron:     args.cron,
        priority: args.priority,
        requires_approval: args.requires_approval,
        throttle: args.throttle,
      });
      const res = await client.createJob(input as Record<string, unknown>);
      const j = res.data;
      return `Job created.\n` +
        `  id:        ${j.id}\n` +
        `  status:    ${j.status}\n` +
        `  run_at:    ${j.run_at}\n` +
        `  priority:  ${j.priority}\n` +
        `  source:    ${j.source}\n` +
        (j.requires_approval ? `  approval:  required\n` : '') +
        `\nFull job:\n${JSON.stringify(j, null, 2)}`;
    },
  },

  // ───────────────────────── list_jobs ─────────────────────────
  {
    name: 'list_jobs',
    description: 'List jobs with optional filters (status, source). Paginated.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'running', 'done', 'failed', 'cancelled', 'paused'] },
        source: { type: 'string', enum: ['sdk', 'agent'], description: 'Filter to only agent-created or only developer-created jobs.' },
        limit:  { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        offset: { type: 'integer', minimum: 0, default: 0 },
      },
    },
    handler: async (client, args) => {
      const res = await client.listJobs({
        status: args.status as string | undefined,
        source: args.source as string | undefined,
        limit:  args.limit  as number | undefined,
        offset: args.offset as number | undefined,
      });
      if (res.data.length === 0) return `No jobs found. Total matching: ${res.pagination.total}.`;
      const lines = res.data.map(j => `  - ${summarizeJob(j as unknown as Record<string, unknown>)}`);
      return `${res.pagination.total} total job(s), showing ${res.data.length} starting at offset ${res.pagination.offset}:\n` +
        lines.join('\n');
    },
  },

  // ───────────────────────── get_job ─────────────────────────
  {
    name: 'get_job',
    description: 'Fetch full details for a single job by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Job UUID' } },
      required: ['id'],
    },
    handler: async (client, args) => {
      const res = await client.getJob(asString(args.id, 'id'));
      return JSON.stringify(res.data, null, 2);
    },
  },

  // ───────────────────────── cancel_job ─────────────────────────
  {
    name: 'cancel_job',
    description: 'Cancel a pending or paused job. DESTRUCTIVE — cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Job UUID' } },
      required: ['id'],
    },
    handler: async (client, args) => {
      const res = await client.cancelJob(asString(args.id, 'id'));
      return `Job ${res.data.id} cancelled (status=${res.data.status}).`;
    },
  },

  // ───────────────────────── pause_job ─────────────────────────
  {
    name: 'pause_job',
    description: 'Pause a pending job. The schedule is preserved; resume later to run it.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Job UUID' } },
      required: ['id'],
    },
    handler: async (client, args) => {
      const res = await client.pauseJob(asString(args.id, 'id'));
      return `Job ${res.data.id} paused (status=${res.data.status}).`;
    },
  },

  // ───────────────────────── resume_job ─────────────────────────
  {
    name: 'resume_job',
    description: 'Resume a paused job. It will be picked up by a worker on the next poll.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Job UUID' } },
      required: ['id'],
    },
    handler: async (client, args) => {
      const res = await client.resumeJob(asString(args.id, 'id'));
      return `Job ${res.data.id} resumed (status=${res.data.status}, run_at=${res.data.run_at}).`;
    },
  },

  // ───────────────────────── approve_job ─────────────────────────
  {
    name: 'approve_job',
    description: 'Approve a job that requires human approval. DESTRUCTIVE — it will run immediately.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Job UUID' } },
      required: ['id'],
    },
    handler: async (client, args) => {
      const res = await client.approveJob(asString(args.id, 'id'));
      return `Job ${res.data.id} approved at ${res.data.approved_at} by ${res.data.approved_by}.`;
    },
  },

  // ───────────────────────── get_job_attempts ─────────────────────────
  {
    name: 'get_job_attempts',
    description: 'Fetch all execution attempts for a job, including full request/response details for debugging.',
    inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Job UUID' } },
        required: ['id'],
    },
    handler: async (client, args) => {
        const res = await client.getJobAttempts(asString(args.id, 'id'));
        if (res.data.length === 0) return 'No attempts recorded for this job yet.';
        const lines = res.data.map((a: Record<string, unknown>) =>
            `  Attempt #${a.attempt_number} [${a.status}] → HTTP ${a.response_status ?? 'N/A'} ` +
            `(${a.duration_ms}ms, endpoint=${a.endpoint})`
        );
        return `${res.data.length} attempt(s):\n` + lines.join('\n') +
            `\n\nFull details:\n${JSON.stringify(res.data, null, 2)}`;
    },
  },

  // ───────────────────────── list_dlq ─────────────────────────
  {
    name: 'list_dlq',
    description: 'List entries in the dead-letter queue (jobs that exhausted retries). Paginated.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:  { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        offset: { type: 'integer', minimum: 0, default: 0 },
      },
    },
    handler: async (client, args) => {
      const res = await client.listDLQ({
        limit:  args.limit  as number | undefined,
        offset: args.offset as number | undefined,
      });
      if (res.data.length === 0) return `DLQ empty. Total: ${res.pagination.total}.`;
      const lines = res.data.map(e =>
        `  - [${e.failure_reason}] ${e.endpoint} (dlq_id=${e.id}, original=${e.original_job_id}, failed_at=${e.failed_at})`
      );
      return `${res.pagination.total} DLQ entry(ies), showing ${res.data.length}:\n` + lines.join('\n');
    },
  },

  // ───────────────────────── replay_dlq ─────────────────────────
  {
    name: 'replay_dlq',
    description: 'Replay a dead-letter entry as a fresh job. Returns the new job id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'DLQ entry UUID' } },
      required: ['id'],
    },
    handler: async (client, args) => {
      const res = await client.replayDLQ(asString(args.id, 'id'));
      return `DLQ entry ${res.data.dlq_id} replayed as new job ${res.data.replayed_job_id}.`;
    },
  },

  // ───────────────────────── create_trigger ─────────────────────────
  {
    name: 'create_trigger',
    description: 'Create an inbound webhook trigger. When external services POST to the webhook URL, ' +
        'Relayon creates a job from the trigger config, optionally merging the inbound payload.',
    inputSchema: {
      type: 'object',
      properties: {
        name:       { type: 'string', description: 'Human-readable name for this trigger' },
        endpoint:   { type: 'string', description: 'URL to call when the trigger fires' },
        method:     { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'POST' },
        default_payload: { type: 'object', description: 'Default payload merged with inbound body', additionalProperties: true },
        payload_mode: { type: 'string', enum: ['merge', 'replace', 'nest', 'ignore'], default: 'merge',
            description: 'How to handle inbound body: merge (default), replace, nest under .inbound, or ignore' },
        priority:   { type: 'integer', minimum: 1, maximum: 4, default: 3 },
        webhook_secret: { type: 'string', description: 'Shared secret for verifying inbound signatures' },
      },
      required: ['name', 'endpoint'],
    },
    handler: async (client, args) => {
      const res = await client.createTrigger(pickDefined({
        name: args.name,
        endpoint: args.endpoint,
        method: args.method,
        default_payload: args.default_payload,
        payload_mode: args.payload_mode,
        priority: args.priority,
        webhook_secret: args.webhook_secret,
        source: 'agent',
      }));
      const t = res.data;
      return `Trigger created.\n` +
          `  name:        ${t.name}\n` +
          `  webhook_url: ${t.webhook_url}\n` +
          `  webhook_id:  ${t.webhook_id}\n` +
          `  endpoint:    ${t.endpoint}\n` +
          `  status:      ${t.status}\n` +
          `\nGive this webhook URL to external services. When they POST to it, a job will be created automatically.\n` +
          `\nFull trigger:\n${JSON.stringify(t, null, 2)}`;
    },
  },
  // ───────────────────────── list_triggers ─────────────────────────
  {
    name: 'list_triggers',
    description: 'List inbound webhook triggers. Shows webhook URLs and invocation stats.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'paused'] },
        limit:  { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        offset: { type: 'integer', minimum: 0, default: 0 },
      },
    },
    handler: async (client, args) => {
      const res = await client.listTriggers({
        status: args.status as string | undefined,
        limit: args.limit as number | undefined,
        offset: args.offset as number | undefined,
      });
      if (res.data.length === 0) return `No triggers found. Total: ${res.pagination.total}.`;
      const lines = res.data.map((t: Record<string, unknown>) =>
          `  - [${t.status}] ${t.name} → ${t.endpoint} (webhook=${t.webhook_url}, invocations=${t.total_invocations})`
      );
      return `${res.pagination.total} trigger(s), showing ${res.data.length}:\n` + lines.join('\n');
    },
  },
  // ───────────────────────── delete_trigger ─────────────────────────
  {
    name: 'delete_trigger',
    description: 'Delete an inbound webhook trigger. The webhook URL stops accepting requests immediately.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Trigger UUID' } },
      required: ['id'],
    },
    handler: async (client, args) => {
      await client.deleteTrigger(asString(args.id, 'id'));
      return `Trigger ${args.id} deleted. The webhook URL is now inactive.`;
    },
  },
];

/**
 * Invoke a tool by name with user-supplied arguments. Returns the string
 * that should be wrapped in an MCP text-content block. Throws on lookup
 * failure (so the server can return a JSON-RPC error); throws a RelayonError
 * or generic Error on tool-execution failure (so the server can report
 * isError=true without crashing the loop).
 */
export async function callTool(
  client: RelayonClient,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  try {
    return await tool.handler(client, args || {});
  } catch (err) {
    if (err instanceof RelayonError) {
      throw new Error(`${err.code}: ${err.message} (HTTP ${err.status})`);
    }
    throw err;
  }
}

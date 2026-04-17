// =============================================
// Relayon MCP — REST client (zero deps, native fetch)
// =============================================

export interface ClientOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
}

export interface Job {
  id: string;
  endpoint: string;
  method: string;
  status: string;
  priority: number;
  run_at: string;
  attempt_count: number;
  source: string;
  created_at: string;
  completed_at: string | null;
  [k: string]: unknown;
}

export interface Pagination { total: number; limit: number; offset: number; has_more: boolean }
export interface Paginated<T> { data: T[]; pagination: Pagination }

export class RelayonError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'RelayonError';
  }
}

export class RelayonClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: ClientOptions) {
    if (!opts.apiKey) throw new Error('RelayonClient: apiKey is required');
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 15000;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}` };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        const err = (data as { error?: { code?: string; message?: string } }).error
          ?? { code: 'HTTP_ERROR', message: `HTTP ${res.status}` };
        throw new RelayonError(res.status, err.code || 'HTTP_ERROR', err.message || `HTTP ${res.status}`);
      }
      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  // --- Job management ---

  async createJob(input: Record<string, unknown>): Promise<{ data: Job }> {
    // Always tag agent-created jobs so the dashboard segregation works.
    const payload = { ...input, source: 'agent' };
    return this.request<{ data: Job }>('POST', '/v1/jobs', payload);
  }

  async listJobs(opts: { status?: string; source?: string; limit?: number; offset?: number } = {}): Promise<Paginated<Job>> {
    const params = new URLSearchParams();
    if (opts.status) params.set('status', opts.status);
    if (opts.source) params.set('source', opts.source);
    if (opts.limit != null) params.set('limit', String(opts.limit));
    if (opts.offset != null) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return this.request<Paginated<Job>>('GET', `/v1/jobs${qs ? `?${qs}` : ''}`);
  }

  async getJob(id: string): Promise<{ data: Job }> {
    return this.request<{ data: Job }>('GET', `/v1/jobs/${encodeURIComponent(id)}`);
  }

  async cancelJob(id: string): Promise<{ data: Job }> {
    return this.request<{ data: Job }>('POST', `/v1/jobs/${encodeURIComponent(id)}/cancel`);
  }

  async pauseJob(id: string): Promise<{ data: Job }> {
    return this.request<{ data: Job }>('POST', `/v1/jobs/${encodeURIComponent(id)}/pause`);
  }

  async resumeJob(id: string): Promise<{ data: Job }> {
    return this.request<{ data: Job }>('POST', `/v1/jobs/${encodeURIComponent(id)}/resume`);
  }

  async approveJob(id: string): Promise<{ data: Job }> {
    return this.request<{ data: Job }>('POST', `/v1/jobs/${encodeURIComponent(id)}/approve`);
  }

  // --- Dead Letter Queue ---

  async listDLQ(opts: { limit?: number; offset?: number } = {}): Promise<Paginated<Record<string, unknown>>> {
    const params = new URLSearchParams();
    if (opts.limit != null) params.set('limit', String(opts.limit));
    if (opts.offset != null) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return this.request<Paginated<Record<string, unknown>>>('GET', `/v1/dlq${qs ? `?${qs}` : ''}`);
  }

  async replayDLQ(id: string): Promise<{ data: { replayed_job_id: string; dlq_id: string } }> {
    return this.request<{ data: { replayed_job_id: string; dlq_id: string } }>('POST', `/v1/dlq/${encodeURIComponent(id)}/replay`);
  }

  async getJobAttempts(id: string): Promise<{ data: Array<Record<string, unknown>> }> {
    return this.request<{ data: Array<Record<string, unknown>> }>('GET', `/v1/jobs/${encodeURIComponent(id)}/attempts`);
  }

  // --- Triggers ---

  async createTrigger(input: Record<string, unknown>): Promise<{ data: Record<string, unknown> }> {
    return this.request<{ data: Record<string, unknown> }>('POST', '/v1/triggers', input);
  }

  async listTriggers(opts: { status?: string; limit?: number; offset?: number } = {}): Promise<{ data: Array<Record<string, unknown>>; pagination: Pagination }> {
    const params = new URLSearchParams();
    if (opts.status) params.set('status', opts.status);
    if (opts.limit != null) params.set('limit', String(opts.limit));
    if (opts.offset != null) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return this.request<{ data: Array<Record<string, unknown>>; pagination: Pagination }>('GET', `/v1/triggers${qs ? `?${qs}` : ''}`);
  }

  async deleteTrigger(id: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>('DELETE', `/v1/triggers/${encodeURIComponent(id)}`);
  }

  // --- Health ---

  async health(): Promise<{ status: string; version: string; database: string }> {
    return this.request<{ status: string; version: string; database: string }>('GET', '/v1/health');
  }
}

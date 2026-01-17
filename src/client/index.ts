import { Client } from 'undici';
import type {
  StatusResponse,
  ObserveResponse,
  RestartRequest,
  RestartResponse,
  StopResponse,
} from '../protocol/types.js';

export interface LogsParams {
  cursor?: number;
  since_ms?: number;
  last?: number;
  grep?: string;
  regex?: boolean;
  case_sensitive?: boolean;
  invert?: boolean;
  stream?: 'combined' | 'stdout' | 'stderr';
  max_lines?: number;
  max_bytes?: number;
}

/**
 * HTTP client for communicating with a tap runner over Unix domain socket.
 */
export class TapClient {
  private socketPath: string;
  private timeout: number;

  constructor(socketPath: string, timeout: number = 5000) {
    this.socketPath = socketPath;
    this.timeout = timeout;
  }

  /**
   * Get runner status.
   */
  async status(): Promise<StatusResponse> {
    return this.get<StatusResponse>('/v1/status');
  }

  /**
   * Query logs from runner.
   */
  async logs(params: LogsParams): Promise<ObserveResponse> {
    const searchParams = new URLSearchParams();

    if (params.cursor !== undefined) searchParams.set('cursor', String(params.cursor));
    if (params.since_ms !== undefined) searchParams.set('since_ms', String(params.since_ms));
    if (params.last !== undefined) searchParams.set('last', String(params.last));
    if (params.grep !== undefined) searchParams.set('grep', params.grep);
    if (params.regex) searchParams.set('regex', '1');
    if (params.case_sensitive) searchParams.set('case_sensitive', '1');
    if (params.invert) searchParams.set('invert', '1');
    if (params.stream) searchParams.set('stream', params.stream);
    if (params.max_lines !== undefined) searchParams.set('max_lines', String(params.max_lines));
    if (params.max_bytes !== undefined) searchParams.set('max_bytes', String(params.max_bytes));

    const query = searchParams.toString();
    const path = query ? `/v1/logs?${query}` : '/v1/logs';

    return this.get<ObserveResponse>(path);
  }

  /**
   * Restart the child process.
   */
  async restart(body: RestartRequest): Promise<RestartResponse> {
    return this.post<RestartResponse>('/v1/restart', body);
  }

  /**
   * Stop the runner.
   */
  async stop(graceMs?: number): Promise<StopResponse> {
    return this.post<StopResponse>('/v1/stop', graceMs ? { grace_ms: graceMs } : {});
  }

  private async get<T>(path: string): Promise<T> {
    const client = new Client('http://localhost', {
      socketPath: this.socketPath,
      connectTimeout: this.timeout,
    });

    try {
      const { statusCode, body } = await client.request({
        path,
        method: 'GET',
      });

      const text = await body.text();
      const data = JSON.parse(text);

      if (statusCode >= 400) {
        throw new Error(data.message || `HTTP ${statusCode}`);
      }

      return data as T;
    } finally {
      await client.close();
    }
  }

  private async post<T>(path: string, body: object): Promise<T> {
    const client = new Client('http://localhost', {
      socketPath: this.socketPath,
      connectTimeout: this.timeout,
    });

    try {
      const { statusCode, body: resBody } = await client.request({
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const text = await resBody.text();
      const data = JSON.parse(text);

      if (statusCode >= 400) {
        throw new Error(data.message || `HTTP ${statusCode}`);
      }

      return data as T;
    } finally {
      await client.close();
    }
  }
}

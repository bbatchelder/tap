import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { unlinkSync, existsSync } from 'node:fs';
import { RingBuffer, QueryOptions } from './ring-buffer.js';
import { ChildManager } from './child.js';
import type {
  StatusResponse,
  ObserveResponse,
  RestartRequest,
  RestartResponse,
  StopRequest,
  StopResponse,
  ErrorResponse,
} from '../protocol/types.js';

export interface RunnerServerConfig {
  socketPath: string;
  name: string;
  ringBuffer: RingBuffer;
  childManager: ChildManager;
  usePty: boolean;
  forward: boolean;
}

/**
 * HTTP server that runs over a Unix domain socket.
 * Provides the runner API for clients.
 */
export class RunnerServer {
  private server: Server;
  private socketPath: string;
  private ringBuffer: RingBuffer;
  private childManager: ChildManager;
  private name: string;
  private startedAt: number;
  private usePty: boolean;
  private forward: boolean;

  constructor(config: RunnerServerConfig) {
    this.socketPath = config.socketPath;
    this.name = config.name;
    this.ringBuffer = config.ringBuffer;
    this.childManager = config.childManager;
    this.usePty = config.usePty;
    this.forward = config.forward;
    this.startedAt = Date.now();

    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        this.sendError(res, 500, 'internal_error', err instanceof Error ? err.message : 'Unknown error');
      });
    });
  }

  /**
   * Start the server on the Unix domain socket.
   */
  async start(): Promise<void> {
    // Check if socket already exists and is responsive
    if (existsSync(this.socketPath)) {
      const isAlive = await this.checkSocketAlive();
      if (isAlive) {
        throw new Error(`Service '${this.name}' already running. Use 'tap status --name ${this.name}' or 'tap stop --name ${this.name}'`);
      }
      // Stale socket - remove it
      unlinkSync(this.socketPath);
    }

    return new Promise((resolve, reject) => {
      this.server.listen(this.socketPath, () => resolve());
      this.server.on('error', reject);
    });
  }

  private async checkSocketAlive(): Promise<boolean> {
    try {
      const { Client } = await import('undici');
      const client = new Client('http://localhost', {
        socketPath: this.socketPath,
        connectTimeout: 500,
      });
      try {
        await client.request({ path: '/v1/status', method: 'GET' });
        await client.close();
        return true;
      } catch {
        await client.close();
        return false;
      }
    } catch {
      return false;
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/v1/status') {
      this.handleStatus(res);
    } else if (req.method === 'GET' && url.pathname === '/v1/logs') {
      this.handleLogs(url.searchParams, res);
    } else if (req.method === 'POST' && url.pathname === '/v1/restart') {
      const body = await this.readBody<RestartRequest>(req);
      await this.handleRestart(body, res);
    } else if (req.method === 'POST' && url.pathname === '/v1/stop') {
      const body = await this.readBody<StopRequest>(req);
      await this.handleStop(body, res);
    } else {
      this.sendError(res, 404, 'not_found', `Unknown endpoint: ${req.method} ${url.pathname}`);
    }
  }

  private handleStatus(res: ServerResponse): void {
    const childState = this.childManager.getState();
    const bufferStats = this.ringBuffer.getStats();

    const response: StatusResponse = {
      name: this.name,
      runner_pid: process.pid,
      child_pid: childState.pid,
      child_state: childState.state,
      started_at: this.startedAt,
      uptime_ms: Date.now() - this.startedAt,
      pty: this.usePty,
      forward: this.forward,
      buffer: bufferStats,
      last_exit: {
        code: childState.exitCode,
        signal: childState.exitSignal,
      },
    };

    this.sendJson(res, 200, response);
  }

  private handleLogs(params: URLSearchParams, res: ServerResponse): void {
    const opts: QueryOptions = {};

    // Window selection
    if (params.has('cursor')) opts.sinceCursor = parseInt(params.get('cursor')!);
    if (params.has('since_ms')) opts.sinceMs = parseInt(params.get('since_ms')!);
    if (params.has('last')) opts.last = parseInt(params.get('last')!);

    // Filters
    if (params.has('grep')) opts.grep = params.get('grep')!;
    if (params.has('regex')) opts.regex = params.get('regex') === '1';
    if (params.has('case_sensitive')) opts.caseSensitive = params.get('case_sensitive') === '1';
    if (params.has('invert')) opts.invert = params.get('invert') === '1';
    if (params.has('stream')) {
      const stream = params.get('stream')!;
      if (stream === 'stdout' || stream === 'stderr' || stream === 'combined') {
        opts.stream = stream;
      }
    }

    // Limits
    if (params.has('max_lines')) opts.maxLines = parseInt(params.get('max_lines')!);
    if (params.has('max_bytes')) opts.maxBytes = parseInt(params.get('max_bytes')!);

    const result = this.ringBuffer.query(opts);

    const response: ObserveResponse = {
      name: this.name,
      cursor_next: result.cursorNext,
      truncated: result.truncated,
      dropped: result.dropped,
      events: result.events,
      match_count: result.events.length,
    };

    this.sendJson(res, 200, response);
  }

  private async handleRestart(body: RestartRequest, res: ServerResponse): Promise<void> {
    const graceMs = body.grace_ms ?? 2000;
    const timeoutMs = body.timeout_ms ?? 20000;
    const clearLogs = body.clear_logs ?? false;

    // Get cursor before restart for readiness check
    const restartCursor = this.ringBuffer.getNextSeq();

    // Insert restart marker
    this.ringBuffer.insertMarker('--- restart requested ---');

    // Stop the child
    await this.childManager.stop(graceMs);

    if (clearLogs) {
      this.ringBuffer.clear();
    }

    // Restart the child
    this.childManager.start();

    const childState = this.childManager.getState();
    this.ringBuffer.insertMarker(`--- restarted (pid=${childState.pid}) ---`);

    // If no readiness condition, return immediately
    if (!body.ready) {
      const response: RestartResponse = {
        name: this.name,
        restarted: true,
        ready: true,
        pid: childState.pid ?? undefined,
        cursor_next: this.ringBuffer.getNextSeq(),
      };
      this.sendJson(res, 200, response);
      return;
    }

    // Wait for readiness pattern
    const isRegex = body.ready.type === 'regex';
    const caseSensitive = body.ready.case_sensitive ?? false;

    const result = await this.ringBuffer.waitForMatch(
      body.ready.pattern,
      isRegex,
      caseSensitive,
      restartCursor,
      timeoutMs
    );

    const response: RestartResponse = {
      name: this.name,
      restarted: true,
      ready: result.matched,
      ready_match: result.matchText,
      reason: result.matched ? undefined : 'timeout',
      pid: childState.pid ?? undefined,
      cursor_next: this.ringBuffer.getNextSeq(),
      snippet: result.matched ? undefined : result.snippet,
    };

    this.sendJson(res, 200, response);
  }

  private async handleStop(body: StopRequest, res: ServerResponse): Promise<void> {
    const graceMs = body.grace_ms ?? 2000;

    await this.childManager.stop(graceMs);

    const response: StopResponse = { stopped: true };
    this.sendJson(res, 200, response);

    // Schedule server shutdown
    setImmediate(() => {
      this.close();
      process.exit(0);
    });
  }

  private static readonly MAX_BODY_SIZE = 1024 * 1024; // 1MB limit

  private readBody<T>(req: IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      let data = '';
      let size = 0;

      req.on('data', (chunk: Buffer | string) => {
        const chunkSize = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
        size += chunkSize;

        if (size > RunnerServer.MAX_BODY_SIZE) {
          req.destroy();
          reject(new Error('Request body too large'));
          return;
        }

        data += chunk;
      });

      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : ({} as T));
        } catch {
          reject(new Error('Invalid JSON body'));
        }
      });

      req.on('error', reject);
    });
  }

  private sendJson(res: ServerResponse, status: number, data: object): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private sendError(res: ServerResponse, status: number, code: string, message: string): void {
    const response: ErrorResponse = { error: code, message };
    this.sendJson(res, status, response);
  }

  /**
   * Close the server and clean up the socket file.
   */
  close(): void {
    this.server.close();
    try {
      unlinkSync(this.socketPath);
    } catch {
      // Socket might already be removed
    }
  }
}

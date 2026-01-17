// Log event structure stored in ring buffer
export interface LogEvent {
  seq: number;
  ts: number;
  stream: 'combined' | 'stdout' | 'stderr';
  text: string;
}

// Status response from GET /v1/status
export interface StatusResponse {
  name: string;
  runner_pid: number;
  child_pid: number | null;
  child_state: ChildState;
  started_at: number;
  uptime_ms: number;
  pty: boolean;
  forward: boolean;
  buffer: BufferStats;
  last_exit: ExitInfo;
}

export type ChildState = 'running' | 'exited' | 'stopped' | 'starting' | 'unknown';

export interface BufferStats {
  max_lines: number;
  max_bytes: number;
  current_lines: number;
  current_bytes: number;
}

export interface ExitInfo {
  code: number | null;
  signal: string | null;
}

// Observe response from GET /v1/logs
export interface ObserveResponse {
  name: string;
  cursor_next: number;
  truncated: boolean;
  dropped: boolean;
  events: LogEvent[];
  match_count: number;
}

// Restart request to POST /v1/restart
export interface RestartRequest {
  grace_ms?: number;
  ready?: ReadyCondition;
  timeout_ms?: number;
  clear_logs?: boolean;
}

export interface ReadyCondition {
  type: 'substring' | 'regex';
  pattern: string;
  case_sensitive?: boolean;
}

// Restart response from POST /v1/restart
export interface RestartResponse {
  name: string;
  restarted: boolean;
  ready: boolean;
  ready_match?: string;
  reason?: string;
  pid?: number;
  cursor_next: number;
  snippet?: string[];
}

// Stop request to POST /v1/stop
export interface StopRequest {
  grace_ms?: number;
}

// Stop response from POST /v1/stop
export interface StopResponse {
  stopped: boolean;
}

// List service entry from tap ls
export interface ServiceEntry {
  name: string;
  live: boolean;
  child_state?: ChildState;
  runner_pid?: number;
  uptime_ms?: number;
  reason?: string;
}

// List response from tap ls
export interface ListResponse {
  services: ServiceEntry[];
}

// Error response
export interface ErrorResponse {
  error: string;
  message: string;
}

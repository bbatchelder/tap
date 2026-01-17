Below is a complete, build-ready specification for **`tap`**, designed for macOS/Linux, implemented in Node.js, with a **single executable** that runs either as a long-running **runner/server** (`tap run …`) or a short-lived **client** (`tap observe|restart|stop|status|ls …`). Client↔server communication is **HTTP over Unix-domain sockets (UDS)**. Logs are stored in an **in-memory ring buffer** (no log files).

---

# Tap Utility Specification

## 1) Goals

### Primary

* Wrap and supervise a single long-running command (e.g., `pnpm dev`, `uvicorn --reload`, worker scripts).
* Capture the child’s output and expose it via queryable, token-efficient CLI commands for LLM agents and humans.
* Allow remote control actions: restart/stop.
* Keep the system simple: **no always-on global daemon**, no log files; **one server per running service**.

### Secondary

* Human-friendly: `tap run` forwards live output to the terminal by default.
* Agent-friendly: `tap observe` returns bounded, structured output (JSON) with cursor-based incremental reads.

### Non-goals (MVP)

* Windows support.
* Multi-process “Procfile” orchestration.
* Authentication beyond filesystem permissions.
* Full stdout/stderr separation under PTY (optional later).

---

## 2) Terminology

* **Runner**: the `tap run` process; it wraps the child process and runs an HTTP server over a UDS.
* **Child**: the command being supervised.
* **Service name**: `--name <string>`, used to derive socket path.
* **Socket**: Unix-domain socket file used by the runner server.
* **Ring buffer**: in-memory storage of recent log events.
* **Cursor**: monotonic sequence number (`seq`) used to fetch logs incrementally.

---

## 3) Operating Model

### Runner lifecycle

* `tap run --name <svc> -- <cmd...>` starts:

  1. UDS HTTP server at `.tap/<name>.sock` (by default)
  2. child process (preferably in a PTY)
  3. log capture to in-memory ring buffer
  4. optional forwarding of child output to runner’s stdout (default ON)

* Runner owns restart:

  * client `tap restart` sends `POST /v1/restart` to runner
  * runner kills and re-spawns child using stored launch spec

### Client commands

* All client commands locate socket by name and talk to runner over HTTP/UDS.

---

## 4) Filesystem Layout

Tap stores only minimal discovery artifacts (no logs).

* Default state directory (repo-local):

  * `./.tap/`
* Socket path:

  * `./.tap/<name>.sock`

### Notes

* Sockets must be removed on clean shutdown.
* If socket exists at startup, runner must treat it as “possibly stale” and handle safely (see §8).

---

## 5) CLI Interface

### Global flags (client + runner)

* `--tap-dir <path>`: override `.tap` directory. Default: `./.tap`
* `--name <string>`: service name (required for all commands except `tap ls`)
* `--json`: output JSON for client commands (default ON for commands intended for agents; see below)
* `--timeout <duration>`: client request timeout. Default: `5s` (except restart readiness wait)
* `--verbose`: include extra diagnostic output to stderr (client) or logs (runner)

### Duration format

* `<int><unit>` where unit ∈ `ms|s|m`
* Examples: `500ms`, `5s`, `2m`

---

## 6) Commands

### 6.1 `tap run`

Starts a runner server and a child process.

**Usage**

```bash
tap run --name frontend -- pnpm run dev
tap run --name backend --cwd backend -- poetry run uvicorn main:app --host 0.0.0.0 --port 8000 --reload --timeout-graceful-shutdown 0
```

**Flags**

* `--cwd <path>`: working directory for child. Default: current directory.
* `--env KEY=VAL` (repeatable): add/override env vars for child.
* `--env-file <path>`: load env vars from file (simple `KEY=VAL` lines). Optional.
* `--pty` / `--no-pty`: default `--pty` ON.
* `--forward` / `--no-forward`: default ON. If ON, print child output to runner stdout.
* `--buffer-lines <N>`: ring buffer max events. Default: `5000`.
* `--buffer-bytes <N>`: ring buffer max total bytes (approx). Default: `10_000_000` (10MB).

  * Both limits may apply; eviction happens when either exceeded.
* `--print-connection`: if set, prints socket path and exits? (No—runner must remain running. Instead this flag prints a single line on startup showing socket path + pid.)
* `--ready <pattern>`: substring readiness indicator (optional). If supplied, runner prints a “READY” marker when seen. (Does not exit; used for humans/CI.)
* `--ready-regex <regex>`: optional regex readiness.
* `--detach`: starts runner in background (optional future; NOT required for MVP).

**Behavior**

* Runner starts HTTP server on UDS before launching child.
* Runner creates a new process group/session for child so it can kill the whole tree.
* Runner captures output and stores it in ring buffer as events.
* If child exits:

  * Runner stays alive (MVP behavior) and reports `child_state=exited` via `/status`.
  * It continues serving logs/status. `tap restart` can be used.
  * Optional later: `--exit-on-child-exit`.

**Exit codes**

* `0` only on normal stop via `tap stop` or SIGINT/SIGTERM handled gracefully.
* Non-zero if runner fails to start server, spawn child, or bind socket.

---

### 6.2 `tap observe`

Fetch logs from runner.

**Usage**

```bash
tap observe --name backend --since 60s --grep error
tap observe --name frontend --last 200
tap observe --name backend --since-cursor 1200
tap observe --name backend --since-last
```

**Window selectors (exactly one optional; default is `--last 80`)**

* `--since <duration>`: events with `ts >= now - duration`
* `--last <N>`: last N matching events
* `--since-cursor <seq>`: events with `seq >= provided`
* `--since-last`: client stores and reuses cursor per service (see §10)

**Filters**

* `--grep <pattern>`: default substring match (case-insensitive by default)
* `--regex`: treat `--grep` as regex (ECMAScript)
* `--fixed`: treat `--grep` as literal substring (disables regex metachar)
* `--case-sensitive`: default OFF
* `--invert`: return non-matching lines
* `--stream combined|stdout|stderr`: MVP default `combined`. If PTY mode, always `combined`.
* `--max-lines <N>`: cap returned events. Default: `80`.
* `--max-bytes <N>`: cap returned text bytes. Default: `32768` (32KB)
* `--format text|json`: default `json` for agent use; allow `text` for humans:

  * `text` prints only `text` field lines, with minimal prefixes optionally.

**Output (JSON)**

```json
{
  "name": "backend",
  "cursor_next": 1450,
  "truncated": false,
  "dropped": false,
  "events": [
    {"seq": 1442, "ts": 1737162000123, "stream": "combined", "text": "Uvicorn running on http://0.0.0.0:8000"},
    {"seq": 1443, "ts": 1737162000456, "stream": "combined", "text": "INFO: Application startup complete."}
  ],
  "match_count": 2
}
```

**Notes**

* `dropped=true` means the requested cursor/time range is older than ring buffer retention and some data was lost.
* `cursor_next` is always `max(seq)+1` for returned events, or current buffer tail+1 if none returned.

---

### 6.3 `tap restart`

Ask runner to restart its child and optionally wait for readiness.

**Usage**

```bash
tap restart --name hatchet_worker --ready "starting runner..." --timeout 20s
tap restart --name backend --ready-regex "Uvicorn running on" --timeout 20s
```

**Flags**

* `--timeout <duration>`: overall timeout for readiness wait. Default: `20s`.
* `--ready <pattern>`: substring match in logs after restart (case-insensitive default)
* `--ready-regex <regex>`: regex match
* `--ready-port <port>`: optional TCP connect check to `127.0.0.1:<port>` (future-friendly; optional in MVP)
* `--grace <duration>`: graceful stop wait before SIGKILL. Default: `2s`.
* `--clear-logs`: if set, clears ring buffer on restart (default OFF). Default behavior inserts a marker event.

**Behavior**

* Runner:

  * inserts event marker: `--- restart requested ---`
  * stops child process group (TERM, wait grace, then KILL)
  * spawns child anew
  * inserts marker: `--- restarted (pid=...) ---`
  * if readiness requested, scans events generated after restart until match or timeout
* Client returns success/failure with snippet on failure.

**Output**

```json
{
  "name": "backend",
  "restarted": true,
  "ready": true,
  "ready_match": "Uvicorn running on",
  "pid": 12345,
  "cursor_next": 1602
}
```

Failure:

```json
{
  "name": "backend",
  "restarted": true,
  "ready": false,
  "reason": "timeout",
  "cursor_next": 1602,
  "snippet": [
    "INFO: Waiting for application startup.",
    "ERROR: Address already in use"
  ]
}
```

---

### 6.4 `tap stop`

Stops the child and then exits the runner.

**Usage**

```bash
tap stop --name frontend
```

**Behavior**

* Sends `POST /v1/stop` to runner.
* Runner:

  * stops child process group
  * shuts down HTTP server
  * removes socket file
  * exits

---

### 6.5 `tap status`

Get runner + child status.

**Usage**

```bash
tap status --name backend
```

**Output**

```json
{
  "name": "backend",
  "runner_pid": 2222,
  "child_pid": 3333,
  "child_state": "running",
  "started_at": 1737161800000,
  "uptime_ms": 120000,
  "pty": true,
  "forward": true,
  "buffer": {"max_lines": 5000, "max_bytes": 10000000, "current_lines": 812, "current_bytes": 421001},
  "last_exit": {"code": null, "signal": null}
}
```

`child_state` ∈ `running|exited|stopped|starting|unknown`.

---

### 6.6 `tap ls`

List known services in the tap dir and indicate which are live.

**Usage**

```bash
tap ls
tap ls --tap-dir /path/to/.tap
```

**Behavior**

* Scans `tap-dir` for `*.sock`
* For each socket, tries `GET /v1/status` with a short timeout (e.g., 250ms–500ms)
* If responsive, show status summary. If not, mark as stale.

**Output (text default)**

```
NAME            STATE     PID     UPTIME
frontend        running   2222    12m
backend         exited    2451    3m   (child exit code 1)
hatchet_worker   running   2601    1h
stale_service    stale     -       -
```

**JSON option**

```json
{
  "services": [
    {"name":"frontend","live":true,"child_state":"running","runner_pid":2222,"uptime_ms":720000},
    {"name":"stale_service","live":false,"reason":"no response"}
  ]
}
```

---

## 7) Runner HTTP API (UDS)

### Base

* Socket: `<tap-dir>/<name>.sock`
* HTTP over UDS
* All endpoints under `/v1`

### Endpoints

#### `GET /v1/status`

Returns status JSON as in `tap status`.

#### `GET /v1/logs`

Query params:

* Window (choose one):

  * `since_ms=<int>`
  * `last=<int>`
  * `cursor=<int>`
* Filters:

  * `grep=<string>`
  * `regex=0|1`
  * `fixed=0|1`
  * `case_sensitive=0|1`
  * `invert=0|1`
  * `stream=combined|stdout|stderr`
* Limits:

  * `max_lines=<int>`
  * `max_bytes=<int>`

Response as in `tap observe`.

#### `POST /v1/restart`

Body:

```json
{
  "grace_ms": 2000,
  "ready": {"type":"substring","pattern":"Uvicorn running on","case_sensitive":false},
  "timeout_ms": 20000,
  "clear_logs": false
}
```

Response as in `tap restart`.

#### `POST /v1/stop`

Body optional:

```json
{"grace_ms": 2000}
```

Response:

```json
{"stopped": true}
```

Runner then exits.

---

## 8) Socket + stale detection behavior

### Runner startup with existing socket file

1. If socket file exists:

   * attempt to connect and call `/v1/status`
   * if responsive: **fail** with clear error:

     * “service `<name>` already running; use `tap status --name <name>` or `tap stop --name <name>`”
   * if not responsive: treat as stale and remove socket file, then bind.

### Client behavior when socket missing

* error: “No runner for `<name>` found (socket missing). Start with `tap run --name <name> -- ...`”

---

## 9) Process management requirements

### Process group / session

* Child must be started in its own process group/session so stop/restart kills the entire tree.
* On stop/restart:

  * send SIGTERM to group
  * wait `grace_ms`
  * send SIGKILL if still alive

### PTY vs pipes

* Default: PTY capture (`node-pty`)
* In PTY mode:

  * stream is `combined`
* Optional: `--no-pty` uses pipes:

  * can preserve stdout/stderr separately (future)
  * still buffers both with `stream` field

### Signals

* Runner handles SIGINT/SIGTERM:

  * stop child group
  * close server
  * unlink socket
  * exit

---

## 10) Client “since-last” cursor persistence

To support `--since-last` across invocations **without log files**, the client needs to remember cursors.

MVP approach: store tiny cursor cache file (this is not logs; it’s state):

* Location:

  * `~/.cache/tap/cursors.json` (Linux)
  * `~/Library/Caches/tap/cursors.json` (macOS)
* Keyed by: `(tap-dir absolute path, service name)`
* Value: last `cursor_next`

If you truly want *zero* files anywhere, then `--since-last` only works within the same shell session, which is not realistic for agents. So the cursor cache is strongly recommended.

---

## 11) Output conventions

### Default outputs

* For agent-facing commands (`observe`, `status`, `restart`, `ls --json`): default to JSON unless `--format text` is requested.
* For human flows:

  * `tap run` prints live output
  * `tap ls` prints table text by default

### Errors

* Errors should go to stderr, with exit code non-zero.
* JSON mode errors should still print a JSON error object when feasible:

```json
{"error":"no_runner","message":"No runner for 'backend' found at .tap/backend.sock"}
```

---

## 12) Ring buffer details

### Event structure

Internally:

* `seq: number` (monotonic)
* `ts: number` (ms epoch)
* `stream: "combined"|"stdout"|"stderr"`
* `text: string`

### Eviction policy

* Maintain:

  * `max_lines` (events)
  * `max_bytes` (approx sum of UTF-8 bytes of `text`)
* On append:

  * while `lines > max_lines` OR `bytes > max_bytes`: evict oldest
* Track `min_seq` currently retained to detect `dropped`.

### Line splitting

* Normalize incoming output to line events:

  * accumulate partial chunks until newline
  * emit complete lines without trailing newline
  * optionally emit partial line if buffer flush occurs on shutdown

---

## 13) Security model

* Access is controlled by filesystem permissions on the `.tap` directory and socket file.
* Default `.tap` directory mode should be `0700` (owner-only) if created by tap.
* Runner should refuse to bind socket if directory permissions are too open (optional warning, not required for MVP).

---

## 14) Dependencies / Implementation Guidance (Node)

### Recommended libraries

* PTY: `node-pty`
* HTTP client: `undici` (supports `socketPath`)
* CLI parsing: `commander` or `yargs`
* Optional: `zod` for request/response validation

### HTTP server

* Node `http` module, listen on socket path.
* Body parsing: small JSON parser for POST bodies.

---

## 15) Acceptance criteria (MVP)

1. `tap run --name frontend -- pnpm dev`:

   * prints dev server output to terminal
   * creates UDS `.tap/frontend.sock`
   * `tap status --name frontend` returns running

2. `tap observe --name frontend --last 50 --grep error`:

   * returns JSON with at most 50 events and bounded bytes
   * supports substring match

3. `tap restart --name frontend --ready "ready" --timeout 20s`:

   * restarts child
   * returns ready true if pattern appears

4. `tap ls`:

   * lists active sockets and indicates which respond

5. No log files are written; only socket + optional cursor cache file.

---

## 16) Future extensions (explicitly out of MVP but planned)

* Multi-service “tap up/down” from a YAML/Procfile
* TCP localhost listening option
* Structured log levels
* Port readiness checks
* WebSocket streaming logs (optional)
* Auth token when binding TCP
* Attach mode: `tap attach --name frontend` (tail -f style)

---

If you want, I can also provide:

* exact request/response JSON schemas (as TypeScript types)
* a recommended project layout (`src/runner`, `src/client`, shared `protocol.ts`)
* a minimal OpenAPI-like doc for the runner API

But the above spec is complete enough for a developer to implement without guessing.

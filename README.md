# tap

A process supervisor with queryable logs. Run your services in the background and query their output through a Unix socket API.

## Why tap?

- **Queryable logs**: Filter, search, and paginate through output without log files
- **Ring buffer**: Keeps recent output in memory with configurable limits
- **Unix socket API**: Query logs programmatically from any language
- **Readiness checks**: Wait for a pattern in output before considering a service ready
- **Zero dependencies at runtime**: Pure Node.js with Unix sockets

## Installation

```bash
npm install
npm run build
```

## Quick Start

```bash
# Start a service
tap run --name myapp -- node server.js

# View recent logs
tap observe --name myapp --last 50

# Check status
tap status --name myapp

# Restart the service
tap restart --name myapp

# Stop everything
tap stop --name myapp
```

## Multi-Directory Support

tap automatically discovers services across subdirectories. This is useful for monorepos or projects with multiple components.

### Service Naming

Services in subdirectories use a colon-separated prefix:

| Socket Location | Service Name |
|-----------------|--------------|
| `.tap/api.sock` | `api` |
| `frontend/.tap/web.sock` | `frontend:web` |
| `backend/.tap/api.sock` | `backend:api` |
| `services/auth/.tap/main.sock` | `services/auth:main` |

### Example: Monorepo Setup

```bash
# Start services in different directories
cd ~/myproject
tap run --name frontend:dev -- npm run dev    # Creates frontend/.tap/dev.sock
tap run --name backend:api -- node server.js  # Creates backend/.tap/api.sock
tap run --name worker -- node worker.js       # Creates .tap/worker.sock

# List all services from project root
tap ls
# NAME              STATE       PID       UPTIME
# ------------------------------------------------
# frontend:dev      running     12345     5m 30s
# backend:api       running     12346     5m 28s
# worker            running     12347     5m 25s

# Query any service by name
tap observe --name frontend:dev --last 20
tap status --name backend:api
tap restart --name worker
```

### Disabling Discovery

Use `--tap-dir` to target a specific directory (disables recursive search):

```bash
tap ls --tap-dir ./backend/.tap
tap observe --name api --tap-dir ./backend/.tap
```

## Commands

### `tap run`

Start a runner server and child process.

```bash
tap run --name <service> [options] -- <command...>
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--name <string>` | Service name (required) | - |
| `--tap-dir <path>` | Override .tap directory | `./.tap` |
| `--cwd <path>` | Working directory for child | Current directory |
| `--env <KEY=VAL>` | Add/override env var (repeatable) | - |
| `--env-file <path>` | Load env vars from file | - |
| `--pty` | Use PTY for child process | Off |
| `--no-forward` | Don't forward output to stdout | Forward on |
| `--buffer-lines <N>` | Ring buffer max events | `5000` |
| `--buffer-bytes <N>` | Ring buffer max bytes | `10000000` |
| `--ready <pattern>` | Substring to wait for in output | - |
| `--ready-regex <regex>` | Regex to wait for in output | - |
| `--print-connection` | Print socket path and PID on startup | Off |

**Examples:**

```bash
# Basic usage
tap run --name api -- node server.js

# With environment variables
tap run --name api --env PORT=3000 --env NODE_ENV=production -- node server.js

# With env file and readiness check
tap run --name api --env-file .env --ready "listening on port" -- node server.js

# With PTY (for programs that need a terminal)
tap run --name app --pty -- npm run dev
```

### `tap observe`

Fetch logs from a running service.

```bash
tap observe --name <service> [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--name <string>` | Service name (required) | - |
| `--tap-dir <path>` | Override .tap directory | `./.tap` |
| `--since <duration>` | Events since duration ago (e.g., `5m`, `1h`) | - |
| `--last <N>` | Last N events | `80` |
| `--since-cursor <seq>` | Events since cursor sequence | - |
| `--since-last` | Since last observed cursor | - |
| `--grep <pattern>` | Filter by pattern | - |
| `--regex` | Treat grep as regex | Off |
| `--case-sensitive` | Case-sensitive matching | Off |
| `--invert` | Invert match | Off |
| `--stream <type>` | Filter: `combined`, `stdout`, `stderr` | `combined` |
| `--max-lines <N>` | Max lines to return | `80` |
| `--max-bytes <N>` | Max bytes to return | `32768` |
| `--format <type>` | Output format: `json`, `text` | `json` |

**Examples:**

```bash
# Get last 100 lines
tap observe --name api --last 100

# Get logs from the last 5 minutes
tap observe --name api --since 5m

# Search for errors
tap observe --name api --grep "error" --case-sensitive

# Get only stderr
tap observe --name api --stream stderr

# Continuous polling (since last cursor)
tap observe --name api --since-last

# Plain text output
tap observe --name api --format text
```

### `tap restart`

Restart the child process without stopping the runner.

```bash
tap restart --name <service> [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--name <string>` | Service name (required) | - |
| `--tap-dir <path>` | Override .tap directory | `./.tap` |
| `--timeout <duration>` | Readiness wait timeout | `20s` |
| `--ready <pattern>` | Substring readiness pattern | - |
| `--ready-regex <regex>` | Regex readiness pattern | - |
| `--grace <duration>` | Grace period before SIGKILL | `2s` |
| `--clear-logs` | Clear ring buffer on restart | Off |
| `--format <type>` | Output format: `json`, `text` | `json` |

**Examples:**

```bash
# Simple restart
tap restart --name api

# Restart with readiness check
tap restart --name api --ready "listening on port" --timeout 30s

# Clear logs on restart
tap restart --name api --clear-logs
```

### `tap stop`

Stop the runner and child process.

```bash
tap stop --name <service> [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--name <string>` | Service name (required) | - |
| `--tap-dir <path>` | Override .tap directory | `./.tap` |
| `--timeout <duration>` | Request timeout | `5s` |
| `--grace <duration>` | Grace period before SIGKILL | `2s` |
| `--format <type>` | Output format: `json`, `text` | `json` |

**Examples:**

```bash
# Stop a service
tap stop --name api

# Stop with longer grace period
tap stop --name api --grace 10s
```

### `tap status`

Get runner and child status.

```bash
tap status --name <service> [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--name <string>` | Service name (required) | - |
| `--tap-dir <path>` | Override .tap directory | `./.tap` |
| `--timeout <duration>` | Request timeout | `5s` |
| `--format <type>` | Output format: `json`, `text` | `json` |

**Examples:**

```bash
# Get status as JSON
tap status --name api

# Get human-readable status
tap status --name api --format text
```

**Sample output (text):**

```
Name: api
State: running
Runner PID: 12345
Child PID: 12346
Uptime: 2h 15m 30s
PTY: false
Forward: true
Buffer: 1234/5000 lines, 256KB/9765KB
```

### `tap ls`

List all known services. Recursively discovers services in subdirectories.

```bash
tap ls [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--tap-dir <path>` | Override .tap directory (disables recursive search) | - |
| `--format <type>` | Output format: `json`, `text` | `text` |

**Examples:**

```bash
# List all services (recursive)
tap ls

# List as JSON
tap ls --json

# List only services in a specific directory
tap ls --tap-dir ./backend/.tap
```

**Sample output:**

```
NAME                STATE       PID       UPTIME
----------------------------------------------------
api                 running     12345     2h 15m 30s
frontend:web        running     12348     1h 20m 15s
backend:worker      running     12350     1h 45m 12s
```

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                     tap run                             │
│  ┌─────────────────────────────────────────────────┐   │
│  │              Runner Server                       │   │
│  │  ┌──────────┐    ┌──────────────────────────┐   │   │
│  │  │  Child   │───▶│      Ring Buffer         │   │   │
│  │  │ Process  │    │  (stdout/stderr lines)   │   │   │
│  │  └──────────┘    └──────────────────────────┘   │   │
│  │       │                        │                │   │
│  │       ▼                        ▼                │   │
│  │   [forward]              Unix Socket            │   │
│  │       │                   (.tap/name.sock)      │   │
│  └───────│────────────────────────│────────────────┘   │
│          ▼                        │                    │
│       stdout                      │                    │
└───────────────────────────────────│────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │   tap observe / status / ...  │
                    │        (HTTP over UDS)        │
                    └───────────────────────────────┘
```

1. **Runner**: The `tap run` command starts a runner process that:
   - Spawns and manages a child process
   - Captures stdout/stderr into a ring buffer
   - Exposes a Unix socket HTTP API

2. **Ring Buffer**: Keeps the last N lines (default 5000) or N bytes (default 10MB) of output in memory. Old entries are evicted when limits are reached.

3. **Unix Socket API**: All commands except `run` communicate with the runner over HTTP via Unix domain sockets at `.tap/<name>.sock`.

4. **Readiness**: The runner can watch for a pattern in output to determine when the child is ready, useful for deployment scripts.

## Security Model

**The trust boundary is filesystem access to the `.tap/` directory.**

Anyone who can read/write to the `.tap` directory can fully control all tap processes in that directory:
- Query logs from any service
- Restart any child process
- Stop any runner

### Protections

- The `.tap/` directory is created with mode `0700` (owner-only access)
- Service names are validated to prevent path traversal attacks
- Regex patterns are validated to prevent ReDoS attacks
- Request body sizes are limited to prevent memory exhaustion

### Implications

| Environment | Security |
|-------------|----------|
| Single-user machine | Secure - only you can access your `.tap/` directory |
| Multi-user, separate working dirs | Secure - each user has their own `.tap/` |
| Shared directory (e.g., `/tmp`) | **Not secure** - anyone with directory access controls your processes |

### Not Protected Against

- **Root**: By design, root can access anything
- **Same-user processes**: Other processes running as your user can access the socket
- **Parent directory access**: Users with write access to the parent of `.tap/` could potentially manipulate it

This follows the standard Unix security model used by SSH agent sockets, Docker sockets, and tmux.

## License

MIT

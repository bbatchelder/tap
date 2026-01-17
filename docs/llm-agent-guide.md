# tap - LLM Agent Guide

`tap` is a process supervisor for running background services with queryable logs. Use it to start, monitor, and manage long-running processes.

## Core Commands

### Start a service
```bash
tap run --name <service> -- <command...>
```
Runs in foreground. For background execution, use `&` or run in a separate terminal/session.

### Query logs
```bash
tap observe --name <service> --last 50
tap observe --name <service> --since 5m
tap observe --name <service> --grep "error"
```

Output (text format is default):
```
Server started on port 3000
Handling request GET /api/users
---
cursor=25 truncated=false dropped=false matches=2
```

The `---` line separates log content from metadata. Use the trailer for pagination.

### Check status
```bash
tap status --name <service>
```

### List all services
```bash
tap ls
```

### Restart a service
```bash
tap restart --name <service>
```

### Stop a service
```bash
tap stop --name <service>
```

## Common Workflows

### Start a dev server and verify it's running
```bash
# Start in background
tap run --name api -- node server.js &

# Wait briefly, then check status
sleep 2
tap status --name api
```

### Check for errors in recent output
```bash
tap observe --name api --grep "error" --last 100
```

### Restart and wait for ready
```bash
tap restart --name api --ready "listening on port" --timeout 30s
```

### Clean up
```bash
tap stop --name api
```

## Output Formats

### Text Format (default for observe and ls)
```
Server started on port 3000
Handling request GET /api/users
---
cursor=25 truncated=false dropped=false matches=2
```

Optional prefixes for debugging:
```bash
tap observe --name api --show-seq --show-stream
```
```
[1] [stdout] Server started on port 3000
[2] [stderr] Warning: deprecated API
---
cursor=3 truncated=false dropped=false matches=2
```

### JSON Format
Use `--json` or `--format json` when you need structured data:

```bash
tap status --name api
```
```json
{
  "child_state": "running",
  "child_pid": 12345,
  "uptime_ms": 3600000
}
```

**Error response:**
```json
{
  "error": "no_runner",
  "message": "No runner for 'api' found..."
}
```

## Multi-Directory Support

tap discovers services recursively in subdirectories. Use colon-separated names for services in subdirectories:

```bash
# Start services in subdirectories
tap run --name frontend:dev -- npm run dev    # Creates frontend/.tap/dev.sock
tap run --name backend:api -- node server.js  # Creates backend/.tap/api.sock

# List all services from project root
tap ls

# Query by prefixed name
tap observe --name frontend:dev --last 20
tap stop --name backend:api
```

## Important Notes

- Services are identified by `--name` - use `prefix:name` for subdirectories
- `tap ls` recursively finds all `.tap/` directories
- Logs are kept in memory (ring buffer), not persisted to disk
- If a service isn't found, you'll get a `no_runner` error - start it first with `tap run`
- Use `--tap-dir` to disable recursive search and target a specific directory

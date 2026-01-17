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
tap observe --name <service> --grep "error" --format text
```

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
tap observe --name api --grep "error" --last 100 --format text
```

### Restart and wait for ready
```bash
tap restart --name api --ready "listening on port" --timeout 30s
```

### Clean up
```bash
tap stop --name api
```

## JSON Output

All commands output JSON by default (except `tap ls` which defaults to text). Key response fields:

**status response:**
```json
{
  "name": "api",
  "child_state": "running",
  "child_pid": 12345,
  "uptime_ms": 3600000
}
```

**observe response:**
```json
{
  "events": [
    {"seq": 1, "ts": 1699900000000, "stream": "stdout", "text": "Server started"}
  ],
  "cursor_next": 2,
  "truncated": false
}
```

**Error response:**
```json
{
  "error": "no_runner",
  "message": "No runner for 'api' found..."
}
```

## Important Notes

- Services are identified by `--name` within a `.tap/` directory
- Default `.tap/` is in current working directory
- Logs are kept in memory (ring buffer), not persisted to disk
- If a service isn't found, you'll get a `no_runner` error - start it first with `tap run`

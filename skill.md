# tap - Process Supervisor for LLM Agents

You are using `tap`, a process supervisor with queryable logs. This guide helps you use tap effectively.

## Quick Reference

```bash
tap ls                                    # List all services
tap observe <svc> --last 50        # View last 50 log lines
tap observe <svc> --grep "error"   # Search logs for "error"
tap restart <svc>                  # Restart a service
tap status <svc>                   # Get detailed status
```

## When to Check Logs

- **After starting a server**: Verify it started successfully
- **When requests fail**: Check for errors in the service logs
- **After code changes**: Confirm hot reload worked (or restart if needed)
- **Debugging issues**: Search logs with `--grep`

## Common Patterns

### Check if a service is running
```bash
tap ls
```
Look at the STATE column. "running" means healthy.

### View recent errors
```bash
tap observe website --last 100 --grep "error" --regex
```

### Check logs from the last 5 minutes
```bash
tap observe website --since 5m
```

### View only stderr (errors/warnings)
```bash
tap observe website --stream stderr --last 50
```

## When to Restart Services

Not all services hot-reload. Restart when:

- **Worker processes**: Background jobs typically need restart after code changes
- **After dependency changes**: e.g., `npx prisma generate` requires server restart
- **When a service is stuck**: `tap restart <svc>`

## Service Names in Monorepos

Services in subdirectories have prefixed names:
- `./sock/myapp.sock` → `myapp`
- `./packages/api/sock/server.sock` → `packages:api:server`

Use `tap ls` to see all discovered services.

## Tips

1. **Start with `tap ls`** to see what's running
2. **Use `--last N`** to limit output (default is 80 lines)
3. **Use `--grep`** to filter logs instead of piping through grep
4. **Check exit codes**: Non-zero means the command failed
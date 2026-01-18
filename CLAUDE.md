# tap

A process supervisor with queryable logs. Run services in the background and query their output through a Unix socket API.

## Project Overview

- **Package:** `@cerebralutopia/tap`
- **Platform:** macOS and Linux only (requires Unix domain sockets and POSIX signals)
- **Runtime:** Node.js >= 18.0.0
- **Language:** TypeScript (ES2022, NodeNext modules)

## Project Structure

```
src/
  cli/           # CLI commands (run, observe, restart, stop, status, ls)
  client/        # Unix socket client and cursor caching
  runner/        # Server, child process management, ring buffer
  protocol/      # Request/response types
  utils/         # Duration parsing, validation, path handling, discovery
test/
  integration/   # Integration tests (cli.test.ts)
  harness.ts     # Test harness utilities
  utils.ts       # Test utilities
```

## Commands

```bash
npm run build      # Compile TypeScript to dist/
npm run dev        # Watch mode compilation
npm test           # Run tests with vitest (watch mode)
npm run test:run   # Run tests once
```

## Architecture

- **Runner Server:** Spawns child process, captures stdout/stderr into ring buffer, exposes Unix socket HTTP API
- **Ring Buffer:** Keeps last N lines (default 5000) or N bytes (default 10MB) in memory
- **Unix Socket API:** Commands communicate via HTTP over Unix domain sockets at `.tap/<name>.sock`
- **Readiness Checks:** Watch for pattern in output before marking service ready

## Testing

Tests are colocated with source files (`*.test.ts` in `src/`) plus integration tests in `test/integration/`. Run with `npm test` or `npm run test:run`.

Unit tests cover:
- Duration parsing (`src/utils/duration.test.ts`)
- Ring buffer behavior (`src/runner/ring-buffer.test.ts`)
- Input validation (`src/utils/validation.test.ts`)
- Error handling (`src/utils/errors.test.ts`)
- Path handling (`src/utils/paths.test.ts`)
- Service discovery (`src/utils/discovery.test.ts`)
- Cursor caching (`src/client/cursor-cache.test.ts`)

## Using tap

```bash
tap ls                              # List all services
tap run myapp -- node server.js     # Start a service
tap observe myapp --last 50         # View last 50 log lines
tap observe myapp --grep "error"    # Search logs
tap restart myapp                   # Restart service
tap stop myapp                      # Stop service
tap status myapp --format text      # Get detailed status
```

## Development Workflows

### New Feature Development
1. **brainstorming** - Explore idea, design collaboratively
2. **writing-plans** - Create bite-sized implementation plan
3. **using-git-worktrees** - Set up isolated workspace
4. **subagent-driven-development** OR **executing-plans** - Implement tasks
5. **finishing-a-development-branch** - Merge/PR/keep/discard

### Bug Fixes
1. **systematic-debugging** - Find root cause (no guessing!)
2. **test-driven-development** - Write failing test for bug
3. **verification-before-completion** - Prove fix works

### Parallel Problem Solving
- **dispatching-parallel-agents** - Use when 3+ independent failures

### Code Review
- **requesting-code-review** - After each task/feature
- **receiving-code-review** - Verify before implementing feedback

## Key Principles

- **TDD Always:** No production code without failing test first
- **Verify Before Claiming:** Run command, show evidence, then claim success
- **Root Cause First:** No fixes without understanding the problem
- **Skills Before Action:** Check if a skill applies (even 1% chance)

## Skill Reference

| Phase | Skill | Trigger |
|-------|-------|---------|
| Design | brainstorming | Starting new feature, unclear requirements |
| Design | writing-plans | Have requirements, need implementation plan |
| Setup | using-git-worktrees | Need isolated workspace for feature |
| Implement | test-driven-development | Any feature or bugfix |
| Implement | systematic-debugging | Any bug, test failure, unexpected behavior |
| Implement | subagent-driven-development | Executing plan in current session |
| Implement | executing-plans | Executing plan in separate session |
| Implement | dispatching-parallel-agents | 3+ independent failures |
| Review | requesting-code-review | After task/feature completion |
| Review | receiving-code-review | When given code review feedback |
| Verify | verification-before-completion | Before claiming anything works |
| Finish | finishing-a-development-branch | Implementation complete, tests pass |
| Meta | writing-skills | Creating or editing skill documentation |
| Foundation | using-superpowers | Starting any conversation (check skills first) |

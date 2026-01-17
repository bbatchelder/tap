import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { TapClient } from '../client/index.js';
import { resolveService } from '../utils/discovery.js';
import { parseDuration, formatDuration } from '../utils/duration.js';
import { formatError, NoRunnerError } from '../utils/errors.js';

export function statusCommand(program: Command): void {
  program
    .command('status')
    .description('Get runner and child status')
    .requiredOption('--name <string>', 'Service name (e.g., "api" or "frontend:api")')
    .option('--tap-dir <path>', 'Override .tap directory (disables recursive search)')
    .option('--timeout <duration>', 'Request timeout', '5s')
    .option('--json', 'Output JSON (default)')
    .option('--format <type>', 'Output format: json|text', 'json')
    .action(async (opts) => {
      const name = opts.name;
      const explicitTapDir = opts.tapDir ? resolve(opts.tapDir) : undefined;
      const resolved = resolveService(name, process.cwd(), explicitTapDir);
      const { socketPath } = resolved!;

      if (!existsSync(socketPath)) {
        console.error(JSON.stringify(formatError(new NoRunnerError(name, socketPath))));
        process.exit(1);
      }

      const timeout = parseDuration(opts.timeout);
      const client = new TapClient(socketPath, timeout);

      try {
        const result = await client.status();

        if (opts.format === 'text') {
          console.log(`Name: ${result.name}`);
          console.log(`State: ${result.child_state}`);
          console.log(`Runner PID: ${result.runner_pid}`);
          console.log(`Child PID: ${result.child_pid ?? 'none'}`);
          console.log(`Uptime: ${formatDuration(result.uptime_ms)}`);
          console.log(`PTY: ${result.pty}`);
          console.log(`Forward: ${result.forward}`);
          console.log(`Buffer: ${result.buffer.current_lines}/${result.buffer.max_lines} lines, ${Math.round(result.buffer.current_bytes / 1024)}KB/${Math.round(result.buffer.max_bytes / 1024)}KB`);
          if (result.last_exit.code !== null || result.last_exit.signal !== null) {
            const reason = result.last_exit.signal
              ? `signal ${result.last_exit.signal}`
              : `code ${result.last_exit.code}`;
            console.log(`Last exit: ${reason}`);
          }
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      } catch (err) {
        console.error(JSON.stringify(formatError(err)));
        process.exit(1);
      }
    });
}

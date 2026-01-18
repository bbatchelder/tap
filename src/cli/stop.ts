import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { TapClient } from '../client/index.js';
import { resolveService } from '../utils/discovery.js';
import { parseDuration } from '../utils/duration.js';
import { formatError, NoRunnerError } from '../utils/errors.js';

export function stopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop the runner and child process')
    .argument('<name>', 'Service name (e.g., "api" or "frontend:api")')
    .option('--tap-dir <path>', 'Override .tap directory (disables recursive search)')
    .option('--timeout <duration>', 'Request timeout', '5s')
    .option('--grace <duration>', 'Graceful stop wait before SIGKILL', '2s')
    .option('--json', 'Output JSON')
    .option('--format <type>', 'Output format: json|text', 'json')
    .action(async (name: string, opts) => {
      // Parse durations first for immediate feedback on invalid input
      let timeout: number;
      let graceMs: number;
      try {
        timeout = parseDuration(opts.timeout);
        graceMs = parseDuration(opts.grace);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      const explicitTapDir = opts.tapDir ? resolve(opts.tapDir) : undefined;
      const resolved = resolveService(name, process.cwd(), explicitTapDir);
      const { socketPath } = resolved!;

      if (!existsSync(socketPath)) {
        console.error(JSON.stringify(formatError(new NoRunnerError(name, socketPath))));
        process.exit(1);
      }

      const client = new TapClient(socketPath, timeout + graceMs + 1000);

      try {
        const result = await client.stop(graceMs);

        if (opts.format === 'text') {
          console.log(`Stopped ${name}`);
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      } catch (err) {
        // Connection reset is expected when the server shuts down
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes('ECONNRESET') || errMsg.includes('socket hang up')) {
          if (opts.format === 'text') {
            console.log(`Stopped ${name}`);
          } else {
            console.log(JSON.stringify({ stopped: true }, null, 2));
          }
          return;
        }
        console.error(JSON.stringify(formatError(err)));
        process.exit(1);
      }
    });
}

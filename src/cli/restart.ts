import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { TapClient } from '../client/index.js';
import { resolveService } from '../utils/discovery.js';
import { parseDuration } from '../utils/duration.js';
import { formatError, NoRunnerError } from '../utils/errors.js';
import type { RestartRequest, ReadyCondition } from '../protocol/types.js';

export function restartCommand(program: Command): void {
  program
    .command('restart')
    .description('Restart the child process')
    .argument('<name>', 'Service name (e.g., "api" or "frontend:api")')
    .option('--tap-dir <path>', 'Override .tap directory (disables recursive search)')
    .option('--timeout <duration>', 'Readiness wait timeout', '20s')
    .option('--ready <pattern>', 'Substring readiness pattern')
    .option('--ready-regex <regex>', 'Regex readiness pattern')
    .option('--grace <duration>', 'Graceful stop wait before SIGKILL', '2s')
    .option('--clear-logs', 'Clear ring buffer on restart')
    .option('--json', 'Output JSON (default)')
    .option('--format <type>', 'Output format: json|text', 'json')
    .action(async (name: string, opts) => {
      // Parse durations first for immediate feedback on invalid input
      let timeoutMs: number;
      let graceMs: number;
      try {
        timeoutMs = parseDuration(opts.timeout);
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

      // Use a longer timeout for restart requests (not the readiness timeout)
      const requestTimeout = timeoutMs + 5000;
      const client = new TapClient(socketPath, requestTimeout);

      // Build restart request
      const body: RestartRequest = {
        grace_ms: graceMs,
        timeout_ms: timeoutMs,
        clear_logs: opts.clearLogs || false,
      };

      // Set ready condition if provided
      if (opts.ready) {
        body.ready = {
          type: 'substring',
          pattern: opts.ready,
          case_sensitive: false,
        };
      } else if (opts.readyRegex) {
        body.ready = {
          type: 'regex',
          pattern: opts.readyRegex,
          case_sensitive: false,
        };
      }

      try {
        const result = await client.restart(body);

        if (opts.format === 'text') {
          if (result.ready) {
            console.log(`Restarted ${name} (pid=${result.pid})`);
            if (result.ready_match) {
              console.log(`Ready: ${result.ready_match}`);
            }
          } else {
            console.error(`Restarted ${name} but readiness check failed: ${result.reason}`);
            if (result.snippet) {
              console.error('Recent output:');
              for (const line of result.snippet) {
                console.error(`  ${line}`);
              }
            }
            process.exit(1);
          }
        } else {
          console.log(JSON.stringify(result, null, 2));
          if (!result.ready) {
            process.exit(1);
          }
        }
      } catch (err) {
        console.error(JSON.stringify(formatError(err)));
        process.exit(1);
      }
    });
}

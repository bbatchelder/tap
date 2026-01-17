import { Command } from 'commander';
import { readdirSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { TapClient } from '../client/index.js';
import { getSocketPath } from '../utils/paths.js';
import { formatDuration } from '../utils/duration.js';
import { formatError } from '../utils/errors.js';
import type { ServiceEntry, ListResponse } from '../protocol/types.js';

export function lsCommand(program: Command): void {
  program
    .command('ls')
    .description('List known services')
    .option('--tap-dir <path>', 'Override .tap directory', './.tap')
    .option('--json', 'Output JSON')
    .option('--format <type>', 'Output format: json|text', 'text')
    .action(async (opts) => {
      const tapDir = resolve(opts.tapDir);
      const useJson = opts.json || opts.format === 'json';

      // Find all socket files
      let sockFiles: string[] = [];
      if (existsSync(tapDir)) {
        try {
          sockFiles = readdirSync(tapDir)
            .filter(f => f.endsWith('.sock'))
            .map(f => f.slice(0, -5)); // Remove .sock extension
        } catch {
          // Directory might not be readable
        }
      }

      if (sockFiles.length === 0) {
        if (useJson) {
          const response: ListResponse = { services: [] };
          console.log(JSON.stringify(response, null, 2));
        } else {
          console.log('No services found');
        }
        return;
      }

      // Check each service
      const services: ServiceEntry[] = [];

      for (const name of sockFiles) {
        const socketPath = getSocketPath(tapDir, name);
        const client = new TapClient(socketPath, 500); // Short timeout for status checks

        try {
          const status = await client.status();
          services.push({
            name,
            live: true,
            child_state: status.child_state,
            runner_pid: status.runner_pid,
            uptime_ms: status.uptime_ms,
          });
        } catch (err) {
          services.push({
            name,
            live: false,
            reason: 'no response',
          });
        }
      }

      if (useJson) {
        const response: ListResponse = { services };
        console.log(JSON.stringify(response, null, 2));
      } else {
        // Print table format
        console.log('NAME'.padEnd(20) + 'STATE'.padEnd(12) + 'PID'.padEnd(10) + 'UPTIME');
        console.log('-'.repeat(52));

        for (const svc of services) {
          if (svc.live) {
            const uptime = formatDuration(svc.uptime_ms!);
            console.log(
              svc.name.padEnd(20) +
              svc.child_state!.padEnd(12) +
              String(svc.runner_pid!).padEnd(10) +
              uptime
            );
          } else {
            console.log(
              svc.name.padEnd(20) +
              'stale'.padEnd(12) +
              '-'.padEnd(10) +
              '-'
            );
          }
        }
      }
    });
}

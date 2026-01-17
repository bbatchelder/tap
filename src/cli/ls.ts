import { Command } from 'commander';
import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { TapClient } from '../client/index.js';
import { discoverServices } from '../utils/discovery.js';
import { formatDuration } from '../utils/duration.js';
import type { ServiceEntry, ListResponse } from '../protocol/types.js';

export function lsCommand(program: Command): void {
  program
    .command('ls')
    .description('List known services')
    .option('--tap-dir <path>', 'Override .tap directory (disables recursive search)')
    .option('--json', 'Output JSON')
    .option('--format <type>', 'Output format: json|text', 'text')
    .action(async (opts) => {
      const useJson = opts.json || opts.format === 'json';
      const explicitTapDir = opts.tapDir ? resolve(opts.tapDir) : null;

      // Discover services
      let discovered: { name: string; socketPath: string }[] = [];

      if (explicitTapDir) {
        // Explicit tap dir - only look there (original behavior)
        if (existsSync(explicitTapDir)) {
          try {
            const sockFiles = readdirSync(explicitTapDir)
              .filter(f => f.endsWith('.sock'));
            discovered = sockFiles.map(f => ({
              name: f.slice(0, -5),
              socketPath: resolve(explicitTapDir, f),
            }));
          } catch {
            // Directory might not be readable
          }
        }
      } else {
        // Recursive discovery from current directory
        discovered = discoverServices(process.cwd());
      }

      if (discovered.length === 0) {
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

      for (const { name, socketPath } of discovered) {
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
        } catch {
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
        // Calculate column width based on longest name
        const maxNameLen = Math.max(20, ...services.map(s => s.name.length + 2));

        // Print table format
        console.log('NAME'.padEnd(maxNameLen) + 'STATE'.padEnd(12) + 'PID'.padEnd(10) + 'UPTIME');
        console.log('-'.repeat(maxNameLen + 32));

        for (const svc of services) {
          if (svc.live) {
            const uptime = formatDuration(svc.uptime_ms!);
            console.log(
              svc.name.padEnd(maxNameLen) +
              svc.child_state!.padEnd(12) +
              String(svc.runner_pid!).padEnd(10) +
              uptime
            );
          } else {
            console.log(
              svc.name.padEnd(maxNameLen) +
              'stale'.padEnd(12) +
              '-'.padEnd(10) +
              '-'
            );
          }
        }
      }
    });
}

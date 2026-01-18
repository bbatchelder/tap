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
            command: status.command,
            last_log_at: status.last_log_at,
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
        // Calculate column widths
        const maxNameLen = Math.max(20, ...services.map(s => s.name.length + 2));
        const maxCmdLen = Math.max(20, ...services.map(s => {
          if (!s.command || s.command.length === 0) return 1;
          return s.command.join(' ').length + 2;
        }));
        const cmdColWidth = Math.min(maxCmdLen, 40); // Cap command column width

        // Print table format
        console.log(
          'NAME'.padEnd(maxNameLen) +
          'STATE'.padEnd(12) +
          'PID'.padEnd(10) +
          'COMMAND'.padEnd(cmdColWidth) +
          'LAST LOG'
        );
        console.log('-'.repeat(maxNameLen + 22 + cmdColWidth + 12));

        for (const svc of services) {
          if (svc.live) {
            const cmdStr = svc.command ? svc.command.join(' ') : '-';
            const cmdDisplay = cmdStr.length > cmdColWidth - 2
              ? cmdStr.slice(0, cmdColWidth - 5) + '...'
              : cmdStr;
            const lastLog = formatTimeAgo(svc.last_log_at);
            console.log(
              svc.name.padEnd(maxNameLen) +
              svc.child_state!.padEnd(12) +
              String(svc.runner_pid!).padEnd(10) +
              cmdDisplay.padEnd(cmdColWidth) +
              lastLog
            );
          } else {
            console.log(
              svc.name.padEnd(maxNameLen) +
              'stale'.padEnd(12) +
              '-'.padEnd(10) +
              '-'.padEnd(cmdColWidth) +
              '-'
            );
          }
        }
      }
    });
}

function formatTimeAgo(timestamp: number | null | undefined): string {
  if (timestamp === null || timestamp === undefined) {
    return 'never';
  }
  const elapsed = Date.now() - timestamp;
  if (elapsed < 0) {
    return 'just now';
  }
  return formatDuration(elapsed) + ' ago';
}

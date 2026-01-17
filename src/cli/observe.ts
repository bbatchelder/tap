import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { TapClient, LogsParams } from '../client/index.js';
import { resolveService } from '../utils/discovery.js';
import { parseDuration } from '../utils/duration.js';
import { getCursor, setCursor } from '../client/cursor-cache.js';
import { formatError, NoRunnerError } from '../utils/errors.js';

/**
 * Format a timestamp as relative time (e.g., "2s ago", "5m ago").
 */
function formatRelativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;

  if (diff < 0) return 'now';
  if (diff < 1000) return `${diff}ms ago`;
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export function observeCommand(program: Command): void {
  program
    .command('observe')
    .description('Fetch logs from runner')
    .requiredOption('--name <string>', 'Service name (e.g., "api" or "frontend:api")')
    .option('--tap-dir <path>', 'Override .tap directory (disables recursive search)')
    .option('--timeout <duration>', 'Request timeout', '5s')
    .option('--since <duration>', 'Events since duration ago')
    .option('--last <N>', 'Last N events')
    .option('--since-cursor <seq>', 'Events since cursor')
    .option('--since-last', 'Since last observed cursor')
    .option('--grep <pattern>', 'Filter by pattern')
    .option('--regex', 'Treat grep as regex')
    .option('--fixed', 'Treat grep as literal substring')
    .option('--case-sensitive', 'Case-sensitive matching')
    .option('--invert', 'Invert match')
    .option('--stream <type>', 'Stream filter: combined|stdout|stderr', 'combined')
    .option('--max-lines <N>', 'Max lines to return', '80')
    .option('--max-bytes <N>', 'Max bytes to return', '32768')
    .option('--format <type>', 'Output format: text|json', 'text')
    .option('--json', 'Output JSON')
    .option('--show-seq', 'Prepend sequence number to each line')
    .option('--show-ts', 'Prepend relative timestamp to each line')
    .option('--show-stream', 'Prepend stream (stdout/stderr) to each line')
    .action(async (opts) => {
      // Parse durations first for immediate feedback on invalid input
      let timeout: number;
      let sinceMs: number | undefined;
      try {
        timeout = parseDuration(opts.timeout);
        if (opts.since) {
          sinceMs = parseDuration(opts.since);
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      const name = opts.name;
      const explicitTapDir = opts.tapDir ? resolve(opts.tapDir) : undefined;
      const resolved = resolveService(name, process.cwd(), explicitTapDir);
      const { socketPath, tapDir } = resolved!;

      if (!existsSync(socketPath)) {
        console.error(JSON.stringify(formatError(new NoRunnerError(name, socketPath))));
        process.exit(1);
      }

      const client = new TapClient(socketPath, timeout);

      // Build query params
      const params: LogsParams = {};

      // Window selection (exactly one, default to --last 80)
      if (opts.sinceLast) {
        const cursor = getCursor(tapDir, name);
        if (cursor !== undefined) {
          params.cursor = cursor;
        } else {
          params.last = parseInt(opts.maxLines);
        }
      } else if (opts.sinceCursor) {
        params.cursor = parseInt(opts.sinceCursor);
      } else if (sinceMs !== undefined) {
        params.since_ms = sinceMs;
      } else if (opts.last) {
        params.last = parseInt(opts.last);
      } else {
        params.last = 80;
      }

      // Filters
      if (opts.grep) {
        params.grep = opts.grep;
        if (opts.regex && !opts.fixed) {
          params.regex = true;
        }
        if (opts.caseSensitive) {
          params.case_sensitive = true;
        }
        if (opts.invert) {
          params.invert = true;
        }
      }

      if (opts.stream && opts.stream !== 'combined') {
        params.stream = opts.stream as 'stdout' | 'stderr';
      }

      // Limits
      params.max_lines = parseInt(opts.maxLines);
      params.max_bytes = parseInt(opts.maxBytes);

      try {
        const result = await client.logs(params);

        // Save cursor for --since-last
        setCursor(tapDir, name, result.cursor_next);

        const useJson = opts.json || opts.format === 'json';

        if (useJson) {
          // JSON format - output full response (without name)
          const { name: _, ...rest } = result;
          console.log(JSON.stringify(rest, null, 2));
        } else {
          // Text format - output lines with optional prefixes
          for (const event of result.events) {
            let prefix = '';
            if (opts.showSeq) prefix += `[${event.seq}] `;
            if (opts.showTs) prefix += `[${formatRelativeTime(event.ts)}] `;
            if (opts.showStream && event.stream !== 'combined') {
              prefix += `[${event.stream}] `;
            }
            console.log(prefix + event.text);
          }
          // Append metadata trailer
          console.log('---');
          console.log(`cursor=${result.cursor_next} truncated=${result.truncated} dropped=${result.dropped} matches=${result.match_count}`);
        }
      } catch (err) {
        console.error(JSON.stringify(formatError(err)));
        process.exit(1);
      }
    });
}

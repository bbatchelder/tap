import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { TapClient, LogsParams } from '../client/index.js';
import { resolveService } from '../utils/discovery.js';
import { parseDuration } from '../utils/duration.js';
import { getCursor, setCursor } from '../client/cursor-cache.js';
import { formatError, NoRunnerError } from '../utils/errors.js';

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
    .option('--format <type>', 'Output format: json|text', 'json')
    .option('--json', 'Output JSON (default for observe)')
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

        if (opts.format === 'text') {
          for (const event of result.events) {
            console.log(event.text);
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

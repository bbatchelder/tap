import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { TapClient, LogsParams } from '../client/index.js';
import { getSocketPath } from '../utils/paths.js';
import { parseDuration } from '../utils/duration.js';
import { getCursor, setCursor } from '../client/cursor-cache.js';
import { formatError, NoRunnerError } from '../utils/errors.js';

export function observeCommand(program: Command): void {
  program
    .command('observe')
    .description('Fetch logs from runner')
    .requiredOption('--name <string>', 'Service name')
    .option('--tap-dir <path>', 'Override .tap directory', './.tap')
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
      const name = opts.name;
      const tapDir = opts.tapDir;
      const socketPath = getSocketPath(tapDir, name);

      if (!existsSync(socketPath)) {
        console.error(JSON.stringify(formatError(new NoRunnerError(name, socketPath))));
        process.exit(1);
      }

      const timeout = parseDuration(opts.timeout);
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
      } else if (opts.since) {
        params.since_ms = parseDuration(opts.since);
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

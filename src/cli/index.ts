import { Command } from 'commander';
import { runCommand } from './run.js';
import { observeCommand } from './observe.js';
import { restartCommand } from './restart.js';
import { stopCommand } from './stop.js';
import { statusCommand } from './status.js';
import { lsCommand } from './ls.js';

const program = new Command();

program
  .name('tap')
  .description('Process supervisor with queryable logs')
  .version('0.1.0');

// Register commands
runCommand(program);
observeCommand(program);
restartCommand(program);
stopCommand(program);
statusCommand(program);
lsCommand(program);

program.parse();

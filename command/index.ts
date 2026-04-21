#!/usr/bin/env bun

import { parseArgs } from "./utils";
import {
  statusCmd,
  affectedCmd,
  commitCmd,
  diffCmd,
  runCmd,
  helpCmd,
} from "./commands";

const { command, positionals, flags } = parseArgs(Bun.argv);

switch (command) {
  case "status":
    await statusCmd();
    break;
  case "affected":
    await affectedCmd(flags);
    break;
  case "commit":
    await commitCmd(positionals, flags);
    break;
  case "diff":
    await diffCmd(positionals);
    break;
  case "run":
    await runCmd(positionals);
    break;
  case "help":
  case "--help":
  case "-h":
    helpCmd();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    helpCmd();
    process.exit(1);
}

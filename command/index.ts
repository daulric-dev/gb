#!/usr/bin/env bun

import { parseArgs } from "./utils";
import { startTimer } from "./timer";
import {
  statusCmd,
  affectedCmd,
  branchCmd,
  commitCmd,
  diffCmd,
  pushCmd,
  syncCmd,
  runCmd,
  helpCmd,
} from "./commands";

const { command, positionals, flags } = parseArgs(Bun.argv);
const stop = startTimer();

switch (command) {
  case "status":
    await statusCmd();
    break;
  case "affected":
    await affectedCmd(flags);
    break;
  case "branch":
    await branchCmd(positionals, flags);
    break;
  case "commit":
    await commitCmd(positionals, flags);
    break;
  case "diff":
    await diffCmd(positionals);
    break;
  case "push":
    await pushCmd(flags);
    break;
  case "sync":
    await syncCmd();
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

stop();

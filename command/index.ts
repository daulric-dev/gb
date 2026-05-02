#!/usr/bin/env bun

import { parseArgs } from "./utils";
import { startTimer } from "./timer";
import {
  statusCmd,
  affectedCmd,
  branchCmd,
  checkoutCmd,
  commitCmd,
  diffCmd,
  pushCmd,
  serviceCmd,
  syncCmd,
  rebaseCmd,
  runCmd,
  helpCmd,
} from "./commands";
import { prCmd } from "./pr";

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
  case "checkout":
    await checkoutCmd(positionals);
    break;
  case "push":
    await pushCmd(flags);
    break;
  case "pr":
    await prCmd(flags);
    break;
  case "sync":
    await syncCmd();
    break;
  case "rebase":
    await rebaseCmd(flags);
    break;
  case "service":
    await serviceCmd(positionals);
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

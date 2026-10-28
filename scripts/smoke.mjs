#!/usr/bin/env node
/**
 * Real-launch smoke test: start every detected tool once, through the very same
 * code path the plugin uses (`launchTool` → `child_process.spawn` with the real
 * executable, the real argv and the real options), targeting one folder.
 *
 *   node scripts/smoke.mjs [target-folder] [tool-id ...]
 *
 * Prints a JSON report (`id`, `executable`, `argv`, `pid`). It starts the tools
 * and nothing else: closing the windows it opened, and proving they appeared,
 * belongs to whoever runs it. The host process is untouched — this is the same
 * call `plugin.call`'s `openTool` makes.
 */

import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const main = require(join(pluginRoot, "main.js"));
const internals = main.__internals;

const targetArgument = process.argv[2];
const target = targetArgument ? resolve(targetArgument) : pluginRoot;
const requested = process.argv.slice(3).filter((value) => !value.startsWith("--"));

const detected = internals.detectTools();
const selection = requested.length > 0 ? detected.filter((tool) => requested.includes(tool.id)) : detected;

if (selection.length === 0) {
  console.error("no detected tool matches: " + (requested.join(", ") || "(none detected)"));
  process.exit(1);
}

console.error(`launching ${selection.length} tool(s) at ${target}`);

const results = [];
for (const tool of selection) {
  try {
    const launched = internals.launchTool(tool.id, target);
    results.push({
      id: tool.id,
      ok: true,
      executable: launched.executable,
      argv: launched.argv,
      pid: launched.pid
    });
  } catch (error) {
    results.push({
      id: tool.id,
      ok: false,
      executable: tool.executable,
      error: (error && error.code) || "LAUNCH_FAILED",
      message: String((error && error.message) || error)
    });
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 900));
}

console.log(JSON.stringify({ target, results }, null, 2));
const failed = results.filter((entry) => !entry.ok);
process.exitCode = failed.length === 0 ? 0 : 1;

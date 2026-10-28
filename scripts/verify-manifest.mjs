#!/usr/bin/env node
/**
 * Check manifest.json against the rules the PI-Desktop installer applies
 * (plugin-host `validateManifest` / `manifestRendererError` / `manifestI18nError`)
 * plus the promises this particular plugin makes:
 *
 *   - the permission set is exactly `renderer.extension` + `notify`;
 *   - the renderer whitelists stay inside what the host allows, and
 *     `rendererCallMethods` is exactly what `main.js` handles;
 *   - the renderer module only dispatches actions its manifest declares.
 *
 * Exit code 0 means every rule passed. Needs no host: plain Node (or Bun).
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const KNOWN_PERMISSIONS = new Set([
  "ui.panel",
  "ui.view",
  "ui.microphone",
  "ui.theme",
  "ui.settings",
  "ui.window.appearance",
  "clipboard.read",
  "clipboard.write",
  "notify",
  "fs.read",
  "fs.write",
  "fs.delete",
  "agent.tool.register",
  "agent.prompt.inject",
  "agent.complete",
  "composer.transform",
  "composer.suggest",
  "agent.extension",
  "renderer.extension",
  "provider.register",
  "provider.oauth",
  "desktop.control",
  "models.list",
  "project.create",
  "session.read",
  "session.import",
  "session.read.own",
  "session.update.own",
  "session.delete.own",
  "session.autoTitle",
  "usage.read",
  "net.fetch",
  "net.anyHost",
  "shell.openExternal",
  "mcp.server.local",
  "mcp.server.remote",
  "background.service",
  "bus.publish",
  "bus.subscribe",
  "browser.cdp",
  "audio.capture.background",
  "audio.playback.background",
  "speech.adapter.register",
  "keyboard.globalShortcut",
  "net.websocket"
]);

const HOST_ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9_-]+)+$/;
const DOCUMENTED_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ALLOWED_RENDERER_ACTIONS = new Set([
  "plugin.call",
  "composer.insertText",
  "composer.readDraft",
  "composer.replaceDraft",
  "attachments.add",
  "attachments.list",
  "attachments.remove"
]);

const failures = [];
const passes = [];

function check(condition, message) {
  if (condition) passes.push(message);
  else failures.push(message);
}

function relativePathProblem(value) {
  if (typeof value !== "string" || !value.trim()) return "must be a non-empty string";
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\")) {
    return "must not be an absolute path";
  }
  if (value.split(/[\\/]/).includes("..")) return 'must not contain ".."';
  return null;
}

function pathInsidePlugin(value, field) {
  const problem = relativePathProblem(value);
  check(!problem, `${field} is a relative path inside the plugin (${value})${problem ? ": " + problem : ""}`);
  if (problem) return null;
  const absolute = resolve(pluginRoot, value);
  const inside = relative(pluginRoot, absolute);
  const escapes = inside === "" || inside === ".." || inside.startsWith(".." + sep) || isAbsolute(inside);
  check(!escapes, `${field} resolves inside the plugin directory`);
  check(existsSync(absolute) && statSync(absolute).isFile(), `${field} exists as a file (${value})`);
  return absolute;
}

// ------------------------------------------------------------------ the manifest
const manifestPath = join(pluginRoot, "manifest.json");
check(existsSync(manifestPath), "manifest.json exists");

let manifest = null;
if (existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    check(true, "manifest.json parses as JSON");
  } catch (error) {
    check(false, "manifest.json parses as JSON: " + String((error && error.message) || error));
  }
}

if (manifest) {
  check(typeof manifest.schemaVersion === "number", "manifest.schemaVersion is a number");
  check(typeof manifest.id === "string" && DOCUMENTED_ID_PATTERN.test(manifest.id), "manifest.id matches [a-zA-Z0-9][a-zA-Z0-9._-]*");
  check(typeof manifest.id === "string" && HOST_ID_PATTERN.test(manifest.id), "manifest.id matches the host pattern ^[a-z0-9]+(\\.[a-z0-9_-]+)+$");
  check(typeof manifest.name === "string" && manifest.name.trim().length > 0, "manifest.name is a non-empty string");
  check(typeof manifest.version === "string" && SEMVER_PATTERN.test(manifest.version), "manifest.version is semver");
  check(typeof manifest.main === "string" && manifest.main.length > 0, "manifest.main is a non-empty string");
  check(manifest.main === "main.js", 'manifest.main is the entry this plugin ships ("main.js")');
  if (typeof manifest.main === "string") pathInsidePlugin(manifest.main, "manifest.main");

  // The installer's own schema is stricter than the JavaScript validator: these
  // fields are plain strings there, so `"author": { "name": … }` fails at install
  // time with "invalid type: map, expected a string".
  for (const field of ["id", "name", "version", "description", "author", "main", "renderer"]) {
    const value = manifest[field];
    if (value === undefined) continue;
    check(typeof value === "string", `manifest.${field} is a plain string (the installer rejects an object here)`);
  }

  // i18n, per manifestI18nError: locale → { name?, description?, safetyNotes? }, strings only.
  const i18n = manifest.i18n;
  check(i18n !== undefined && i18n !== null && typeof i18n === "object" && !Array.isArray(i18n), "manifest.i18n is a locale → entry object");
  if (i18n && typeof i18n === "object" && !Array.isArray(i18n)) {
    for (const [locale, entry] of Object.entries(i18n)) {
      check(entry !== null && typeof entry === "object" && !Array.isArray(entry), `manifest.i18n.${locale} is an object`);
      if (!entry || typeof entry !== "object") continue;
      for (const field of ["name", "description", "safetyNotes"]) {
        if (entry[field] === undefined) continue;
        check(typeof entry[field] === "string", `manifest.i18n.${locale}.${field} is a string`);
      }
    }
    for (const locale of ["en", "zh-CN"]) {
      const entry = i18n[locale];
      check(Boolean(entry), `manifest.i18n.${locale} is present (bilingual manifest)`);
      if (entry) {
        check(typeof entry.name === "string" && entry.name.trim().length > 0, `manifest.i18n.${locale}.name is a non-empty string`);
        check(
          typeof entry.description === "string" && entry.description.trim().length > 0,
          `manifest.i18n.${locale}.description is a non-empty string`
        );
      }
    }
  }

  // Permissions: known names only, and exactly what this plugin promises.
  check(Array.isArray(manifest.permissions), "manifest.permissions is an array");
  if (Array.isArray(manifest.permissions)) {
    for (const permission of manifest.permissions) {
      check(typeof permission === "string" && KNOWN_PERMISSIONS.has(permission), `permission "${permission}" is a name the host knows`);
    }
    const unwanted = manifest.permissions.filter(
      (permission) =>
        permission.startsWith("net.") ||
        permission === "fs.write" ||
        permission === "fs.delete" ||
        permission === "fs.write.workspace" ||
        permission.startsWith("agent.") ||
        permission.startsWith("mcp.") ||
        permission.startsWith("clipboard.") ||
        permission === "shell.openExternal"
    );
    check(unwanted.length === 0, "no file-write, network, agent, MCP, clipboard or shell permission is requested");
    const sorted = [...manifest.permissions].sort();
    check(
      sorted.length === 2 && sorted[0] === "notify" && sorted[1] === "renderer.extension",
      "permissions are exactly notify + renderer.extension (got " + JSON.stringify(sorted) + ")"
    );
  }

  // Renderer entry and whitelists, per manifestRendererError.
  const declaresWhitelist = Boolean((manifest.rendererActions || []).length || (manifest.rendererCallMethods || []).length);
  if (manifest.renderer !== undefined || declaresWhitelist) {
    check(
      Array.isArray(manifest.permissions) && manifest.permissions.includes("renderer.extension"),
      "a renderer module is declared with the renderer.extension permission"
    );
  }
  if (manifest.renderer !== undefined) {
    check(typeof manifest.renderer === "string" && manifest.renderer.length > 0, "manifest.renderer is a non-empty string");
    check(typeof manifest.renderer === "string" && /\.m?js$/.test(manifest.renderer), "manifest.renderer is a .js or .mjs module");
    if (typeof manifest.renderer === "string") pathInsidePlugin(manifest.renderer, "manifest.renderer");
  }
  check(Array.isArray(manifest.rendererActions), "manifest.rendererActions is an array");
  if (Array.isArray(manifest.rendererActions)) {
    check(manifest.rendererActions.length <= 16, "manifest.rendererActions has at most 16 entries");
    for (const action of manifest.rendererActions) {
      check(typeof action === "string" && action.trim().length > 0, "every rendererActions entry is a non-empty string");
      check(typeof action === "string" && ALLOWED_RENDERER_ACTIONS.has(action), `rendererActions entry "${action}" is an action the host allows`);
    }
    check(manifest.rendererActions.includes("plugin.call"), 'rendererActions includes "plugin.call"');
  }
  check(Array.isArray(manifest.rendererCallMethods), "manifest.rendererCallMethods is an array");
  if (Array.isArray(manifest.rendererCallMethods)) {
    check(manifest.rendererCallMethods.length <= 32, "manifest.rendererCallMethods has at most 32 entries");
    for (const method of manifest.rendererCallMethods) {
      check(typeof method === "string" && method.trim().length > 0, "every rendererCallMethods entry is a non-empty string");
    }
  }

  // Declarative contribution paths, when present, stay inside the plugin.
  const contributes = manifest.contributes;
  if (contributes && typeof contributes === "object") {
    if (Array.isArray(contributes.skills)) {
      for (const skill of contributes.skills) if (typeof skill === "string") pathInsidePlugin(skill, "contributes.skills entry");
    }
    if (contributes.views && typeof contributes.views === "object") {
      for (const view of Object.values(contributes.views)) {
        const entry = view && typeof view === "object" ? view.entry || view.view || view.panel : null;
        if (typeof entry === "string") pathInsidePlugin(entry, "contributes.views entry");
      }
    }
    // Settings, per validateContributions: an array of { key, title, type },
    // where a select needs enum options and a shortcut needs a declared command.
    if (contributes.settings !== undefined) {
      check(Array.isArray(contributes.settings), "contributes.settings is an array");
      const SETTING_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/;
      const SETTING_TYPES = new Set(["string", "number", "boolean", "select", "json", "shortcut"]);
      const declaredCommands = new Set(
        (Array.isArray(contributes.commands) ? contributes.commands : []).map((command) => command && command.id)
      );
      const settingKeys = new Set();
      if (Array.isArray(contributes.settings)) {
        for (const setting of contributes.settings) {
          check(
            setting !== null && typeof setting === "object" && !Array.isArray(setting),
            "every contributes.settings entry is an object"
          );
          if (!setting || typeof setting !== "object" || Array.isArray(setting)) continue;
          check(
            typeof setting.key === "string" && SETTING_KEY_PATTERN.test(setting.key),
            `contributes.settings key ${JSON.stringify(setting.key)} matches [a-zA-Z][a-zA-Z0-9._-]{0,63}`
          );
          check(!settingKeys.has(setting.key), `setting key ${JSON.stringify(setting.key)} is declared once`);
          settingKeys.add(setting.key);
          check(
            typeof setting.title === "string" && setting.title.trim().length > 0,
            `setting ${JSON.stringify(setting.key)} has a title`
          );
          check(
            typeof setting.type === "string" && SETTING_TYPES.has(setting.type),
            `setting ${JSON.stringify(setting.key)} has a type the host supports (${JSON.stringify(setting.type)})`
          );
          check(setting.secret !== true, `setting ${JSON.stringify(setting.key)} is not secret (unsupported in this release)`);
          if (setting.type === "select") {
            check(
              Array.isArray(setting.enum) && setting.enum.length > 0,
              `select setting ${JSON.stringify(setting.key)} has enum options`
            );
          }
          if (setting.type === "shortcut") {
            check(
              typeof setting.command === "string" && declaredCommands.has(setting.command),
              `shortcut setting ${JSON.stringify(setting.key)} references a declared command`
            );
          }
        }
        // One editor only: the sheet the plugin draws. A declared `tools`
        // setting would give the plugin manager a second, raw-JSON copy of the
        // same list, which is exactly what this plugin does not want.
        check(
          !contributes.settings.some((setting) => setting && setting.key === "tools"),
          "no tools setting is declared: the plugin's own sheet is the only editor of the list"
        );
      }
    }
  }
  if (manifest.ui && typeof manifest.ui === "object" && typeof manifest.ui.panel === "string") {
    pathInsidePlugin(manifest.ui.panel, "manifest.ui.panel");
  }
}

// -------------------------------------------------- handlers ↔ declared methods
if (manifest && Array.isArray(manifest.rendererCallMethods)) {
  const require = createRequire(import.meta.url);
  const mainPath = join(pluginRoot, typeof manifest.main === "string" ? manifest.main : "main.js");
  let exported = null;
  try {
    exported = require(mainPath);
    check(Boolean(exported), "main.js loads");
  } catch (error) {
    check(false, "main.js loads: " + String((error && error.message) || error));
  }
  if (exported) {
    check(typeof exported.onRendererCall === "function", "main.js exports onRendererCall");
    check(typeof exported.onLoad === "function", "main.js exports onLoad");
    check(typeof exported.onUnload === "function", "main.js exports onUnload");
    const handled = exported.__internals && exported.__internals.supportedMethods();
    check(Array.isArray(handled), "main.js exposes the methods it answers for");
    const internals = (exported && exported.__internals) || {};
    const declaredSettingKeys = ((manifest.contributes && manifest.contributes.settings) || []).map(
      (setting) => setting && setting.key
    );
    check(
      typeof internals.SETTING_TOOLS === "string" && typeof internals.LEGACY_SETTING_CUSTOM_TOOLS === "string",
      "main.js still knows the setting keys it migrates away from"
    );
    check(
      !declaredSettingKeys.includes(internals.SETTING_TOOLS),
      "the migrated setting is not declared, so there is no second copy of the list (" +
        JSON.stringify(declaredSettingKeys) +
        ")"
    );
    check(
      typeof internals.CONFIG_FILE === "string" && /\.json$/.test(internals.CONFIG_FILE),
      "the list lives in its own JSON file (" + JSON.stringify(internals.CONFIG_FILE) + ")"
    );
    check(
      internals.CONFIG_VERSION === 1,
      "the file carries a version number (" + JSON.stringify(internals.CONFIG_VERSION) + ")"
    );
    const mainSource = (() => {
      try {
        return readFileSync(mainPath, "utf8");
      } catch {
        return "";
      }
    })();
    check(
      mainSource.includes("pi.plugin.getDataPath"),
      "main.js asks the host for the plugin data directory"
    );
    check(
      !/pi\.plugin\.setSettings\s*\(/.test(mainSource),
      "main.js never writes the list into the host plugin settings"
    );
    check(
      internals.DIR_PLACEHOLDER === "{dir}",
      'main.js uses the "{dir}" placeholder for the project folder'
    );
    if (Array.isArray(handled)) {
      const declared = [...manifest.rendererCallMethods].sort();
      const actual = [...handled].sort();
      check(
        JSON.stringify(declared) === JSON.stringify(actual),
        "rendererCallMethods matches the methods main.js handles (declared " +
          JSON.stringify(declared) +
          ", handled " +
          JSON.stringify(actual) +
          ")"
      );
    }
  }
}

// ------------------------------------ renderer dispatches only declared actions
if (manifest && typeof manifest.renderer === "string") {
  const rendererPath = join(pluginRoot, manifest.renderer);
  if (existsSync(rendererPath)) {
    const source = readFileSync(rendererPath, "utf8");
    const dispatched = new Set();
    let match;
    const actionPattern = /\.dispatch\(\s*"([^"]+)"/g;
    while ((match = actionPattern.exec(source)) !== null) dispatched.add(match[1]);
    check(dispatched.size > 0, "the renderer module dispatches through the host API");
    const declaredActions = new Set(manifest.rendererActions || []);
    for (const action of dispatched) {
      check(declaredActions.has(action), `the renderer only dispatches declared actions ("${action}" is declared)`);
    }
    const calledMethods = new Set();
    const methodPattern = /dispatchPluginCall\(\s*"([^"]+)"/g;
    while ((match = methodPattern.exec(source)) !== null) calledMethods.add(match[1]);
    const declaredMethods = new Set(manifest.rendererCallMethods || []);
    for (const method of calledMethods) {
      check(declaredMethods.has(method), `the renderer only calls declared methods ("${method}" is declared)`);
    }
    check(
      !/child_process|require\(|spawn\(/.test(source),
      "the renderer module never reaches for a process API"
    );
  } else {
    check(false, "the renderer module exists on disk");
  }
}

// ----------------------------------------------------------------------- report
for (const message of passes) console.log("ok   " + message);
for (const message of failures) console.error("FAIL " + message);
console.log("");
console.log(`${passes.length} passed, ${failures.length} failed`);
if (failures.length > 0) {
  process.exitCode = 1;
} else {
  console.log("manifest OK");
}

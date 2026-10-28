"use strict";

/**
 * mfy.pi-desktop-open-tools — open the current project folder in an external tool.
 *
 * The host runs this file in the plugin's own Node process and hands it a
 * global `pi` object. Everything that actually starts a program happens here,
 * never in the renderer:
 *
 *   - the executable is resolved by this file (a fixed table of install
 *     locations plus the directories already on PATH), never handed in;
 *   - a launch is `child_process.spawn(executable, argv, { shell: false })`,
 *     with the project folder as one argv element and as the working
 *     directory, so there is no command line assembled from strings;
 *   - the renderer may only name a tool id from this table.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PLUGIN_ID = "mfy.pi-desktop-open-tools";
const PLUGIN_VERSION = "0.5.0";
const DETECTION_TTL_MS = 60 * 1000;

/**
 * Environment keys that describe *this host process*, not a tool the user opens.
 * `ELECTRON_RUN_AS_NODE=1` is how PI-Desktop runs a plugin's Node process; a
 * child that inherits it starts an Electron app (VS Code, Cursor, …) as a plain
 * Node script, so it exits immediately and no window ever appears.
 */
const HOST_ONLY_ENV_KEYS = ["ELECTRON_RUN_AS_NODE", "ELECTRON_NO_ATTACH_CONSOLE", "PI_PLUGIN_ID", "NODE_ENV"];

/**
 * Variables that only mean something on Windows. A POSIX child must not see
 * them: `OS=Windows_NT` alone is enough to make a program believe it runs on
 * Windows NT.
 */
const WINDOWS_ONLY_ENV_KEYS = [
  "OS",
  "PATHEXT",
  "ComSpec",
  "SystemRoot",
  "windir",
  "SystemDrive",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "CommonProgramFiles",
  "ProgramData",
  "PUBLIC",
  "LOCALAPPDATA",
  "APPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERPROFILE",
  "USERDOMAIN",
  "COMPUTERNAME",
  "SESSIONNAME",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE"
];

/* ---------------------------------------------------------------- platforms
 *
 * One tool table per system family. The rest of this module never asks the
 * operating system a question directly: it asks a table where a tool lives,
 * how its command line is built, and whether it needs a terminal host. Adding
 * a system therefore means adding a table, not sprinkling the code with
 * `if (process.platform …)`.
 *
 * Anything that is neither Windows nor macOS is treated as Linux/POSIX: the
 * flat layout (/usr/bin/code), `xdg-open` and the usual terminal emulators
 * cover the BSDs too.
 */
const PLATFORM_WINDOWS = "win32";
const PLATFORM_MACOS = "darwin";
const PLATFORM_LINUX = "linux";
const PLATFORMS = [PLATFORM_WINDOWS, PLATFORM_MACOS, PLATFORM_LINUX];

/** A platform name this module understands; anything unknown counts as Linux. */
function normalizePlatform(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw === PLATFORM_WINDOWS || raw === PLATFORM_MACOS || raw === PLATFORM_LINUX) return raw;
  if (raw) return PLATFORM_LINUX;
  const host = process.platform;
  if (host === PLATFORM_WINDOWS) return PLATFORM_WINDOWS;
  if (host === PLATFORM_MACOS) return PLATFORM_MACOS;
  return PLATFORM_LINUX;
}

/** The platform this process runs on. */
const HOST_PLATFORM = normalizePlatform("");

/**
 * Every built-in tool, per platform. Order is the order of the menu.
 *
 * A tool has one or more *variants*, best first. A variant is one way of
 * finding and starting the tool: `candidates(env)` lists absolute locations to
 * try, `executableNames` is what to look for on PATH, `needs(env)` (optional)
 * names paths that must exist for the variant to be usable at all — needed
 * when the launcher is a fixed program such as macOS `open` and the app that
 * decides availability lives somewhere else — and `argv(root)` builds the
 * command line for the variant that matched.
 *
 * In every argv the project folder travels in exactly one element and is never
 * assembled into a command line: Git Bash only understands `--cd=<folder>` (a
 * bare folder argument makes git-bash.exe try to run it as a program), so there
 * the folder rides inside the option element. The folder is always the working
 * directory as well.
 */
const WINDOWS_TOOLS = [
  {
    id: "vscode",
    label: { en: "VS Code", "zh-CN": "VS Code" },
    variants: [
      {
        executableNames: ["Code.exe"],
        candidates: (env) => [
          path.join(env.LOCALAPPDATA || "", "Programs", "Microsoft VS Code", "Code.exe"),
          path.join(env.ProgramFiles || "", "Microsoft VS Code", "Code.exe"),
          path.join(env["ProgramFiles(x86)"] || "", "Microsoft VS Code", "Code.exe")
        ],
        argv: (root) => [root]
      }
    ]
  },
  {
    id: "explorer",
    label: { en: "File Explorer", "zh-CN": "资源管理器" },
    variants: [
      {
        executableNames: ["explorer.exe"],
        candidates: (env) => [path.join(env.SystemRoot || "C:\\Windows", "explorer.exe")],
        argv: (root) => [root]
      }
    ]
  },
  {
    id: "cmd",
    label: { en: "Command Prompt", "zh-CN": "命令提示符 (cmd)" },
    variants: [
      {
        executableNames: ["cmd.exe"],
        candidates: (env) => [path.join(env.SystemRoot || "C:\\Windows", "System32", "cmd.exe")],
        argv: (root) => ["/k", "cd", "/d", root]
      }
    ],
    // A console window needs a console host: cmd.exe does not allocate one
    // itself, and this plugin's process has no console to hand down, so Windows
    // Terminal opens the window and runs cmd.exe inside it.
    consoleHost: "wt"
  },
  {
    id: "powershell",
    label: { en: "Windows PowerShell", "zh-CN": "Windows PowerShell" },
    variants: [
      {
        executableNames: ["powershell.exe"],
        candidates: (env) => [
          path.join(env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
        ],
        argv: (root) => ["-NoExit", "-Command", "Set-Location", "-LiteralPath", root]
      }
    ],
    consoleHost: "wt"
  },
  {
    id: "pwsh",
    label: { en: "PowerShell 7", "zh-CN": "PowerShell 7" },
    variants: [
      {
        executableNames: ["pwsh.exe"],
        candidates: (env) => [
          path.join(env.ProgramFiles || "", "PowerShell", "7", "pwsh.exe"),
          path.join(env.ProgramFiles || "", "PowerShell", "7-preview", "pwsh.exe"),
          path.join(env.LOCALAPPDATA || "", "Microsoft", "WindowsApps", "pwsh.exe")
        ],
        argv: (root) => ["-NoExit", "-WorkingDirectory", root]
      }
    ],
    consoleHost: "wt"
  },
  {
    id: "gitbash",
    label: { en: "Git Bash", "zh-CN": "Git Bash" },
    variants: [
      {
        executableNames: ["git-bash.exe"],
        candidates: (env) => [
          path.join(env.ProgramFiles || "", "Git", "git-bash.exe"),
          path.join(env["ProgramFiles(x86)"] || "", "Git", "git-bash.exe"),
          path.join(env.LOCALAPPDATA || "", "Programs", "Git", "git-bash.exe")
        ],
        argv: (root) => ["--cd=" + root]
      }
    ]
  },
  {
    id: "wt",
    label: { en: "Windows Terminal", "zh-CN": "Windows 终端" },
    consoleHostRole: true,
    variants: [
      {
        executableNames: ["wt.exe"],
        candidates: (env) => [path.join(env.LOCALAPPDATA || "", "Microsoft", "WindowsApps", "wt.exe")],
        argv: (root) => ["-d", root]
      }
    ]
  },
  {
    id: "wsl",
    label: { en: "WSL", "zh-CN": "WSL" },
    variants: [
      {
        executableNames: ["wsl.exe"],
        candidates: (env) => [path.join(env.SystemRoot || "C:\\Windows", "System32", "wsl.exe")],
        argv: (root) => ["--cd", root]
      }
    ]
  }
];

/**
 * macOS: everything goes through LaunchServices (`open`), which is the only
 * supported way to hand a folder to a windowed app. `open <folder>` opens
 * Finder, `open -a <App> <folder>` starts an app on that folder. The GUI apps
 * also install a command-line tool, and where it exists it is used directly
 * because it opens a window on the folder without going through the app
 * registry.
 */
const MACOS_TOOLS = [
  {
    id: "vscode",
    label: { en: "VS Code", "zh-CN": "VS Code" },
    variants: [
      {
        executableNames: ["code"],
        candidates: (env) => [
          "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
          path.join(env.HOME || "", "Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"),
          "/usr/local/bin/code",
          "/opt/homebrew/bin/code"
        ],
        argv: (root) => [root]
      },
      {
        // No shell command installed: ask LaunchServices for the app itself.
        candidates: () => ["/usr/bin/open"],
        needs: () => ["/Applications/Visual Studio Code.app", "/System/Applications/Visual Studio Code.app"],
        argv: (root) => ["-a", "Visual Studio Code", root]
      }
    ]
  },
  {
    id: "finder",
    label: { en: "Finder", "zh-CN": "访达" },
    variants: [
      {
        executableNames: ["open"],
        candidates: () => ["/usr/bin/open"],
        argv: (root) => [root]
      }
    ]
  },
  {
    id: "terminal",
    label: { en: "Terminal", "zh-CN": "终端" },
    variants: [
      {
        executableNames: ["open"],
        candidates: () => ["/usr/bin/open"],
        needs: () => ["/System/Applications/Utilities/Terminal.app", "/Applications/Utilities/Terminal.app"],
        argv: (root) => ["-a", "Terminal", root]
      }
    ]
  },
  {
    id: "iterm",
    label: { en: "iTerm2", "zh-CN": "iTerm2" },
    variants: [
      {
        executableNames: ["open"],
        candidates: () => ["/usr/bin/open"],
        needs: () => ["/Applications/iTerm.app"],
        argv: (root) => ["-a", "iTerm", root]
      }
    ]
  }
];

/**
 * Linux and the BSDs: a flat /usr/bin layout, `xdg-open` for the file manager,
 * and the terminal emulators that accept a working directory on the command
 * line. A terminal that can only be told `-e <command>` is left out: it would
 * open at $HOME and quietly ignore the project folder.
 */
const LINUX_TOOLS = [
  {
    id: "vscode",
    label: { en: "VS Code", "zh-CN": "VS Code" },
    variants: [
      {
        executableNames: ["code", "code-insiders"],
        candidates: () => ["/usr/share/code/code", "/usr/bin/code", "/snap/bin/code", "/opt/visual-studio-code/code"],
        argv: (root) => [root]
      }
    ]
  },
  {
    id: "filemanager",
    label: { en: "File Manager", "zh-CN": "文件管理器" },
    variants: [
      {
        executableNames: ["xdg-open"],
        candidates: () => ["/usr/bin/xdg-open", "/bin/xdg-open"],
        argv: (root) => [root]
      }
    ]
  },
  {
    id: "terminal",
    label: { en: "Terminal", "zh-CN": "终端" },
    variants: [
      {
        executableNames: ["gnome-terminal"],
        candidates: () => ["/usr/bin/gnome-terminal"],
        argv: (root) => ["--working-directory", root]
      },
      {
        executableNames: ["konsole"],
        candidates: () => ["/usr/bin/konsole"],
        argv: (root) => ["--workdir", root]
      },
      {
        executableNames: ["xfce4-terminal"],
        candidates: () => ["/usr/bin/xfce4-terminal"],
        argv: (root) => ["--working-directory", root]
      }
    ]
  }
];

const TOOL_TABLES = { win32: WINDOWS_TOOLS, darwin: MACOS_TOOLS, linux: LINUX_TOOLS };

/** The table of the machine this process runs on. */
const TOOLS = TOOL_TABLES[HOST_PLATFORM] || WINDOWS_TOOLS;

/** The tools this plugin ships a table for on `platform`, in menu order. */
function toolTable(platform) {
  return TOOL_TABLES[normalizePlatform(platform === undefined ? HOST_PLATFORM : platform)] || WINDOWS_TOOLS;
}

/** One built-in tool of `platform` by id, or null. */
function toolById(id, platform) {
  return toolTable(platform).find((tool) => tool.id === id) || null;
}

/** The ids that are built-in on `platform`. */
function builtinIds(platform) {
  return new Set(toolTable(platform).map((tool) => tool.id));
}

/** The ids that can host a console window on `platform` (Windows Terminal only). */
function consoleHostIds(platform) {
  return new Set(
    toolTable(platform)
      .filter((tool) => tool.consoleHostRole === true)
      .map((tool) => tool.id)
  );
}

// ---------------------------------------------------------------- the menu list
//
// The tables above are the ones this plugin ships code for. What the menu
// actually shows is the *tool list*: an ordered array of entries the user can
// enable, disable, rename, re-argument, re-order, delete, and extend with tools
// of their own. `null` — the default — means "the built-in tools of this
// platform". The list is one JSON document in the plugin's own data directory
// (see "storage" below).
//
// The stored shape is deliberately small, and every field is checked below:
//
//   { "id": "vscode", "label": "VS Code", "enabled": true,
//     "executable": "C:\\…\\Code.exe", "args": ["{dir}"], "consoleHost": "wt" }
//
// An entry whose id is a built-in id overrides that tool (label, arguments, and
// optionally the executable); any other id is a custom tool and must carry an
// absolute executable path plus an argv template with "{dir}" as a whole
// element. Windows wants a `.exe` there; macOS and Linux accept any absolute
// path to a program.

const SETTING_TOOLS = "tools";
const LEGACY_SETTING_CUSTOM_TOOLS = "customTools";
const CONFIG_FILE = "tools.json";
const CONFIG_VERSION = 1;
// The id the plugin shipped under before it was renamed; its data folder is
// still the one holding the user's tool list.
const LEGACY_PLUGIN_IDS = ["local.pi-open-tools"];
const TOOL_ID_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const DIR_PLACEHOLDER = "{dir}";
const MAX_TOOLS = 32;
const MAX_TOOL_ARGS = 32;
const MAX_ARG_LENGTH = 1024;
const MAX_LABEL_LENGTH = 64;

// The built-in menu of a platform, in table order, as the setting would store it.
function defaultToolEntries(platform) {
  return toolTable(platform).map((tool) => ({ id: tool.id, enabled: true }));
}

// The built-in tools and their default labels, so the UI can offer them back.
function builtinDefaults(locale, platform) {
  return toolTable(platform).map((tool) => ({
    id: tool.id,
    label: localizedLabel(tool.label, locale),
    consoleHost: tool.consoleHost || null
  }));
}

function emptyToNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && !value.trim()) return null;
  return value;
}

// One stored entry → its normalized shape, or the reason it was rejected.
// Nothing here trusts the setting: this is the only door into the menu.
function normalizeToolEntry(raw, index, platform) {
  const where = "tools[" + index + "]";
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { reason: where + " must be an object" };

  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!TOOL_ID_PATTERN.test(id)) {
    const got = raw.id === undefined ? null : raw.id;
    return { reason: where + ".id must match [a-z][a-z0-9_-]{0,31} (got " + JSON.stringify(got) + ")" };
  }
  const builtin = builtinIds(platform).has(id);

  let label = null;
  const rawLabel = emptyToNull(raw.label);
  if (rawLabel !== null) {
    if (typeof rawLabel !== "string") return { reason: where + ".label must be a string" };
    label = rawLabel.trim();
    if (label.length > MAX_LABEL_LENGTH) {
      return { reason: where + ".label must be " + MAX_LABEL_LENGTH + " characters or shorter" };
    }
  }

  let enabled = true;
  if (raw.enabled !== undefined && raw.enabled !== null) {
    if (typeof raw.enabled !== "boolean") return { reason: where + ".enabled must be true or false" };
    enabled = raw.enabled;
  }

  let executable = null;
  const rawExecutable = emptyToNull(raw.executable);
  if (rawExecutable !== null) {
    if (typeof rawExecutable !== "string") return { reason: where + ".executable must be a string" };
    executable = rawExecutable.trim();
    if (!path.isAbsolute(executable)) {
      return { reason: where + ".executable must be an absolute path (got " + JSON.stringify(executable) + ")" };
    }
    if (normalizePlatform(platform) === PLATFORM_WINDOWS && !/\.exe$/i.test(executable)) {
      return { reason: where + ".executable must name a .exe on Windows (got " + JSON.stringify(executable) + ")" };
    }
  }

  let args = null;
  const rawArgs = emptyToNull(raw.args);
  if (rawArgs !== null) {
    if (!Array.isArray(rawArgs)) return { reason: where + ".args must be an array of strings" };
    if (rawArgs.length > MAX_TOOL_ARGS) return { reason: where + ".args has more than " + MAX_TOOL_ARGS + " entries" };
    const collected = [];
    for (const arg of rawArgs) {
      if (typeof arg !== "string") return { reason: where + ".args must contain only strings" };
      if (arg.length > MAX_ARG_LENGTH) {
        return { reason: where + ".args entries must be " + MAX_ARG_LENGTH + " characters or shorter" };
      }
      collected.push(arg);
    }
    const whole = collected.filter((arg) => arg === DIR_PLACEHOLDER).length;
    if (whole !== 1) {
      return {
        reason: where + '.args must contain "' + DIR_PLACEHOLDER + '" exactly once as a whole element (found ' + whole + ")"
      };
    }
    if (collected.some((arg) => arg !== DIR_PLACEHOLDER && arg.includes(DIR_PLACEHOLDER))) {
      return { reason: where + '.args must not embed "' + DIR_PLACEHOLDER + '" inside another element' };
    }
    args = collected;
  }

  let consoleHost = null;
  const rawHost = emptyToNull(raw.consoleHost);
  if (rawHost !== null) {
    const hosts = consoleHostIds(platform);
    if (typeof rawHost !== "string" || !hosts.has(rawHost)) {
      const allowed = [...hosts];
      return {
        reason:
          where +
          (allowed.length === 0
            ? ".consoleHost is not used on " + normalizePlatform(platform) + " (got " + JSON.stringify(rawHost) + ")"
            : ".consoleHost only supports " + JSON.stringify(allowed) + " (got " + JSON.stringify(rawHost) + ")")
      };
    }
    consoleHost = rawHost;
  }

  if (!builtin && !executable) {
    return { reason: where + '.executable is required for "' + id + '", which is not a built-in tool' };
  }
  if (!builtin && !args) {
    return { reason: where + '.args is required for "' + id + '", with "' + DIR_PLACEHOLDER + '" as a whole element' };
  }

  return { entry: { id, label, enabled, executable, args, consoleHost, builtin } };
}

// The whole `tools` value → `{ entries, skipped }`; never throws.
function normalizeToolEntries(raw, platform) {
  if (raw === undefined || raw === null || raw === "") return { entries: [], skipped: [] };
  // A `json` setting can come back as text: pasting the array as a string is a
  // perfectly reasonable thing to do, so it is parsed rather than rejected.
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return { entries: [], skipped: [] };
    try {
      raw = JSON.parse(text);
    } catch (error) {
      return {
        entries: [],
        skipped: [
          { index: -1, reason: SETTING_TOOLS + " is not valid JSON: " + String((error && error.message) || error) }
        ]
      };
    }
  }
  if (!Array.isArray(raw)) {
    return { entries: [], skipped: [{ index: -1, reason: SETTING_TOOLS + " must be an array of tool objects" }] };
  }

  const seen = new Set();
  const entries = [];
  const skipped = [];
  raw.slice(0, MAX_TOOLS).forEach((rawEntry, index) => {
    const normalized = normalizeToolEntry(rawEntry, index, platform);
    if (!normalized.entry) {
      skipped.push({ index, reason: normalized.reason });
      return;
    }
    if (seen.has(normalized.entry.id)) {
      skipped.push({ index, reason: 'tools[' + index + '].id "' + normalized.entry.id + '" appears more than once' });
      return;
    }
    seen.add(normalized.entry.id);
    entries.push(normalized.entry);
  });
  if (raw.length > MAX_TOOLS) {
    skipped.push({ index: MAX_TOOLS, reason: "only the first " + MAX_TOOLS + " tools are used" });
  }
  return { entries, skipped };
}

// The stored shape written back to the setting (no runtime fields).
function storedToolEntry(entry) {
  const stored = { id: entry.id };
  // `label` is a plain string on a normalized entry and a locale map on a
  // resolved one; `labelText` carries the string in both worlds.
  const label =
    typeof entry.labelText === "string" ? entry.labelText : typeof entry.label === "string" ? entry.label : null;
  if (label) stored.label = label;
  if (entry.enabled === false) stored.enabled = false;
  if (entry.executableOverride) stored.executable = entry.executableOverride;
  else if (typeof entry.executable === "string" && !entry.builtin) stored.executable = entry.executable;
  if (Array.isArray(entry.args)) stored.args = entry.args.slice();
  // Only persist a console host that differs from the built-in default: writing
  // the default back would freeze it if the table ever changes.
  const template = entry.builtin ? toolById(entry.id, entry.platform) : null;
  const defaultConsoleHost = template ? template.consoleHost || null : null;
  if (entry.consoleHost && entry.consoleHost !== defaultConsoleHost) stored.consoleHost = entry.consoleHost;
  return stored;
}

// The argv template of one variant, with the folder as one whole element.
function variantArgv(tool, variantIndex, root) {
  if (!tool || !Array.isArray(tool.variants) || tool.variants.length === 0) return [root];
  const index = typeof variantIndex === "number" && tool.variants[variantIndex] ? variantIndex : 0;
  const variant = tool.variants[index];
  return typeof variant.argv === "function" ? variant.argv(root).slice() : [root];
}

// The argv for one entry and one folder; the folder is always one element.
function entryArgv(entry, root) {
  if (Array.isArray(entry.args)) return entry.args.map((arg) => (arg === DIR_PLACEHOLDER ? root : arg));
  const template = entry.builtin ? toolById(entry.id, entry.platform) : null;
  return template ? variantArgv(template, entry.variant, root) : [root];
}

// The setting → the menu, resolved against this machine.
//
// Each resolved entry carries a status: "ready" (offered in the menu),
// "disabled" (the user turned it off), or "missing" (well-formed, but the
// program — or the console host it needs — is not on this machine). Only
// "ready" entries are offered, so a broken entry stays visible in the settings
// UI but never in the menu.
function resolveToolEntries(raw, context) {
  const platform = context.platform;
  const normalized = normalizeToolEntries(raw, platform);
  const entries = [];
  for (const entry of normalized.entries) {
    const template = entry.builtin ? toolById(entry.id, platform) : null;
    const label = entry.label
      ? { en: entry.label, "zh-CN": entry.label }
      : template
        ? template.label
        : { en: entry.id, "zh-CN": entry.id };

    let executable = null;
    let variant = null;
    let reason = null;
    if (entry.executable) {
      if (isFile(entry.executable, context.fileSystem)) executable = entry.executable;
      else reason = "the executable is not there: " + entry.executable;
    } else if (template) {
      const found = locateTool(template, context);
      if (found) {
        executable = found.executable;
        variant = found.variant;
      } else {
        reason = "not installed on this machine";
      }
    }
    const consoleHost =
      entry.consoleHost !== null ? entry.consoleHost : template && template.consoleHost ? template.consoleHost : null;
    if (!reason && consoleHost) {
      const hostTool = toolById(consoleHost, platform);
      const host = hostTool ? locateTool(hostTool, context) : null;
      if (!host) reason = 'needs "' + consoleHost + '" to open a console window, and it is not installed';
    }

    entries.push({
      id: entry.id,
      label,
      labelText: entry.label,
      builtin: entry.builtin,
      platform,
      enabled: entry.enabled,
      executable,
      executableOverride: entry.executable,
      executableName: executable ? path.basename(executable) : null,
      args: entry.args,
      variant,
      consoleHost,
      status: !entry.enabled ? "disabled" : reason ? "missing" : "ready",
      reason
    });
  }
  return { entries, skipped: normalized.skipped };
}

// What the setting currently holds; `null` means the built-in defaults.
let storedToolSetting = null;
let toolState = { at: 0, signature: "", platform: HOST_PLATFORM, entries: [], tools: [], skipped: [] };

function toolConfigSignature(raw) {
  return raw === null || raw === undefined ? "default" : JSON.stringify(raw);
}

function resetDetectionCache() {
  toolState = { at: 0, signature: "", platform: HOST_PLATFORM, entries: [], tools: [], skipped: [] };
}

// Resolve the configured list against this machine, cached in memory only.
function resolveConfiguredTools(overrides, force) {
  const context = makeContext(overrides);
  const raw = storedToolSetting === null ? defaultToolEntries(context.platform) : storedToolSetting;
  const signature = context.platform + "|" + toolConfigSignature(raw);
  const now = context.now();
  if (!force && toolState.at > 0 && toolState.signature === signature && now - toolState.at < DETECTION_TTL_MS) {
    return toolState;
  }
  const resolved = resolveToolEntries(raw, context);
  toolState = {
    at: now,
    signature,
    platform: context.platform,
    entries: resolved.entries,
    tools: resolved.entries
      .filter((entry) => entry.status === "ready")
      .map((entry) => ({
        id: entry.id,
        label: entry.label,
        executable: entry.executable,
        executableName: entry.executableName,
        builtin: entry.builtin
      })),
    skipped: resolved.skipped
  };
  return toolState;
}

// The menu: every configured entry that is enabled and really there.
function detectTools(overrides) {
  return resolveConfiguredTools(overrides, false).tools;
}

// Every configured entry, in menu order, whatever its status.
function toolEntries(overrides) {
  return resolveConfiguredTools(overrides, false).entries;
}

// ------------------------------------------------------------------- storage
//
// The list is one small JSON document in the plugin's own data directory:
//
//   %USERPROFILE%\.pi-desktop\plugins\data\<plugin id>\tools.json
//   { "version": 1, "tools": [ ... ] }        // tools: null = built-in eight
//
// It deliberately does not live in the host's plugin settings. The host renders
// every declared setting as a field in its own dialog, so a declared `tools`
// setting meant a raw JSON box: a second, worse editor for the same list, right
// next to the sheet this plugin draws. One list, one editor.

function messageOf(error) {
  return String((error && error.message) || error);
}

async function configDirectory(overrides) {
  const base = overrides || launchOverrides;
  if (base && typeof base.dataPath === "string" && base.dataPath) return base.dataPath;
  try {
    if (typeof pi !== "undefined" && pi && pi.plugin && typeof pi.plugin.getDataPath === "function") {
      const directory = await pi.plugin.getDataPath();
      if (typeof directory === "string" && directory.trim()) return directory.trim();
    }
  } catch (error) {
    console.warn("[open-tools] could not resolve the plugin data directory: " + messageOf(error));
  }
  return null;
}

// Where the list is (or would be) written; null when the host offers no folder.
async function configFilePath(overrides) {
  const directory = await configDirectory(overrides);
  return directory ? path.join(directory, CONFIG_FILE) : null;
}

function parseConfigText(text, file) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { tools: undefined, file, error: "is not valid JSON (" + messageOf(error) + ")" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { tools: undefined, file, error: 'must hold an object like { "version": 1, "tools": [] }' };
  }
  return { tools: parsed.tools === undefined ? null : parsed.tools, file, error: null };
}

// The plugin id was `local.pi-open-tools` until the rename: carry that data
// folder's list over instead of handing the user the built-in defaults.
// Only the host's own data folder is searched; a test-injected one is left alone.
function adoptLegacyConfigFile(file, overrides) {
  const base = overrides || launchOverrides;
  if (base && typeof base.dataPath === "string" && base.dataPath) return null;
  const parent = path.dirname(path.dirname(file));
  for (const id of LEGACY_PLUGIN_IDS) {
    const candidate = path.join(parent, id, CONFIG_FILE);
    if (candidate === file) continue;
    let text;
    try {
      text = fs.readFileSync(candidate, "utf8");
    } catch {
      continue;
    }
    const parsed = parseConfigText(text, candidate);
    if (parsed.error) continue;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text, "utf8");
      console.log("[open-tools] carried " + CONFIG_FILE + " over from " + id);
    } catch (error) {
      console.warn("[open-tools] could not copy " + CONFIG_FILE + " from " + id + ": " + messageOf(error));
    }
    return text;
  }
  return null;
}

// The document as it is on disk.
//   tools === undefined : nothing usable was read (no file yet, or it is broken)
//   tools === null      : an explicit "use the built-in defaults"
async function readConfigDocument(overrides) {
  const file = await configFilePath(overrides);
  if (!file) return { tools: undefined, file: null, error: null };
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    const code = error && error.code;
    if (code !== "ENOENT") return { tools: undefined, file, error: "could not be read: " + messageOf(error) };
    const carried = adoptLegacyConfigFile(file, overrides);
    if (carried === null) return { tools: undefined, file, error: null };
    return parseConfigText(carried, file);
  }
  return parseConfigText(text, file);
}

// The one writer: the whole list, validated by the caller, written to a
// temporary file and renamed into place so a crash cannot leave half a list.
async function writeConfigDocument(tools, overrides) {
  const directory = await configDirectory(overrides);
  if (!directory) throw new Error("the host did not provide a plugin data directory");
  const file = path.join(directory, CONFIG_FILE);
  const body = JSON.stringify({ version: CONFIG_VERSION, tools }, null, 2) + "\n";
  const temporary = file + "." + process.pid + "." + Date.now() + ".tmp";
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(temporary, body, "utf8");
    fs.renameSync(temporary, file);
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // best effort: the temporary file is ours, and a leftover is harmless
    }
    throw error;
  }
  return file;
}

// The host settings, where 0.2 (`customTools`) and 0.3 (`tools`) kept the list.
async function readLegacySettings() {
  try {
    if (typeof pi !== "undefined" && pi && pi.plugin && typeof pi.plugin.getSettings === "function") {
      const settings = await pi.plugin.getSettings();
      if (settings && typeof settings === "object") return settings;
    }
  } catch (error) {
    console.warn("[open-tools] could not read the old settings: " + messageOf(error));
  }
  return {};
}

// Carry an older install's list into the new file, once. Without this a 0.3
// user's edits would disappear the moment this version is installed.
async function adoptLegacySettings(overrides) {
  const settings = await readLegacySettings();
  const raw = settings[SETTING_TOOLS];
  let next = null;
  if (raw !== undefined && raw !== null && raw !== "") {
    next = raw;
  } else {
    const legacy = settings[LEGACY_SETTING_CUSTOM_TOOLS];
    const parsed = normalizeToolEntries(Array.isArray(legacy) ? legacy : null);
    if (parsed.entries.length > 0) next = defaultToolEntries().concat(parsed.entries.map(storedToolEntry));
  }
  if (next === null) return null;
  try {
    await writeConfigDocument(next, overrides);
    console.log("[open-tools] carried the old tool list over to " + CONFIG_FILE);
  } catch (error) {
    console.warn("[open-tools] could not write " + CONFIG_FILE + ": " + messageOf(error));
  }
  return next;
}

// Read the document and resolve it. Called before every menu, every launch and
// every render of the sheet, so an edit takes effect without reloading the plugin.
async function loadToolConfig(overrides) {
  const document = await readConfigDocument(overrides);
  if (document.error) {
    console.warn("[open-tools] " + CONFIG_FILE + " " + document.error + " — the built-in defaults are used");
  }
  let next = null;
  if (document.tools === undefined) next = await adoptLegacySettings(overrides);
  else if (document.tools !== null && document.tools !== "") next = document.tools;
  storedToolSetting = next;
  resetDetectionCache();
  const state = resolveConfiguredTools(overrides, true);
  for (const entry of state.skipped) console.warn("[open-tools] skipped tool: " + entry.reason);
  return state;
}

// The shape the settings UI renders and posts back.
function configPayload(state, locale, project, file) {
  const platform = state.platform || HOST_PLATFORM;
  return {
    ok: true,
    file: file || null,
    locale,
    platform,
    project: project ? project.path : null,
    entries: state.entries.map((entry) => {
      const template = entry.builtin ? toolById(entry.id, platform) : null;
      return {
        id: entry.id,
        label: entry.label,
        defaultLabel: template ? localizedLabel(template.label, locale) : null,
        builtin: entry.builtin,
        enabled: entry.enabled,
        status: entry.status,
        reason: entry.reason,
        executable: entry.executable,
        executableName: entry.executableName,
        executableOverride: entry.executableOverride,
        args: entry.args,
        defaultArgs: template ? variantArgv(template, null, DIR_PLACEHOLDER) : null,
        consoleHost: entry.consoleHost,
        defaultConsoleHost: template ? template.consoleHost || null : null,
        stored: storedToolEntry(entry)
      };
    }),
    builtins: builtinDefaults(locale, platform),
    consoleHosts: [...consoleHostIds(platform)],
    skipped: state.skipped.map((entry) => entry.reason),
    limit: MAX_TOOLS
  };
}

function pluginError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** The real file system, in the small shape the detector needs. */
function systemFileSystem() {
  return {
    statSync: (target) => fs.statSync(target),
    lstatSync: (target) => fs.lstatSync(target)
  };
}

/**
 * Test seam: the offline self-test installs a fake file system, a fake spawn
 * and a fake clock here so it can assert the real handlers without opening a
 * single window. Only this module's own `__internals` object reaches it — the
 * host, the renderer and `plugin.call` never can.
 */
let launchOverrides = null;

function setLaunchOverrides(next) {
  launchOverrides = next || null;
}

/**
 * The environment this plugin works with.
 *
 * The host starts the plugin process with a deliberately small environment, so
 * anything read here — a tool's install location under `LOCALAPPDATA`, the
 * environment a launched tool inherits — has to start from the completed set.
 * Completing it once and reusing it keeps detection and launching consistent.
 */
let processEnvironment = null;

function defaultEnvironment(platform) {
  const target = normalizePlatform(platform === undefined ? HOST_PLATFORM : platform);
  if (!processEnvironment) processEnvironment = {};
  if (!processEnvironment[target]) processEnvironment[target] = buildChildEnvironment(process.env, null, target);
  return processEnvironment[target];
}

function makeContext(overrides) {
  const base = overrides || launchOverrides || {};
  const fileSystem = base.fileSystem || systemFileSystem();
  const platform = normalizePlatform(base.platform === undefined ? HOST_PLATFORM : base.platform);
  return {
    // Whatever environment we are handed is completed first: the host's stripped
    // one in production, an injected one in the self-test. Every path this module
    // derives from the profile is then in place for both detection and launching.
    env: base.env ? buildChildEnvironment(base.env, fileSystem, platform) : defaultEnvironment(platform),
    fileSystem,
    platform,
    spawn: base.spawn || spawn,
    now: base.now || Date.now
  };
}

function isFile(target, fileSystem) {
  if (!target) return false;
  try {
    return fileSystem.statSync(target).isFile();
  } catch {
    /* an app-execution alias (WindowsApps\wt.exe) refuses statSync with EACCES
       while lstatSync still sees the reparse point; only an existing non-directory
       entry is accepted, and the launcher resolves the alias at spawn time. */
  }
  try {
    if (typeof fileSystem.lstatSync !== "function") return false;
    const info = fileSystem.lstatSync(target);
    return !info.isDirectory();
  } catch {
    return false;
  }
}

/**
 * The environment a launched tool gets.
 *
 * The host starts the plugin process with a deliberately small environment
 * (`PATH`, `SystemRoot`, `windir`, `TEMP`, `TMP`, `TMPDIR`, `LANG`, `HOME`,
 * `USER`, `USERPROFILE`), so inheriting it as-is gives a child that cannot find
 * its own settings: Windows Terminal looks for
 * `%LOCALAPPDATA%\Packages\…\LocalState\settings.json`, fails with
 * "the system cannot find the path specified" and drops to its defaults, and
 * GUI apps such as VS Code refuse to start at all.
 *
 * So the standard Windows variables are filled back in — from the inherited
 * ones where they exist, otherwise derived from the user profile and checked on
 * disk. Nothing is invented that does not exist, and nothing is read from the
 * network or the registry.
 */
function buildChildEnvironment(baseEnv, fileSystem, platform) {
  const target = normalizePlatform(platform === undefined ? HOST_PLATFORM : platform);
  if (target !== PLATFORM_WINDOWS) return buildPosixEnvironment(baseEnv);
  const env = { ...(baseEnv || process.env) };
  const probe = fileSystem && typeof fileSystem.statSync === "function" ? fileSystem : systemFileSystem();
  const directoryOnDisk = (target) => {
    if (!target) return false;
    try {
      return probe.statSync(target).isDirectory();
    } catch {
      return false;
    }
  };
  const has = (key) => typeof env[key] === "string" && env[key].trim().length > 0;
  const setIfMissing = (key, value) => {
    if (!has(key) && typeof value === "string" && value) env[key] = value;
  };
  const setIfDirectory = (key, value) => {
    if (!has(key) && directoryOnDisk(value)) env[key] = value;
  };

  let profile = has("USERPROFILE") ? env.USERPROFILE : "";
  if (!profile) {
    try {
      profile = os.homedir();
    } catch {
      profile = "";
    }
  }
  setIfMissing("USERPROFILE", profile);
  if (profile) {
    const root = path.parse(profile).root;
    setIfMissing("HOMEDRIVE", root ? root.replace(/[\\/]+$/, "") : undefined);
    setIfMissing("HOMEPATH", root ? profile.slice(root.length - 1) : profile);
    setIfDirectory("LOCALAPPDATA", path.join(profile, "AppData", "Local"));
    setIfDirectory("APPDATA", path.join(profile, "AppData", "Roaming"));
    if (!has("TEMP")) {
      const temp = path.join(profile, "AppData", "Local", "Temp");
      setIfDirectory("TEMP", temp);
      setIfDirectory("TMP", temp);
    }
  }

  const systemRoot = has("SystemRoot") ? env.SystemRoot : has("windir") ? env.windir : "C:\\Windows";
  setIfDirectory("SystemRoot", systemRoot);
  setIfDirectory("windir", systemRoot);
  setIfMissing("SystemDrive", path.parse(systemRoot).root.replace(/[\\/]+$/, ""));
  setIfMissing("OS", "Windows_NT");
  setIfDirectory("ProgramData", has("ProgramData") ? env.ProgramData : "C:\\ProgramData");
  setIfDirectory("ProgramFiles", has("ProgramFiles") ? env.ProgramFiles : "C:\\Program Files");
  setIfDirectory("ProgramFiles(x86)", has("ProgramFiles(x86)") ? env["ProgramFiles(x86)"] : "C:\\Program Files (x86)");
  setIfMissing("ProgramW6432", env.ProgramFiles);
  setIfDirectory(
    "CommonProgramFiles",
    has("CommonProgramFiles") ? env.CommonProgramFiles : path.join(systemRoot, "..", "Program Files", "Common Files")
  );
  setIfDirectory("PUBLIC", has("PUBLIC") ? env.PUBLIC : path.join(profile, "..", "Public"));

  if (!has("ComSpec")) {
    const comSpec = path.join(systemRoot, "System32", "cmd.exe");
    if (isFile(comSpec, probe)) env.ComSpec = comSpec;
  }
  setIfMissing("PATHEXT", ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC");
  if (!has("USERNAME")) {
    try {
      env.USERNAME = os.userInfo().username;
    } catch {
      /* left unset */
    }
  }
  if (!has("USERDOMAIN")) env.USERDOMAIN = process.env.USERDOMAIN || "";
  if (!has("COMPUTERNAME")) {
    try {
      env.COMPUTERNAME = os.hostname();
    } catch {
      /* left unset */
    }
  }
  setIfMissing("SESSIONNAME", "Console");
  if (!has("NUMBER_OF_PROCESSORS")) {
    const count = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
    env.NUMBER_OF_PROCESSORS = String(count || 1);
  }
  setIfMissing("PROCESSOR_ARCHITECTURE", process.arch === "x64" ? "AMD64" : process.arch === "arm64" ? "ARM64" : "x86");
  if (!env.USERDOMAIN) delete env.USERDOMAIN;
  if (!env.COMPUTERNAME) delete env.COMPUTERNAME;

  // PATH: keep what we were given and add the standard Windows folders that
  // really exist, so a shell started in the window behaves like the user's own.
  const segments = String(env.PATH || env.Path || "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const standard = [
    path.join(systemRoot, "System32"),
    systemRoot,
    path.join(systemRoot, "System32", "Wbem"),
    path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0"),
    path.join(systemRoot, "System32", "OpenSSH"),
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Microsoft", "WindowsApps") : ""
  ];
  for (const candidate of standard) {
    if (!candidate) continue;
    const lowered = candidate.toLowerCase();
    if (segments.some((entry) => entry.toLowerCase() === lowered)) continue;
    if (directoryOnDisk(candidate)) segments.push(candidate);
  }
  if (segments.length > 0) env.PATH = segments.join(path.delimiter);

  return finishEnvironment(env);
}

/**
 * The environment a launched tool gets on macOS and Linux.
 *
 * POSIX children need far less than Windows ones — a `HOME` to find their own
 * configuration, a `USER`, a `SHELL` for the terminal emulators and a writable
 * `TMPDIR` — and they must *not* be handed the Windows-only variables
 * (`OS`, `PATHEXT`, `ComSpec`, `ProgramFiles`, …): a program that reads `OS`
 * would conclude it is running on Windows NT.
 */
function buildPosixEnvironment(baseEnv) {
  const env = { ...(baseEnv || process.env) };
  const has = (key) => typeof env[key] === "string" && env[key].trim().length > 0;

  let home = has("HOME") ? env.HOME : "";
  if (!home) {
    try {
      home = os.homedir();
    } catch {
      home = "";
    }
  }
  if (home) env.HOME = home;
  if (!has("TMPDIR")) {
    for (const candidate of ["/tmp", "/var/tmp"]) {
      if (isDirectory(candidate, systemFileSystem())) {
        env.TMPDIR = candidate;
        break;
      }
    }
  }
  if (!has("SHELL")) {
    for (const candidate of ["/bin/zsh", "/bin/bash", "/bin/sh"]) {
      if (isFile(candidate, systemFileSystem())) {
        env.SHELL = candidate;
        break;
      }
    }
  }
  if (!has("USER") && has("USERNAME")) env.USER = env.USERNAME;
  if (!has("USER") && !has("LOGNAME")) {
    try {
      const name = os.userInfo().username;
      if (name) env.USER = name;
    } catch {
      /* left unset */
    }
  }
  if (!has("LOGNAME") && has("USER")) env.LOGNAME = env.USER;

  // The Windows-only names have no meaning here, and the register/launch code
  // never reads them: drop them instead of passing them on.
  for (const key of WINDOWS_ONLY_ENV_KEYS) delete env[key];

  return finishEnvironment(env);
}

/** Drop the host's own markers and every empty value a child should not see. */
function finishEnvironment(env) {
  // The host runs this plugin process as Node inside PI-Desktop, so the process
  // carries ELECTRON_RUN_AS_NODE=1 plus the host's own markers. Handing those to
  // a child makes any Electron-based tool (VS Code, Cursor, …) start as Node and
  // exit without a window — which is exactly "I clicked and nothing happened".
  for (const key of HOST_ONLY_ENV_KEYS) delete env[key];
  for (const key of Object.keys(env)) {
    if (typeof env[key] !== "string" || env[key].length === 0) delete env[key];
  }
  return env;
}

function isDirectory(target, fileSystem) {
  if (!target) return false;
  try {
    return fileSystem.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function searchDirectories(env) {
  const raw = env.PATH || env.Path || "";
  return String(raw)
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
}

/**
 * Where a tool is on this machine, as `{ executable, variant }`, or null.
 *
 * Variants are tried best first. A variant that declares `needs` is only usable
 * when at least one of those paths exists — that is how a macOS app is found
 * when the launcher itself is always the same `open` binary.
 */
function locateTool(tool, context) {
  if (!tool || !Array.isArray(tool.variants)) return null;
  for (let index = 0; index < tool.variants.length; index += 1) {
    const variant = tool.variants[index];
    const needed = typeof variant.needs === "function" ? variant.needs(context.env) : null;
    if (Array.isArray(needed) && needed.length > 0) {
      const present = needed.some(
        (target) => isFile(target, context.fileSystem) || isDirectory(target, context.fileSystem)
      );
      if (!present) continue;
    }
    const candidates = typeof variant.candidates === "function" ? variant.candidates(context.env) : [];
    for (const candidate of candidates) {
      if (isFile(candidate, context.fileSystem)) return { executable: candidate, variant: index };
    }
    for (const directory of searchDirectories(context.env)) {
      for (const name of variant.executableNames || []) {
        const candidate = path.join(directory, name);
        if (isFile(candidate, context.fileSystem)) return { executable: candidate, variant: index };
      }
    }
  }
  return null;
}

/** The absolute path of a tool's executable on this machine, or null. */
function resolveExecutable(tool, context) {
  const found = locateTool(tool, context);
  return found ? found.executable : null;
}

/** Where in argv the project folder rides: an element, or the tail of an option. */
function argvDirectoryIndex(argv, target) {
  return argv.findIndex((entry) => entry === target || entry.endsWith("=" + target));
}

/**
 * The exact launch that would run: executable, argv and spawn options.
 * Exported through `__internals` so the offline self-test can assert it.
 *
 * `executable`/`argv` are the shell or program the user asked for.
 * `spawnExecutable` and `spawnArgv` are what actually gets started: the same
 * program directly, or — for a tool with a `consoleHost` — the console host
 * with the program as its command line. The project folder is always one argv
 * element (for Git Bash, the tail of the `--cd=` element) and never assembled
 * into a command line.
 */
function buildLaunch(toolId, root, overrides) {
  const id = String(toolId || "");
  const entry = toolEntries(overrides).find((candidate) => candidate.id === id);
  if (!entry) throw pluginError("UNKNOWN_TOOL", "unknown tool: " + id);
  if (!entry.enabled) throw pluginError("TOOL_DISABLED", id + " is turned off in the tool settings");
  if (entry.status !== "ready" || !entry.executable) {
    throw pluginError("TOOL_NOT_FOUND", id + ": " + (entry.reason || "not available on this machine"));
  }
  const target = path.resolve(String(root || ""));
  const context = makeContext(overrides);
  const executable = entry.executable;
  const argv = entryArgv(entry, target);
  let spawnExecutable = executable;
  let spawnArgv = argv;
  let consoleHost = null;
  if (entry.consoleHost) {
    const host = toolById(entry.consoleHost, entry.platform);
    const found = host ? locateTool(host, context) : null;
    if (!found) {
      throw pluginError(
        "CONSOLE_HOST_MISSING",
        entry.id + " needs " + entry.consoleHost + " to open a console window, and it is not installed"
      );
    }
    consoleHost = host.id;
    spawnExecutable = found.executable;
    spawnArgv = [executable, ...argv];
  }
  const dirIndex = argvDirectoryIndex(argv, target);
  return {
    id: entry.id,
    executable,
    argv,
    argvTarget: dirIndex === argv.length - 1 ? "last" : dirIndex >= 0 ? "option" : "none",
    dirIndex,
    consoleHost,
    spawnExecutable,
    spawnArgv,
    options: {
      cwd: target,
      env: buildChildEnvironment(context.env, context.fileSystem, context.platform),
      shell: false,
      detached: true,
      stdio: "ignore",
      windowsHide: false
    }
  };
}

/** Start the tool. The child is detached so it outlives the plugin process. */
function launchTool(toolId, root, overrides) {
  const launch = buildLaunch(toolId, root, overrides);
  const context = makeContext(overrides);
  const child = context.spawn(launch.spawnExecutable, launch.spawnArgv, launch.options);
  const pid = child && typeof child.pid === "number" && child.pid > 0 ? child.pid : null;
  try {
    if (child && typeof child.unref === "function") child.unref();
  } catch {
    /* the tool is already running; unref only stops us holding it */
  }
  if (pid === null) {
    throw pluginError("LAUNCH_FAILED", "the operating system did not start " + launch.spawnExecutable);
  }
  if (child && typeof child.on === "function") {
    child.on("error", (error) => {
      void reportFailure(launch.id, launch.spawnExecutable, error);
    });
  }
  return {
    id: launch.id,
    executable: launch.spawnExecutable,
    argv: launch.spawnArgv,
    consoleHost: launch.consoleHost,
    pid
  };
}

/** A late spawn failure (a deleted install, a refused elevation) is reported. */
async function reportFailure(toolId, executable, error) {
  const message = String((error && error.message) || error || "launch failed");
  console.error("[open-tools] launch failed " + toolId + " (" + executable + "): " + message);
  try {
    if (typeof pi !== "undefined" && pi && pi.ui && pi.ui.notify) {
      await pi.ui.notify({ title: "Open Tools", body: toolId + ": " + message });
    }
  } catch {
    /* the notification is best effort; the log line above is the record */
  }
}

async function currentLocale() {
  try {
    if (typeof pi !== "undefined" && pi && pi.app && pi.app.getLocale) {
      return String(await pi.app.getLocale()) || "en";
    }
  } catch {
    /* fall through to English */
  }
  return "en";
}

/** The open project's folder, resolved to an absolute path, or null. */
async function resolveProjectRoot() {
  if (typeof pi === "undefined" || !pi || !pi.workspace) return null;
  const info = await pi.workspace.get();
  const raw = typeof info === "string" ? info : info && info.path;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const resolved = path.resolve(raw.trim());
  return {
    path: resolved,
    name: (info && typeof info.name === "string" && info.name) || path.basename(resolved) || resolved
  };
}

function localizedLabel(label, locale) {
  const normalized = String(locale || "en").toLowerCase();
  if (normalized === "zh" || normalized.startsWith("zh-")) {
    return label["zh-CN"] || label.en;
  }
  return label.en || label["zh-CN"];
}

async function showToast(message) {
  try {
    if (typeof pi !== "undefined" && pi && pi.ui && pi.ui.showToast) {
      await pi.ui.showToast(message);
    }
  } catch {
    /* a toast is feedback, never a reason to fail the launch */
  }
}

/** Methods this plugin answers for `plugin.call`; the manifest lists the same. */
const HANDLERS = {
  async projectRoot() {
    const project = await resolveProjectRoot();
    if (!project) {
      return { ok: false, error: "NO_PROJECT", message: "no project folder is open" };
    }
    return { ok: true, root: project.path, name: project.name };
  },

  async listTools() {
    const project = await resolveProjectRoot();
    const locale = await currentLocale();
    const state = await loadToolConfig();
    const tools = state.tools.map((tool) => ({
      id: tool.id,
      label: localizedLabel(tool.label, locale),
      executableName: tool.executableName,
      builtin: tool.builtin
    }));
    const skipped = state.skipped.map((entry) => entry.reason);
    // The menu record the plugin log keeps: which tool ids this menu offered.
    console.log(
      "[open-tools] list " + tools.map((tool) => tool.id).join(",") + (skipped.length > 0 ? " skipped=" + skipped.length : "")
    );
    if (!project) {
      return {
        ok: false,
        error: "NO_PROJECT",
        message: "no project folder is open",
        locale,
        root: null,
        tools,
        skipped
      };
    }
    return { ok: true, locale, root: project.path, name: project.name, tools, skipped };
  },

  async toolConfig() {
    const project = await resolveProjectRoot();
    const locale = await currentLocale();
    const state = await loadToolConfig();
    return configPayload(state, locale, project, await configFilePath());
  },

  async saveToolConfig(args) {
    const entries = args && Array.isArray(args.entries) ? args.entries : null;
    if (!entries) {
      return { ok: false, error: "INVALID_CONFIG", message: "entries must be an array of tool objects" };
    }
    if (entries.length > MAX_TOOLS) {
      return { ok: false, error: "INVALID_CONFIG", message: "at most " + MAX_TOOLS + " tools can be configured" };
    }
    const normalized = normalizeToolEntries(entries, makeContext().platform);
    if (normalized.skipped.length > 0) {
      return {
        ok: false,
        error: "INVALID_CONFIG",
        message: normalized.skipped[0].reason,
        issues: normalized.skipped.map((entry) => entry.reason)
      };
    }
    const stored = normalized.entries.map(storedToolEntry);
    let file;
    try {
      file = await writeConfigDocument(stored);
    } catch (error) {
      const message = messageOf(error);
      console.error("[open-tools] could not save the tool list: " + message);
      return { ok: false, error: "SAVE_FAILED", message };
    }
    storedToolSetting = stored;
    resetDetectionCache();
    const state = await loadToolConfig();
    console.log(
      "[open-tools] saved " + stored.length + " tool(s) to " + file + ": " + stored.map((entry) => entry.id).join(",")
    );
    return configPayload(state, await currentLocale(), await resolveProjectRoot(), file);
  },

  async resetToolConfig() {
    let file;
    try {
      file = await writeConfigDocument(null);
    } catch (error) {
      const message = messageOf(error);
      console.error("[open-tools] could not reset the tool list: " + message);
      return { ok: false, error: "SAVE_FAILED", message };
    }
    storedToolSetting = null;
    resetDetectionCache();
    const state = await loadToolConfig();
    console.log("[open-tools] tool list reset to the built-in defaults (" + file + ")");
    return configPayload(state, await currentLocale(), await resolveProjectRoot(), file);
  },

  async openTool(args) {
    const id = args && typeof args.id === "string" ? args.id.trim() : "";
    const state = await loadToolConfig();
    const entry = state.entries.find((candidate) => candidate.id === id);
    if (!entry) {
      return { ok: false, error: "UNKNOWN_TOOL", message: "unknown tool: " + (id || "(empty)") };
    }
    if (!entry.enabled) {
      return { ok: false, error: "TOOL_DISABLED", message: id + " is turned off in the tool settings" };
    }
    if (entry.status !== "ready") {
      return { ok: false, error: "TOOL_NOT_READY", message: id + ": " + (entry.reason || "not available on this machine") };
    }
    const project = await resolveProjectRoot();
    if (!project) {
      return { ok: false, error: "NO_PROJECT", message: "no project folder is open" };
    }
    if (!isDirectory(project.path, makeContext().fileSystem)) {
      return {
        ok: false,
        error: "PROJECT_MISSING",
        message: "the project folder no longer exists: " + project.path
      };
    }
    let launched;
    try {
      launched = launchTool(id, project.path);
    } catch (error) {
      const message = String((error && error.message) || error);
      console.error("[open-tools] launch failed " + id + " " + project.path + ": " + message);
      await reportFailure(id, "", error);
      return { ok: false, error: (error && error.code) || "LAUNCH_FAILED", message };
    }
    // The launch record the plugin log keeps: tool id + resolved project root.
    console.log("[open-tools] launch " + id + " " + project.path + " pid=" + launched.pid);
    await showToast("Open Tools: " + id + " → " + project.path);
    return { ok: true, id, root: project.path, executable: launched.executable, pid: launched.pid };
  }
};

function supportedMethods() {
  return Object.keys(HANDLERS);
}

async function onRendererCall(method, args) {
  const name = String(method || "");
  if (!Object.prototype.hasOwnProperty.call(HANDLERS, name)) {
    console.warn("[open-tools] refused renderer call: " + (name || "(empty)"));
    return { ok: false, error: "UNKNOWN_METHOD", message: "method not declared: " + (name || "(empty)") };
  }
  try {
    return await HANDLERS[name](args && typeof args === "object" ? args : {});
  } catch (error) {
    const message = String((error && error.message) || error);
    console.error("[open-tools] " + name + " failed: " + message);
    return { ok: false, error: "HANDLER_FAILED", message };
  }
}

async function onLoad() {
  storedToolSetting = null;
  resetDetectionCache();
  setLaunchOverrides(null);
  console.log("[open-tools] loaded " + PLUGIN_VERSION + " (" + PLUGIN_ID + ")");
}

async function onUnload() {
  storedToolSetting = null;
  resetDetectionCache();
  setLaunchOverrides(null);
  console.log("[open-tools] unloaded");
}

module.exports = {
  onLoad,
  onUnload,
  onRendererCall,
  /** Test surface: what the offline self-test and the smoke script assert. */
  __internals: {
    PLUGIN_ID,
    PLUGIN_VERSION,
    CONFIG_FILE,
    CONFIG_VERSION,
    SETTING_TOOLS,
    LEGACY_SETTING_CUSTOM_TOOLS,
    DIR_PLACEHOLDER,
    MAX_TOOLS,
    TOOLS,
    TOOL_TABLES,
    WINDOWS_TOOLS,
    MACOS_TOOLS,
    LINUX_TOOLS,
    PLATFORMS,
    PLATFORM_WINDOWS,
    PLATFORM_MACOS,
    PLATFORM_LINUX,
    HOST_PLATFORM,
    normalizePlatform,
    toolTable,
    toolById,
    builtinIds,
    consoleHostIds,
    defaultToolEntries,
    builtinDefaults,
    normalizeToolEntry,
    normalizeToolEntries,
    storedToolEntry,
    entryArgv,
    variantArgv,
    resolveToolEntries,
    resolveConfiguredTools,
    detectTools,
    toolEntries,
    resetDetectionCache,
    locateTool,
    resolveExecutable,
    buildLaunch,
    buildChildEnvironment,
    buildPosixEnvironment,
    defaultEnvironment,
    launchTool,
    loadToolConfig,
    configFilePath,
    readConfigDocument,
    writeConfigDocument,
    configPayload,
    resolveProjectRoot,
    supportedMethods,
    setLaunchOverrides,
    HANDLERS
  }
};

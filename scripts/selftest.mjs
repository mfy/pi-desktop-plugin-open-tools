#!/usr/bin/env node
/**
 * Offline self-test for mfy.pi-desktop-open-tools. No host, no window, no network:
 * a stub `pi` stands in for the plugin host and a stub `react` for the import
 * map, so the real sources are exercised as they are.
 *
 * Covered:
 *   1. manifest ↔ main.js: the declared `plugin.call` methods are exactly the
 *      handlers, and the renderer whitelists stay inside the host's set;
 *   2. main.js lifecycle under a stub host;
 *   3. tool detection, real and against an injected fake file system;
 *   4. every tool's argv: the project folder in exactly one element, the last
 *      one for all but Git Bash (whose launcher only understands `--cd=`),
 *      `shell: false`, no string-built command line, deterministic;
 *   5. the child environment: `buildLaunch` hands the launched tool the
 *      standard Windows variables the host strips from the plugin process, and
 *      a bare inherited environment is completed only from folders that exist;
 *   6. custom tools from the `customTools` setting: one well-formed entry is
 *      accepted and launched with "{dir}" as a whole argv element, and every
 *      malformed one (relative or missing executable, no "{dir}", "{dir}"
 *      glued into another element, a built-in or duplicate id, an unknown
 *      console host) is skipped with a reason instead of launched;
 *   7. `onRendererCall`: declared methods answer, undeclared ones are refused
 *      without spawning, a tool that is not installed is a named error rather
 *      than a crash;
 *   8. the renderer module registers exactly one composerControl slot under a
 *      stub `pi`, dispatches only `plugin.call`, only declared methods, and
 *      disposes its stylesheet on unload.
 *
 * Exit code 0 means every assertion passed.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const manifest = JSON.parse(readFileSync(join(pluginRoot, "manifest.json"), "utf8"));
const main = require(join(pluginRoot, "main.js"));
const internals = main.__internals;

const REQUIRED_TOOLS = ["vscode", "explorer", "cmd", "pwsh", "powershell", "gitbash"];

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition), detail: detail === undefined ? "" : String(detail) });
  return Boolean(condition);
}

// --------------------------------------------------------------------- helpers
function stubPi(options) {
  const settings = options || {};
  const record = {
    toasts: [],
    notices: [],
    dispatches: [],
    slots: [],
    styles: [],
    styleDisposed: 0,
    slotDisposed: 0,
    settingsReads: 0,
    settingsWrites: [],
    dataPathReads: 0,
    layers: []
  };
  const pi = {
    app: { getLocale: async () => settings.locale || "zh-CN" },
    workspace: {
      get: async () =>
        settings.workspacePath ? { path: settings.workspacePath, name: "pi-plugin-open-tools" } : null
    },
    plugin: {
      getSettings: async () => {
        record.settingsReads += 1;
        return { ...(settings.pluginSettings || {}) };
      },
      setSettings: async (partial) => {
        record.settingsWrites.push(partial);
        settings.pluginSettings = { ...(settings.pluginSettings || {}), ...partial };
        return settings.pluginSettings;
      },
      getDataPath: async () => {
        record.dataPathReads += 1;
        return settings.dataPath || null;
      }
    },
    ui: {
      showToast: async (message) => {
        record.toasts.push(String(message));
      },
      notify: async (input) => {
        record.notices.push(input);
      },
      injectStyle: (css) => {
        record.styles.push(css);
        return () => {
          record.styleDisposed += 1;
        };
      },
      openLayer: () => {
        const element = {
          appended: 0,
          cleared: 0,
          appendChild() {
            this.appended += 1;
          },
          get textContent() {
            return "";
          },
          set textContent(_value) {
            this.cleared += 1;
          }
        };
        const layer = {
          element,
          closed: false,
          close() {
            this.closed = true;
          }
        };
        record.layers.push(layer);
        return layer;
      }
    },
    slots: {
      register: (entry) => {
        record.slots.push(entry);
        return () => {
          record.slotDisposed += 1;
        };
      }
    },
    dispatch: async (action, payload) => {
      record.dispatches.push({ action, payload });
      const answers = settings.answers || {};
      const key = payload && typeof payload.method === "string" ? payload.method : String(action);
      if (Object.prototype.hasOwnProperty.call(answers, key)) return answers[key];
      return { ok: true };
    }
  };
  return { pi, record };
}

function fakeFileSystem(files, directories) {
  // Paths are compared with one separator and one case, so the same stub works
  // for the Windows table (backslashes) and the macOS/Linux ones (slashes),
  // whichever host runs this test.
  const normalize = (entry) => String(entry).toLowerCase().replace(/\\/g, "/");
  const fileSet = new Set((files || []).map(normalize));
  const directorySet = new Set((directories || []).map(normalize));
  return {
    statSync(target) {
      const key = normalize(target);
      if (fileSet.has(key)) return { isFile: () => true, isDirectory: () => false };
      if (directorySet.has(key)) return { isFile: () => false, isDirectory: () => true };
      const error = new Error("ENOENT: no such file or directory, stat '" + target + "'");
      error.code = "ENOENT";
      throw error;
    }
  };
}

function captureConsole() {
  const entries = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const push = (level) => {
    return (...args) => {
      entries.push({ level, text: args.map((value) => (typeof value === "string" ? value : String(value))).join(" ") });
    };
  };
  console.log = push("log");
  console.warn = push("warn");
  console.error = push("error");
  return {
    entries,
    texts: (level) => entries.filter((entry) => !level || entry.level === level).map((entry) => entry.text),
    restore: () => {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    }
  };
}

function resolvedRoot() {
  return resolve(pluginRoot);
}

// ----------------------------------------------------------------------------
// 1. manifest ↔ handlers ↔ renderer whitelists
// ----------------------------------------------------------------------------
{
  const declared = [...(manifest.rendererCallMethods || [])].sort();
  const handled = [...internals.supportedMethods()].sort();
  check(
    "manifest.rendererCallMethods is exactly the set of methods onRendererCall handles",
    JSON.stringify(declared) === JSON.stringify(handled),
    "declared " + JSON.stringify(declared) + " vs handled " + JSON.stringify(handled)
  );
  check("rendererActions declares plugin.call", (manifest.rendererActions || []).includes("plugin.call"));
  check(
    "rendererActions stays inside what the host allows",
    (manifest.rendererActions || []).every((action) => action === "plugin.call")
  );
  check("manifest declares the renderer module", manifest.renderer === "renderer/index.mjs");
  check(
    "the plugin id is the one the sources use",
    internals.PLUGIN_ID === manifest.id && internals.PLUGIN_VERSION === manifest.version,
    internals.PLUGIN_ID + "@" + internals.PLUGIN_VERSION
  );
  check("the tool table has the eight documented tools", internals.TOOLS.length === 8, internals.TOOLS.map((tool) => tool.id).join(", "));
}

// ----------------------------------------------------------------------------
// 2. lifecycle under a stub host
// ----------------------------------------------------------------------------
{
  internals.setLaunchOverrides(null);
  const { pi } = stubPi({ workspacePath: pluginRoot });
  globalThis.pi = pi;
  const captured = captureConsole();
  let error = null;
  try {
    await main.onLoad();
  } catch (thrown) {
    error = thrown;
  }
  const logs = captured.texts("log");
  captured.restore();
  check("onLoad() finishes without throwing", error === null, error && error.message);
  check(
    "onLoad() logs the plugin id and version",
    logs.some((line) => line.includes("[open-tools] loaded") && line.includes(manifest.id) && line.includes(manifest.version)),
    logs.join(" | ")
  );
}

// ----------------------------------------------------------------------------
// 3. detection: real machine plus an injected fake file system
// ----------------------------------------------------------------------------
{
  internals.setLaunchOverrides(null);
  internals.resetDetectionCache();
  const detected = internals.detectTools();
  const ids = detected.map((tool) => tool.id);
  for (const tool of REQUIRED_TOOLS) {
    check(`detection finds "${tool}" on this machine`, ids.includes(tool), ids.join(", "));
  }
  for (const tool of detected) {
    check(`detected tool "${tool.id}" reports a real executable file`, typeof tool.executable === "string" && tool.executable.length > 0, tool.executable);
  }

  internals.resetDetectionCache();
  const fakeEnv = {
    PATH: "C:\\fake\\bin",
    SystemRoot: "C:\\Windows",
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local"
  };
  const onlyCmd = internals.detectTools({
    env: fakeEnv,
    fileSystem: fakeFileSystem(["C:\\fake\\bin\\cmd.exe"])
  });
  check(
    "a shell without its console host is not offered: C:\\fake\\bin\\cmd.exe alone yields nothing",
    onlyCmd.length === 0,
    onlyCmd.map((tool) => tool.id).join(", ")
  );

  internals.resetDetectionCache();
  const cmdWithHost = internals.detectTools({
    env: fakeEnv,
    fileSystem: fakeFileSystem(["C:\\fake\\bin\\cmd.exe", "C:\\fake\\bin\\wt.exe"])
  });
  check(
    "the same shell is offered once its console host is there (cmd + wt)",
    JSON.stringify(cmdWithHost.map((tool) => tool.id)) === JSON.stringify(["cmd", "wt"]),
    cmdWithHost.map((tool) => tool.id).join(", ")
  );

  internals.resetDetectionCache();
  const fakeOnly = internals.detectTools({
    env: fakeEnv,
    fileSystem: fakeFileSystem(["C:\\fake\\bin\\FakeTool.exe", "C:\\fake\\bin\\another-thing.exe"])
  });
  check(
    "an injected fake directory adds no entry to the list",
    fakeOnly.length === 0,
    fakeOnly.map((tool) => tool.id).join(", ")
  );

  // The plugin process only sees PATH/SystemRoot/windir/TEMP/TMP/TMPDIR/LANG/
  // HOME/USER/USERPROFILE — no LOCALAPPDATA, no ProgramFiles. VS Code lives under
  // %LOCALAPPDATA%, so without completing the environment here it was never
  // detected and never appeared in the menu at all.
  internals.resetDetectionCache();
  const strippedHost = {
    PATH: String.raw`C:\Windows\System32`,
    SystemRoot: String.raw`C:\Windows`,
    windir: String.raw`C:\Windows`,
    TEMP: String.raw`C:\Users\tester\AppData\Local\Temp`,
    TMP: String.raw`C:\Users\tester\AppData\Local\Temp`,
    TMPDIR: String.raw`C:\Users\tester\AppData\Local\Temp`,
    LANG: "zh_CN.UTF-8",
    HOME: String.raw`C:\Users\tester`,
    USER: "tester",
    USERPROFILE: String.raw`C:\Users\tester`
  };
  const codeExe = String.raw`C:\Users\tester\AppData\Local\Programs\Microsoft VS Code\Code.exe`;
  const fromStrippedHost = internals.detectTools({
    env: strippedHost,
    fileSystem: fakeFileSystem(
      [codeExe],
      [
        String.raw`C:\Windows`,
        String.raw`C:\Windows\System32`,
        String.raw`C:\Users\tester\AppData\Local`,
        String.raw`C:\Users\tester\AppData\Roaming`
      ]
    )
  });
  check(
    "VS Code is found from the stripped host environment (its path is derived from %USERPROFILE%)",
    fromStrippedHost.some((tool) => tool.id === "vscode" && tool.executable === codeExe),
    fromStrippedHost.map((tool) => tool.id + "=" + tool.executable).join(", ")
  );
  check(
    "the plugin's own environment is complete even though the host strips it",
    typeof internals.defaultEnvironment().LOCALAPPDATA === "string" && internals.defaultEnvironment().LOCALAPPDATA.length > 0,
    internals.defaultEnvironment().LOCALAPPDATA
  );
  internals.resetDetectionCache();
}

// ----------------------------------------------------------------------------
// 4. argv for every tool
// ----------------------------------------------------------------------------
{
  internals.setLaunchOverrides(null);
  const root = resolvedRoot();
  const spaced = join(root, "a folder with spaces & symbols");
  for (const tool of internals.TOOLS) {
    const first = internals.variantArgv(tool, 0, root);
    const second = internals.variantArgv(tool, 0, root);
    check(`${tool.id}: argv is an array of strings`, Array.isArray(first) && first.every((entry) => typeof entry === "string"));
    check(`${tool.id}: argv is deterministic across calls`, JSON.stringify(first) === JSON.stringify(second), JSON.stringify(first));
    const carriers = first.filter((entry) => entry.includes(root));
    check(`${tool.id}: the project folder travels in exactly one argv element`, carriers.length === 1, JSON.stringify(first));
    const argvTarget = first[first.length - 1] === root ? "last" : first.some((entry) => entry.endsWith("=" + root)) ? "option" : "none";
    if (argvTarget === "option") {
      check(
        `${tool.id}: the folder is the tail of the last element (only form git-bash.exe accepts)`,
        first[first.length - 1] === "--cd=" + root,
        JSON.stringify(first)
      );
    } else {
      check(`${tool.id}: the last argv element is the resolved project folder`, first[first.length - 1] === root, JSON.stringify(first));
    }
    const spacedArgv = internals.variantArgv(tool, 0, spaced);
    check(
      `${tool.id}: a folder with spaces is passed through unquoted, unmangled`,
      spacedArgv.some((entry) => entry.includes(spaced)),
      JSON.stringify(spacedArgv)
    );
    const shellish = first.filter((entry) => entry !== root && !entry.startsWith("--cd=") && /[&|<>]/.test(entry));
    check(`${tool.id}: no argv element carries shell control characters`, shellish.length === 0, JSON.stringify(shellish));
  }

  for (const tool of internals.detectTools()) {
    const launch = internals.buildLaunch(tool.id, root);
    check(`${tool.id}: buildLaunch resolves an absolute executable path`, isAbsolute(launch.executable), launch.executable);
    check(`${tool.id}: buildLaunch uses shell: false`, launch.options.shell === false, JSON.stringify(launch.options));
    check(`${tool.id}: buildLaunch opens in the project folder`, launch.options.cwd === root, launch.options.cwd);
    check(`${tool.id}: buildLaunch detaches the tool from the plugin process`, launch.options.detached === true);
    check(`${tool.id}: buildLaunch ignores stdio`, launch.options.stdio === "ignore");
    check(
      `${tool.id}: the launched command line carries the project folder in exactly one element`,
      launch.dirIndex >= 0 && launch.spawnArgv.filter((entry) => entry.includes(root)).length === 1,
      JSON.stringify(launch.spawnArgv)
    );
    if (launch.consoleHost) {
      check(
        `${tool.id}: a console window comes from its console host (${launch.consoleHost})`,
        join(launch.spawnExecutable).toLowerCase().endsWith("wt.exe"),
        launch.spawnExecutable
      );
      check(
        `${tool.id}: the console host is handed the shell executable as its first argument`,
        launch.spawnArgv[0] === launch.executable,
        JSON.stringify(launch.spawnArgv)
      );
      check(
        `${tool.id}: the console host adds no argv element of its own`,
        JSON.stringify(launch.spawnArgv.slice(1)) === JSON.stringify(launch.argv),
        JSON.stringify(launch.spawnArgv)
      );
    } else {
      check(
        `${tool.id}: a tool without a console host is started directly`,
        launch.spawnExecutable === launch.executable && JSON.stringify(launch.spawnArgv) === JSON.stringify(launch.argv),
        launch.spawnExecutable
      );
    }
  }

  const spacedLaunch = internals.buildLaunch("cmd", spaced);
  check(
    "cmd: a folder with spaces arrives as one argv element, not a concatenated command line",
    spacedLaunch.argv[spacedLaunch.argv.length - 1] === spaced,
    JSON.stringify(spacedLaunch.argv)
  );
}

// ----------------------------------------------------------------------------
// 5. the environment a launched tool is given
// ----------------------------------------------------------------------------
{
  internals.setLaunchOverrides(null);
  internals.resetDetectionCache();

  const launch = internals.buildLaunch(REQUIRED_TOOLS[0], resolvedRoot());
  const env = launch.options.env || {};
  check("buildLaunch hands the child an environment of its own", Object.keys(env).length > 10, String(Object.keys(env).length));
  for (const key of ["USERPROFILE", "LOCALAPPDATA", "APPDATA", "SystemRoot", "PATH", "ComSpec", "PATHEXT", "USERNAME"]) {
    check(
      `the launched tool gets ${key} (the host strips it from the plugin process)`,
      typeof env[key] === "string" && env[key].trim().length > 0,
      String(env[key])
    );
  }
  check(
    "the child PATH still reaches the Windows folder",
    String(env.PATH || "").toLowerCase().includes("\\windows"),
    env.PATH
  );
  check(
    "no empty value is left in the child environment",
    Object.values(env).every((value) => typeof value === "string" && value.length > 0),
    JSON.stringify(Object.entries(env).filter(([, value]) => !value))
  );

  // The plugin process is started with a deliberately small environment; these
  // nine keys are what it really sees (INHERITED_ENV_KEYS in the host).
  const PROFILE = String.raw`C:\Users\tester`;
  const LOCAL = String.raw`C:\Users\tester\AppData\Local`;
  const ROAMING = String.raw`C:\Users\tester\AppData\Roaming`;
  const stripped = {
    PATH: String.raw`C:\Windows\System32`,
    SystemRoot: String.raw`C:\Windows`,
    windir: String.raw`C:\Windows`,
    TEMP: String.raw`C:\Users\tester\AppData\Local\Temp`,
    TMP: String.raw`C:\Users\tester\AppData\Local\Temp`,
    TMPDIR: String.raw`C:\Users\tester\AppData\Local\Temp`,
    LANG: "zh_CN.UTF-8",
    HOME: PROFILE,
    USER: "tester",
    USERPROFILE: PROFILE,
    ELECTRON_RUN_AS_NODE: "1",
    ELECTRON_NO_ATTACH_CONSOLE: "1",
    PI_PLUGIN_ID: manifest.id,
    NODE_ENV: "production"
  };
  const probedFs = fakeFileSystem(
    [String.raw`C:\Windows\System32\cmd.exe`],
    [
      String.raw`C:\Windows`,
      String.raw`C:\Windows\System32`,
      String.raw`C:\Windows\System32\Wbem`,
      LOCAL,
      ROAMING
    ]
  );
  const completed = internals.buildChildEnvironment(stripped, probedFs);
  check(
    "a stripped host environment is completed with LOCALAPPDATA (Windows Terminal cannot find its settings without it)",
    completed.LOCALAPPDATA === LOCAL,
    String(completed.LOCALAPPDATA)
  );
  check("a stripped host environment is completed with APPDATA", completed.APPDATA === ROAMING, String(completed.APPDATA));
  check(
    "completing the environment keeps what the host did pass (SystemRoot, LANG)",
    completed.SystemRoot === String.raw`C:\Windows` && completed.LANG === "zh_CN.UTF-8",
    JSON.stringify([completed.SystemRoot, completed.LANG])
  );
  check(
    "a stripped environment gains a ComSpec that exists on disk",
    completed.ComSpec === String.raw`C:\Windows\System32\cmd.exe`,
    String(completed.ComSpec)
  );
  check("a stripped environment gains PATHEXT", String(completed.PATHEXT || "").startsWith(".COM"), String(completed.PATHEXT));
  check("a stripped environment gains USERNAME", typeof completed.USERNAME === "string" && completed.USERNAME.length > 0, String(completed.USERNAME));
  check("a stripped environment gains a numeric NUMBER_OF_PROCESSORS", /^\d+$/.test(String(completed.NUMBER_OF_PROCESSORS || "")), String(completed.NUMBER_OF_PROCESSORS));
  check(
    "the child never inherits ELECTRON_RUN_AS_NODE (it would start VS Code as Node and no window would appear)",
    completed.ELECTRON_RUN_AS_NODE === undefined && completed.ELECTRON_NO_ATTACH_CONSOLE === undefined,
    String(completed.ELECTRON_RUN_AS_NODE)
  );
  check(
    "the child never inherits the host's own markers (PI_PLUGIN_ID, NODE_ENV)",
    completed.PI_PLUGIN_ID === undefined && completed.NODE_ENV === undefined,
    JSON.stringify([completed.PI_PLUGIN_ID, completed.NODE_ENV])
  );
  check(
    "the launched tool's environment drops ELECTRON_RUN_AS_NODE too",
    (launch.options.env || {}).ELECTRON_RUN_AS_NODE === undefined,
    String((launch.options.env || {}).ELECTRON_RUN_AS_NODE)
  );
  check(
    "nothing is invented for a folder that is not on disk",
    internals.buildChildEnvironment({ USERPROFILE: PROFILE, SystemRoot: String.raw`C:\Windows` }, fakeFileSystem([], [String.raw`C:\Windows`])).LOCALAPPDATA === undefined
  );
}

// ----------------------------------------------------------------------------
// 6. the menu is a setting: order, enable/disable, edits, custom tools
// ----------------------------------------------------------------------------
{
  const root = resolvedRoot();
  const PROFILE = String.raw`C:\Users\tester`;
  const LOCAL = String.raw`C:\Users\tester\AppData\Local`;
  const CODE = String.raw`C:\Users\tester\AppData\Local\Programs\Microsoft VS Code\Code.exe`;
  const WSL = String.raw`C:\Windows\System32\wsl.exe`;
  const EXPLORER = String.raw`C:\Windows\explorer.exe`;
  const CMD = String.raw`C:\Windows\System32\cmd.exe`;
  const WT = String.raw`C:\fake\bin\wt.exe`;
  const CUSTOM_EXE = String.raw`C:\Custom Tools\editor.exe`;
  const env = {
    PATH: String.raw`C:\fake\bin`,
    SystemRoot: String.raw`C:\Windows`,
    USERPROFILE: PROFILE,
    LOCALAPPDATA: LOCAL
  };
  const toolFs = fakeFileSystem(
    [CODE, WSL, EXPLORER, CMD, WT, CUSTOM_EXE],
    [
      root,
      String.raw`C:\Windows`,
      String.raw`C:\Windows\System32`,
      LOCAL,
      String.raw`C:\Users\tester\AppData\Roaming`
    ]
  );
  const context = { env, fileSystem: toolFs };

  check(
    "the default tool list is the built-in eight, in table order",
    JSON.stringify(internals.defaultToolEntries().map((entry) => entry.id)) ===
      JSON.stringify(internals.TOOLS.map((tool) => tool.id))
  );
  check(
    "the built-in defaults are offered back to the settings UI with their labels",
    internals.builtinDefaults("zh-CN").some((builtin) => builtin.id === "explorer" && builtin.label === "资源管理器"),
    JSON.stringify(internals.builtinDefaults("zh-CN").slice(0, 2))
  );

  const listed = internals.resolveToolEntries(
    [{ id: "wsl" }, { id: "vscode" }, { id: "explorer", enabled: false }],
    context
  );
  check(
    "the order in the setting is the order in the menu",
    JSON.stringify(listed.entries.map((entry) => entry.id)) === JSON.stringify(["wsl", "vscode", "explorer"]),
    listed.entries.map((entry) => entry.id).join(",")
  );
  check(
    "an entry that is turned off keeps its place but is marked disabled",
    listed.entries[2].status === "disabled" && listed.entries[2].enabled === false,
    JSON.stringify(listed.entries.map((entry) => entry.id + "=" + entry.status))
  );
  check(
    "the two entries that are on are ready",
    listed.entries[0].status === "ready" && listed.entries[1].status === "ready",
    JSON.stringify(listed.entries.map((entry) => entry.id + "=" + entry.status))
  );

  const renamed = internals.resolveToolEntries([{ id: "vscode", label: "My Editor" }], context);
  check(
    "a built-in can be renamed",
    renamed.entries[0].label.en === "My Editor" && renamed.entries[0].label["zh-CN"] === "My Editor",
    JSON.stringify(renamed.entries[0].label)
  );
  check(
    "a renamed built-in is still the built-in (detection still applies)",
    renamed.entries[0].builtin === true && renamed.entries[0].executable === CODE,
    renamed.entries[0].executable
  );

  const withExecutable = internals.resolveToolEntries(
    [{ id: "vscode", executable: String.raw`D:\Portable\Code.exe` }],
    context
  );
  check(
    "an executable override that is not on disk is reported, not used",
    withExecutable.entries[0].status === "missing" && /not there/.test(String(withExecutable.entries[0].reason)),
    withExecutable.entries[0].reason
  );
  const override = internals.resolveToolEntries([{ id: "vscode", executable: CUSTOM_EXE }], context);
  check(
    "an executable override that exists replaces the detected one",
    override.entries[0].executable === CUSTOM_EXE && override.entries[0].status === "ready",
    override.entries[0].executable
  );

  const consoleHost = internals.resolveToolEntries([{ id: "cmd" }], context);
  check(
    "a shell keeps the console host it needs",
    consoleHost.entries[0].consoleHost === "wt" && consoleHost.entries[0].status === "ready",
    JSON.stringify([consoleHost.entries[0].consoleHost, consoleHost.entries[0].status])
  );
  const withoutHost = internals.resolveToolEntries([{ id: "cmd" }], {
    env,
    fileSystem: fakeFileSystem([CMD], [String.raw`C:\Windows`, String.raw`C:\Windows\System32`])
  });
  check(
    "a shell whose console host is missing is not offered",
    withoutHost.entries[0].status === "missing",
    withoutHost.entries[0].reason
  );

  const rejectionCases = [
    ["a relative executable", { id: "rel", executable: "editor.exe", args: ["{dir}"] }],
    ["a non-.exe executable", { id: "bat", executable: String.raw`C:\Custom Tools\start.bat`, args: ["{dir}"] }],
    ["args without {dir}", { id: "nodir", executable: CUSTOM_EXE, args: ["--open"] }],
    ["{dir} glued into another element", { id: "glued", executable: CUSTOM_EXE, args: ["--folder={dir}"] }],
    ["{dir} twice", { id: "twice", executable: CUSTOM_EXE, args: ["{dir}", "{dir}"] }],
    ["an id the host could not carry", { id: "Editor", executable: CUSTOM_EXE, args: ["{dir}"] }],
    ["an unknown console host", { id: "conhost", executable: CUSTOM_EXE, args: ["{dir}"], consoleHost: "conhost" }],
    ["args that are not strings", { id: "numargs", executable: CUSTOM_EXE, args: [1] }],
    ["args that are not an array", { id: "noargs", executable: CUSTOM_EXE, args: "{dir}" }],
    ["an enabled that is not a boolean", { id: "enabled", enabled: "yes" }],
    ["a label that is not a string", { id: "label", label: 7 }],
    ["a custom tool without an executable", { id: "noexe", args: ["{dir}"] }],
    ["a custom tool without args", { id: "noargs2", executable: CUSTOM_EXE }],
    ["an entry that is not an object", "editor"]
  ];
  for (const [name, entry] of rejectionCases) {
    const normalized = internals.normalizeToolEntries([entry]);
    check(
      `a tool entry with ${name} is rejected with a reason`,
      normalized.entries.length === 0 && normalized.skipped.length === 1 && typeof normalized.skipped[0].reason === "string",
      JSON.stringify(normalized)
    );
  }
  const duplicate = internals.normalizeToolEntries([
    { id: "editor", label: "First", executable: CUSTOM_EXE, args: ["{dir}"] },
    { id: "editor", label: "Second", executable: CUSTOM_EXE, args: ["{dir}"] }
  ]);
  check(
    "a duplicated id keeps the first entry and reports the second",
    duplicate.entries.length === 1 && duplicate.entries[0].label === "First" && duplicate.skipped.length === 1,
    JSON.stringify(duplicate.skipped)
  );
  check(
    "a value that is not an array is reported instead of crashing",
    internals.normalizeToolEntries({ id: "editor" }).skipped.length === 1
  );
  check(
    "a value pasted as a JSON string is parsed, not rejected",
    internals.normalizeToolEntries(JSON.stringify([{ id: "editor", executable: CUSTOM_EXE, args: ["{dir}"] }])).entries.length === 1
  );
  check(
    "a value that is broken JSON is reported, not thrown",
    internals.normalizeToolEntries("[{ not json").skipped.length === 1
  );
  check(
    "no setting means no entries and no complaint",
    internals.normalizeToolEntries(undefined).entries.length === 0 && internals.normalizeToolEntries(undefined).skipped.length === 0
  );

  // Saving goes through the handler, which validates and then writes the file
  // in the plugin's own data directory — never into the host plugin settings.
  {
    const dataPath = mkdtempSync(join(tmpdir(), "pi-open-tools-config-"));
    const configFile = join(dataPath, "tools.json");
    const stub = stubPi({ workspacePath: root, locale: "en", dataPath });
    globalThis.pi = stub.pi;
    const spawns = [];
    const fakeChild = { pid: 4242, unref() {}, on() {} };
    internals.setLaunchOverrides({
      env,
      fileSystem: toolFs,
      spawn: (executable, argv, options) => {
        spawns.push({ executable, argv, options });
        return fakeChild;
      }
    });
    const captured = captureConsole();
    try {
      const saved = await main.onRendererCall("saveToolConfig", {
        entries: [
          { id: "editor", label: "My Editor", executable: CUSTOM_EXE, args: ["--folder", "{dir}"] },
          { id: "vscode", enabled: false }
        ]
      });
      check("saveToolConfig answers ok", saved.ok === true, JSON.stringify(saved));
      const written = JSON.parse(readFileSync(configFile, "utf8"));
      check(
        "saveToolConfig writes the normalized list into tools.json",
        written.version === internals.CONFIG_VERSION &&
          JSON.stringify(written.tools.map((entry) => entry.id)) === JSON.stringify(["editor", "vscode"]),
        JSON.stringify(written)
      );
      check(
        "the list is not written into the host plugin settings",
        stub.record.settingsWrites.length === 0,
        JSON.stringify(stub.record.settingsWrites)
      );
      check(
        "the answer says where the list is stored",
        typeof saved.file === "string" && saved.file === configFile,
        String(saved.file)
      );
      check(
        "the saved list is what the settings UI is handed back",
        (saved.entries || []).length === 2 && saved.entries[0].status === "ready" && saved.entries[1].status === "disabled",
        JSON.stringify((saved.entries || []).map((entry) => entry.id + "=" + entry.status))
      );

      const menu = await main.onRendererCall("listTools", {});
      check(
        "the menu follows the saved list (the custom tool only)",
        JSON.stringify((menu.tools || []).map((tool) => tool.id)) === JSON.stringify(["editor"]),
        JSON.stringify((menu.tools || []).map((tool) => tool.id))
      );
      check(
        "listTools writes the offered tool ids to the log",
        captured.texts("log").some((line) => line.startsWith("[open-tools] list ") && line.includes("editor")),
        captured.texts("log").filter((line) => line.includes("[open-tools] list")).join(" | ")
      );

      const launch = internals.buildLaunch("editor", root);
      check("a custom tool launches the executable exactly as configured", launch.executable === CUSTOM_EXE, launch.executable);
      check(
        'a custom tool gets "{dir}" as one whole argv element, not glued into a string',
        JSON.stringify(launch.argv) === JSON.stringify(["--folder", root]),
        JSON.stringify(launch.argv)
      );
      check("a custom tool still launches without a shell", launch.options.shell === false);

      const opened = await main.onRendererCall("openTool", { id: "editor" });
      check("openTool launches a custom tool by id", opened.ok === true && opened.id === "editor", JSON.stringify(opened));
      check("the launch spawns exactly once", spawns.length === 1, String(spawns.length));
      check(
        "the launch passes the folder as its own argv element",
        spawns[0] && spawns[0].argv[1] === root && spawns[0].options.shell === false,
        spawns[0] && JSON.stringify(spawns[0].argv)
      );

      const disabled = await main.onRendererCall("openTool", { id: "vscode" });
      check(
        "a tool that is turned off is a named TOOL_DISABLED error",
        disabled.ok === false && disabled.error === "TOOL_DISABLED",
        JSON.stringify(disabled)
      );
      const unknown = await main.onRendererCall("openTool", { id: "not-a-tool" });
      check("an unknown id is a named UNKNOWN_TOOL error", unknown.ok === false && unknown.error === "UNKNOWN_TOOL");

      const before = readFileSync(configFile, "utf8");
      const badSave = await main.onRendererCall("saveToolConfig", { entries: [{ id: "editor" }] });
      check(
        "a save with an invalid entry is refused with the reason and writes nothing",
        badSave.ok === false && badSave.error === "INVALID_CONFIG" && readFileSync(configFile, "utf8") === before,
        JSON.stringify(badSave)
      );
      const notArray = await main.onRendererCall("saveToolConfig", { entries: "nope" });
      check("a save without an array is refused", notArray.ok === false && notArray.error === "INVALID_CONFIG");

      const reset = await main.onRendererCall("resetToolConfig", {});
      check("resetToolConfig answers ok", reset.ok === true, JSON.stringify(reset));
      check(
        "resetToolConfig writes null, which means the built-in defaults",
        JSON.parse(readFileSync(configFile, "utf8")).tools === null,
        readFileSync(configFile, "utf8")
      );
      check(
        "after a reset every built-in tool is back in the menu",
        (reset.entries || []).length === internals.TOOLS.length,
        String((reset.entries || []).length)
      );
    } finally {
      captured.restore();
      internals.setLaunchOverrides(null);
      internals.resetDetectionCache();
      rmSync(dataPath, { recursive: true, force: true });
    }
  }

  // A list an older version kept in the host settings is carried over, once.
  {
    const dataPath = mkdtempSync(join(tmpdir(), "pi-open-tools-legacy-"));
    const configFile = join(dataPath, "tools.json");
    const stub = stubPi({
      workspacePath: root,
      dataPath,
      pluginSettings: { customTools: [{ id: "legacy", label: "Legacy", executable: CUSTOM_EXE, args: ["{dir}"] }] }
    });
    globalThis.pi = stub.pi;
    internals.setLaunchOverrides({ env, fileSystem: toolFs });
    try {
      const state = await internals.loadToolConfig();
      check(
        "a legacy customTools entry is merged into the built-in defaults",
        state.entries.length === internals.TOOLS.length + 1 && state.entries[state.entries.length - 1].id === "legacy",
        JSON.stringify(state.entries.map((entry) => entry.id))
      );
      let carried = null;
      try {
        carried = JSON.parse(readFileSync(configFile, "utf8"));
      } catch {
        carried = null;
      }
      check(
        "the old list is carried over into tools.json",
        Boolean(carried) &&
          Array.isArray(carried.tools) &&
          carried.tools.length === internals.TOOLS.length + 1 &&
          carried.tools[carried.tools.length - 1].id === "legacy",
        JSON.stringify(carried)
      );
    } finally {
      internals.setLaunchOverrides(null);
      internals.resetDetectionCache();
      rmSync(dataPath, { recursive: true, force: true });
    }
  }

  // The plugin id changed: the list from the old data folder is carried over.
  {
    const sandbox = mkdtempSync(join(tmpdir(), "pi-open-tools-rename-"));
    const legacyDir = join(sandbox, "local.pi-open-tools");
    const dataPath = join(sandbox, internals.PLUGIN_ID);
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(
      join(legacyDir, "tools.json"),
      JSON.stringify({
        version: 1,
        tools: [
          { id: "explorer" },
          { id: "note", label: "Note", executable: CUSTOM_EXE, args: ["{dir}"] }
        ]
      }),
      "utf8"
    );
    const stub = stubPi({ workspacePath: root, locale: "en", dataPath });
    globalThis.pi = stub.pi;
    internals.setLaunchOverrides({ env, fileSystem: toolFs });
    try {
      const state = await internals.loadToolConfig();
      check(
        "the previous id's tool list is carried over to the new data folder",
        JSON.stringify(state.entries.map((entry) => entry.id)) === JSON.stringify(["explorer", "note"]),
        JSON.stringify(state.entries.map((entry) => entry.id))
      );
      let carried = null;
      try {
        carried = JSON.parse(readFileSync(join(dataPath, "tools.json"), "utf8"));
      } catch {
        carried = null;
      }
      check(
        "the carried list is written to the new data folder",
        Boolean(carried) && Array.isArray(carried.tools) && carried.tools.length === 2,
        JSON.stringify(carried)
      );
    } finally {
      internals.setLaunchOverrides(null);
      internals.resetDetectionCache();
      rmSync(sandbox, { recursive: true, force: true });
    }
  }

  // A hand-edited file that is not JSON is reported, not thrown.
  {
    const dataPath = mkdtempSync(join(tmpdir(), "pi-open-tools-broken-"));
    writeFileSync(join(dataPath, "tools.json"), "{ not json", "utf8");
    const stub = stubPi({ workspacePath: root, locale: "en", dataPath });
    globalThis.pi = stub.pi;
    internals.setLaunchOverrides({ env, fileSystem: toolFs });
    const captured = captureConsole();
    try {
      const direct = await internals.readConfigDocument();
      check(
        "readConfigDocument answers the error instead of throwing",
        typeof direct.error === "string" && direct.error.includes("JSON"),
        JSON.stringify(direct)
      );
      const state = await internals.loadToolConfig();
      check(
        "a broken tools.json is reported and the built-in defaults are used",
        state.entries.length === internals.TOOLS.length &&
          captured.texts("warn").some((line) => line.includes("tools.json")),
        JSON.stringify(state.entries.map((entry) => entry.id)) + " | " + captured.texts("warn").join(" | ")
      );
    } finally {
      captured.restore();
      internals.setLaunchOverrides(null);
      internals.resetDetectionCache();
      rmSync(dataPath, { recursive: true, force: true });
    }
  }
}
// ----------------------------------------------------------------------------
// 7. onRendererCall: whitelist, results, refusals
// ----------------------------------------------------------------------------
{
  const { pi, record } = stubPi({ workspacePath: pluginRoot, locale: "zh-CN" });
  globalThis.pi = pi;
  internals.setLaunchOverrides(null);
  internals.resetDetectionCache();

  const captured = captureConsole();
  let resultsList = [];
  try {
    const unknown = await main.onRendererCall("deleteEverything", { path: "C:\\" });
    check("an undeclared method is refused", unknown && unknown.ok === false && unknown.error === "UNKNOWN_METHOD", JSON.stringify(unknown));
    check(
      "refusing an undeclared method writes no launch record",
      captured.texts().every((line) => !line.includes("[open-tools] launch")),
      captured.texts().join(" | ")
    );

    const rootAnswer = await main.onRendererCall("projectRoot", {});
    check("projectRoot answers with the resolved project folder", rootAnswer.ok === true && rootAnswer.root === resolvedRoot(), JSON.stringify(rootAnswer));

    const listed = await main.onRendererCall("listTools", {});
    const listedIds = (listed.tools || []).map((tool) => tool.id);
    check("listTools answers with the root and the tools", listed.ok === true && listed.root === resolvedRoot(), JSON.stringify({ ok: listed.ok, root: listed.root }));
    check("listTools lists every detected tool", REQUIRED_TOOLS.every((id) => listedIds.includes(id)), listedIds.join(", "));
    check(
      "listTools localizes the labels for the host locale (zh-CN)",
      (listed.tools || []).some((tool) => tool.id === "explorer" && tool.label === "资源管理器"),
      JSON.stringify(listed.tools && listed.tools.find((tool) => tool.id === "explorer"))
    );

    const unknownTool = await main.onRendererCall("openTool", { id: "not-a-tool" });
    check("an unknown tool id is refused", unknownTool.ok === false && unknownTool.error === "UNKNOWN_TOOL", JSON.stringify(unknownTool));

    globalThis.pi = stubPi({ workspacePath: null }).pi;
    const noProject = await main.onRendererCall("openTool", { id: "cmd" });
    check("with no project open, openTool answers NO_PROJECT", noProject.ok === false && noProject.error === "NO_PROJECT", JSON.stringify(noProject));
    const noProjectList = await main.onRendererCall("listTools", {});
    check(
      "with no project open, listTools still lists tools but says why it cannot open",
      noProjectList.ok === false && noProjectList.error === "NO_PROJECT" && (noProjectList.tools || []).length > 0,
      JSON.stringify({ ok: noProjectList.ok, error: noProjectList.error, count: (noProjectList.tools || []).length })
    );

    globalThis.pi = stubPi({ workspacePath: join(pluginRoot, "folder-that-does-not-exist") }).pi;
    const missing = await main.onRendererCall("openTool", { id: "cmd" });
    check("a project folder that vanished is a named error", missing.ok === false && missing.error === "PROJECT_MISSING", JSON.stringify(missing));

    // A fake spawn: the handler runs end to end and no window opens.
    const calls = [];
    const fakeChild = {
      pid: 4242,
      unref() {},
      on() {}
    };
    internals.setLaunchOverrides({
      spawn: (executable, argv, options) => {
        calls.push({ executable, argv, options });
        return fakeChild;
      }
    });
    globalThis.pi = stubPi({ workspacePath: pluginRoot, locale: "en" }).pi;
    const spawned = await main.onRendererCall("openTool", { id: "cmd" });
    check("a declared method answers (openTool ok)", spawned.ok === true && spawned.id === "cmd", JSON.stringify(spawned));
    check("openTool spawns exactly once", calls.length === 1, String(calls.length));
    check("the spawn goes through no shell", calls[0] && calls[0].options.shell === false, JSON.stringify(calls[0] && calls[0].options));
    check(
      "cmd is opened by its console host, with the shell as the first argument",
      calls[0] &&
        join(calls[0].executable).toLowerCase().endsWith("wt.exe") &&
        join(calls[0].argv[0]).toLowerCase().endsWith("cmd.exe"),
      calls[0] && JSON.stringify([calls[0].executable, calls[0].argv[0]])
    );
    check(
      "the spawn passes the project folder as the last argv element",
      calls[0] && calls[0].argv[calls[0].argv.length - 1] === resolvedRoot(),
      calls[0] && JSON.stringify(calls[0].argv)
    );
    check("the spawn opens in the project folder", calls[0] && calls[0].options.cwd === resolvedRoot());
    check("the returned pid is the spawned one", spawned.pid === 4242, String(spawned.pid));
    check(
      "a successful launch writes the tool id and the resolved root to the log",
      captured.texts("log").some((line) => line.includes("[open-tools] launch cmd " + resolvedRoot())),
      captured.texts("log").filter((line) => line.includes("launch")).join(" | ")
    );

    // Nothing installed: a named error, not a crash.
    const spawnsBefore = calls.length;
    internals.setLaunchOverrides({
      env: { PATH: "C:\\nowhere", SystemRoot: "C:\\Windows", ProgramFiles: "", LOCALAPPDATA: "" },
      fileSystem: fakeFileSystem([], [resolvedRoot()]),
      spawn: (executable, argv, options) => {
        calls.push({ executable, argv, options });
        return fakeChild;
      }
    });
    internals.resetDetectionCache();
    const notInstalled = await main.onRendererCall("openTool", { id: "cmd" });
    check(
      "a tool that is not installed is a named TOOL_NOT_READY error",
      notInstalled.ok === false && notInstalled.error === "TOOL_NOT_READY",
      JSON.stringify(notInstalled)
    );
    check("a tool that is not installed spawns nothing", calls.length === spawnsBefore, String(calls.length - spawnsBefore));
    const emptyList = await main.onRendererCall("listTools", {});
    check(
      "with nothing installed, listTools answers an empty list instead of failing",
      emptyList.ok === true && (emptyList.tools || []).length === 0,
      JSON.stringify({ ok: emptyList.ok, count: (emptyList.tools || []).length })
    );

    // A shell without its console host: still a named error, still no spawn, and
    // it is not offered in the menu either.
    internals.setLaunchOverrides(null);
    internals.resetDetectionCache();
    const detectedForHost = internals.detectTools();
    const cmdEntry = detectedForHost.find((tool) => tool.id === "cmd");
    const wtEntry = detectedForHost.find((tool) => tool.id === "wt");
    if (cmdEntry && wtEntry) {
      let hostError = null;
      try {
        internals.buildLaunch("cmd", resolvedRoot(), {
          env: {},
          fileSystem: fakeFileSystem([cmdEntry.executable])
        });
      } catch (error) {
        hostError = error;
      }
      check(
        "cmd without Windows Terminal is a named CONSOLE_HOST_MISSING error, not a broken window",
        hostError && hostError.code === "CONSOLE_HOST_MISSING",
        hostError && String(hostError.message)
      );
      internals.resetDetectionCache();
      const withoutHost = internals.detectTools({
        env: {},
        fileSystem: fakeFileSystem([cmdEntry.executable])
      });
      check(
        "a shell whose console host is missing is not offered in the menu",
        !withoutHost.some((tool) => tool.id === "cmd"),
        withoutHost.map((tool) => tool.id).join(", ")
      );
      internals.resetDetectionCache();
    }

    internals.setLaunchOverrides(null);
    internals.resetDetectionCache();
    resultsList = [];
  } finally {
    captured.restore();
    internals.setLaunchOverrides(null);
    internals.resetDetectionCache();
  }
  check("no notification was needed for a successful launch", record.notices.length === 0, JSON.stringify(record.notices));
}

// ----------------------------------------------------------------------------
// 8. the renderer module under a stub host (and a stub react for the import map)
// ----------------------------------------------------------------------------
{
  const temp = mkdtempSync(join(tmpdir(), "pi-open-tools-selftest-"));
  try {
    cpSync(join(pluginRoot, "renderer", "index.mjs"), join(temp, "index.mjs"));
    mkdirSync(join(temp, "node_modules", "react"), { recursive: true });
    writeFileSync(
      join(temp, "node_modules", "react", "package.json"),
      JSON.stringify({ name: "react", version: "0.0.0-selftest", type: "module", main: "index.js" }, null, 2)
    );
    writeFileSync(
      join(temp, "node_modules", "react", "index.js"),
      [
        "const noop = () => {};",
        "export const createElement = (type, props, ...children) => ({ type, props: props || {}, children });",
        "export const Fragment = Symbol.for('react.fragment');",
        "export const useState = () => [undefined, noop];",
        "export const useRef = () => ({ current: null });",
        "export const useCallback = (fn) => fn;",
        "export const useEffect = noop;",
        "export default { createElement, Fragment, useState, useRef, useCallback, useEffect };",
        ""
      ].join("\n")
    );

    globalThis.document = {
      documentElement: { getAttribute: () => "zh-CN" },
      activeElement: null,
      addEventListener() {},
      removeEventListener() {},
      createTextNode(value) {
        return { nodeType: 3, textContent: String(value) };
      },
      createElement() {
        return {
          style: {},
          dataset: {},
          setAttribute() {},
          appendChild() {},
          addEventListener() {},
          contains() {
            return false;
          },
          focus() {},
          getBoundingClientRect() {
            return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
          }
        };
      }
    };
    try {
      globalThis.window = globalThis.window || { innerWidth: 1280, innerHeight: 900 };
    } catch {
      /* the host window is not redefinable; the module only reads two numbers */
    }

    const { pi, record } = stubPi({ workspacePath: pluginRoot, locale: "en" });
    const renderer = await import(pathToFileURL(join(temp, "index.mjs")).href);

    check("the renderer module exports onLoad", typeof renderer.onLoad === "function");
    check("the renderer module exports onUnload", typeof renderer.onUnload === "function");

    renderer.onLoad(pi);
    check("onLoad() registers exactly one slot", record.slots.length === 1, String(record.slots.length));
    const slot = record.slots[0] || {};
    check("the registered slot is composerControl", slot.slot === "composerControl", String(slot.slot));
    check(
      "the slot asks for a composer position",
      Array.isArray(slot.positions) && slot.positions.length > 0 && slot.positions.every((side) => side === "left" || side === "right"),
      JSON.stringify(slot.positions)
    );
    check("the slot carries a component function", typeof slot.component === "function");
    check("onLoad() injects exactly one stylesheet", record.styles.length === 1, String(record.styles.length));
    check(
      "the stylesheet is scoped by class names the components use",
      record.styles.length === 1 && record.styles[0].includes(".ot-btn") && record.styles[0].includes(".ot-menu")
    );

    const text = renderer.__test.TEXT;
    check(
      "both locales cover the same message keys",
      JSON.stringify(Object.keys(text.en).sort()) === JSON.stringify(Object.keys(text["zh-CN"]).sort())
    );
    check("languageFor maps a zh locale to zh-CN", renderer.__test.languageFor("zh-Hans-CN") === "zh-CN");
    check("languageFor maps en to en", renderer.__test.languageFor("en-US") === "en");

    await renderer.__test.requestTools();
    await renderer.__test.openTool("vscode");
    const dispatches = record.dispatches;
    check("the renderer dispatched two calls", dispatches.length === 2, String(dispatches.length));
    check(
      "the renderer only dispatches plugin.call",
      dispatches.every((entry) => entry.action === "plugin.call"),
      JSON.stringify(dispatches.map((entry) => entry.action))
    );
    check(
      "the renderer only calls declared methods",
      dispatches.every((entry) => (manifest.rendererCallMethods || []).includes(entry.payload.method)),
      JSON.stringify(dispatches.map((entry) => entry.payload.method))
    );
    check("listTools is asked without arguments", dispatches[0] && dispatches[0].payload.method === "listTools" && dispatches[0].payload.args === undefined);
    check(
      "openTool carries a tool id and nothing else",
      dispatches[1] && dispatches[1].payload.method === "openTool" && JSON.stringify(Object.keys(dispatches[1].payload.args || {})) === '["id"]',
      JSON.stringify(dispatches[1] && dispatches[1].payload)
    );
    const offlineAnswer = await renderer.__test.choose("gitbash");
    check("choose() returns whatever the host answered", offlineAnswer && offlineAnswer.ok === true, JSON.stringify(offlineAnswer));

    // ------------------------------------------------------- the settings layer
    const CODE_EXE = String.raw`C:\Program Files\Microsoft VS Code\Code.exe`;
    const CUSTOM_EXE = String.raw`C:\Custom Tools\editor.exe`;
    const configAnswer = {
      ok: true,
      locale: "en",
      project: pluginRoot,
      limit: 32,
      skipped: [],
      builtins: [{ id: "vscode", label: "VS Code", consoleHost: null }],
      entries: [
        {
          id: "vscode",
          label: { en: "VS Code", "zh-CN": "VS Code" },
          defaultLabel: "VS Code",
          builtin: true,
          enabled: true,
          status: "ready",
          reason: null,
          executable: CODE_EXE,
          executableName: "Code.exe",
          executableOverride: null,
          args: null,
          defaultArgs: ["{dir}"],
          consoleHost: null,
          defaultConsoleHost: null
        },
        {
          id: "editor",
          label: "My Editor",
          defaultLabel: null,
          builtin: false,
          enabled: false,
          status: "disabled",
          reason: null,
          executable: CUSTOM_EXE,
          executableName: "editor.exe",
          executableOverride: CUSTOM_EXE,
          args: ["--folder", "{dir}"],
          defaultArgs: null,
          consoleHost: "wt",
          defaultConsoleHost: null
        }
      ]
    };
    renderer.onUnload();
    const configStub = stubPi({ workspacePath: pluginRoot, locale: "en", answers: { toolConfig: configAnswer } });
    renderer.onLoad(configStub.pi);
    await renderer.__test.openConfig();
    const workingEntries = renderer.__test.configEntries();
    check("the settings layer asks the main process for the list", configStub.record.dispatches.some((entry) => entry.payload && entry.payload.method === "toolConfig"));
    check("the settings layer adopts every entry, whatever its status", workingEntries.length === 2, String(workingEntries.length));
    check(
      "the settings layer keeps a built-in's detected executable and default arguments",
      workingEntries[0] && workingEntries[0].executable === CODE_EXE && JSON.stringify(workingEntries[0].defaultArgs) === '["{dir}"]',
      JSON.stringify(workingEntries[0] && workingEntries[0].defaultArgs)
    );
    check(
      "a built-in nobody edited is stored as just its id",
      JSON.stringify(renderer.__test.toStoredEntry(workingEntries[0])) === '{"id":"vscode"}',
      JSON.stringify(renderer.__test.toStoredEntry(workingEntries[0]))
    );
    const storedCustom = renderer.__test.toStoredEntry(workingEntries[1]);
    check(
      "an edited custom tool is stored with its label, executable, args, console host and enabled flag",
      storedCustom.id === "editor" &&
        storedCustom.label === "My Editor" &&
        storedCustom.executable === CUSTOM_EXE &&
        JSON.stringify(storedCustom.args) === '["--folder","{dir}"]' &&
        storedCustom.consoleHost === "wt" &&
        storedCustom.enabled === false,
      JSON.stringify(storedCustom)
    );
    check(
      "makeId turns a label into an id the host accepts",
      /^[a-z][a-z0-9_-]{0,31}$/.test(renderer.__test.makeId("My Editor 2", "", [])),
      renderer.__test.makeId("My Editor 2", "", [])
    );
    check("makeId avoids an id that is already taken", renderer.__test.makeId("editor", "", [{ id: "editor" }]) === "editor-2");
    check(
      "makeId falls back to \"tool\" for a name with no latin letters",
      /^tool/.test(renderer.__test.makeId("我的编辑器", "", [])),
      renderer.__test.makeId("我的编辑器", "", [])
    );
    check(
      "splitArgs keeps one argument per line and drops the empty ones",
      JSON.stringify(renderer.__test.splitArgs("--a\n\n--b\r\n{dir}")) === JSON.stringify(["--a", "--b", "{dir}"]),
      JSON.stringify(renderer.__test.splitArgs("--a\n\n--b\r\n{dir}"))
    );
    // The sheet is built once and patched: no re-mount (and no animation
    // replay) on every click.
    const configLayer = configStub.record.layers[configStub.record.layers.length - 1];
    check(
      "the sheet is appended to the layer exactly once",
      Boolean(configLayer) && configLayer.element.appended === 1,
      String(configLayer && configLayer.element.appended)
    );
    renderer.__test.renderConfig();
    check(
      "re-painting the sheet patches it instead of tearing it down",
      Boolean(configLayer) && configLayer.element.appended === 1 && configLayer.element.cleared === 0,
      configLayer ? JSON.stringify({ appended: configLayer.element.appended, cleared: configLayer.element.cleared }) : ""
    );
    renderer.__test.closeConfig();
    check("the settings layer closes without leaving state behind", renderer.__test.configEntries().length === 0);

    // A successful save closes the sheet; a refused one stays open with the why.
    {
      const saveStub = stubPi({
        workspacePath: pluginRoot,
        locale: "en",
        answers: { toolConfig: configAnswer, saveToolConfig: configAnswer }
      });
      renderer.onLoad(saveStub.pi);
      await renderer.__test.openConfig();
      await renderer.__test.saveNow();
      check(
        "a successful save closes the sheet",
        renderer.__test.configEntries().length === 0 && renderer.__test.configView() === null,
        String(renderer.__test.configEntries().length)
      );
      const savedLayer = saveStub.record.layers[0];
      check("closing the sheet closes its layer", Boolean(savedLayer) && savedLayer.closed === true);
    }
    {
      const failStub = stubPi({
        workspacePath: pluginRoot,
        locale: "en",
        answers: {
          toolConfig: configAnswer,
          saveToolConfig: { ok: false, error: "INVALID_CONFIG", message: "the reason" }
        }
      });
      renderer.onLoad(failStub.pi);
      await renderer.__test.openConfig();
      await renderer.__test.saveNow();
      check(
        "a refused save keeps the sheet open with the reason",
        renderer.__test.configEntries().length === 2 && renderer.__test.configMessage() === "the reason",
        String(renderer.__test.configEntries().length) + " | " + String(renderer.__test.configMessage())
      );
      renderer.__test.closeConfig();
    }

    // Opening the menu re-reads the list, so a chat opened before the sheet was
    // used sees the new list instead of the one it read at mount.
    {
      const menuAnswer = {
        ok: true,
        root: pluginRoot,
        tools: [{ id: "vscode", label: "VS Code", executableName: "Code.exe", builtin: true }],
        skipped: []
      };
      const menuStub = stubPi({ workspacePath: pluginRoot, locale: "en", answers: { listTools: menuAnswer } });
      renderer.onLoad(menuStub.pi);
      const anchor = {
        getBoundingClientRect: () => ({ left: 10, top: 300, right: 40, bottom: 328, width: 30, height: 28 })
      };
      const listCalls = () =>
        menuStub.record.dispatches.filter((entry) => entry.payload && entry.payload.method === "listTools").length;
      const beforeOpen = listCalls();
      const fallback = { status: "ready", root: null, tools: [], message: null };
      await renderer.__test.openMenuFrom(anchor, fallback);
      renderer.__test.closeMenu();
      const second = await renderer.__test.openMenuFrom(anchor, fallback);
      check(
        "opening the menu asks the main process for the list again",
        listCalls() === beforeOpen + 2,
        String(listCalls() - beforeOpen)
      );
      check(
        "the menu is handed the freshly read list",
        Boolean(second) && second.tools.length === 1 && second.tools[0].id === "vscode",
        JSON.stringify(second && second.tools)
      );
      renderer.__test.closeMenu();
    }

    renderer.onUnload();
    check("onUnload() disposes the injected stylesheet", record.styleDisposed === 1, String(record.styleDisposed));
  } finally {
    try {
      rmSync(temp, { recursive: true, force: true });
    } catch {
      /* leaving a temp directory behind must not fail the run */
    }
  }
}

// ----------------------------------------------------------------------------
// 8. the other platforms: macOS and Linux tables, detection, launching, the
//    child environment and the settings payload. Everything here runs against a
//    stubbed file system and a stubbed spawn — these are structural assertions,
//    they do not claim a real macOS or Linux launch was observed.
// ----------------------------------------------------------------------------
{
  internals.setLaunchOverrides(null);
  const MAC_OPEN = "/usr/bin/open";
  const MAC_CODE = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
  const MAC_VSCODE_APP = "/Applications/Visual Studio Code.app";
  const MAC_TERMINAL_APP = "/System/Applications/Utilities/Terminal.app";
  const MAC_PROJECT = "/Users/tester/a project";
  // The folder is resolved by the host platform's `path` module, so the
  // assertions compare against that resolution rather than the literal.
  const MAC_ROOT = resolve(MAC_PROJECT);

  check("an unknown platform name counts as Linux", internals.normalizePlatform("freebsd") === "linux");
  check("a known platform name is kept", internals.normalizePlatform("darwin") === "darwin");
  check("no platform name falls back to this machine", internals.normalizePlatform("") === internals.HOST_PLATFORM);

  for (const platform of internals.PLATFORMS) {
    const table = internals.toolTable(platform);
    const ids = table.map((tool) => tool.id);
    check(`${platform}: ships at least one built-in tool`, table.length > 0, String(table.length));
    check(`${platform}: tool ids are unique`, new Set(ids).size === ids.length, ids.join(", "));
    for (const tool of table) {
      check(`${platform}/${tool.id}: has at least one variant`, Array.isArray(tool.variants) && tool.variants.length > 0);
      check(
        `${platform}/${tool.id}: every variant can be located and started`,
        tool.variants.every(
          (variant) =>
            typeof variant.argv === "function" &&
            (Array.isArray(variant.executableNames) || typeof variant.candidates === "function")
        )
      );
      check(
        `${platform}/${tool.id}: is labelled in both locales`,
        Boolean(tool.label && tool.label.en && tool.label["zh-CN"])
      );
      for (let index = 0; index < tool.variants.length; index += 1) {
        const argv = internals.variantArgv(tool, index, MAC_PROJECT);
        check(
          `${platform}/${tool.id}#${index}: argv is an array of strings`,
          Array.isArray(argv) && argv.every((entry) => typeof entry === "string"),
          JSON.stringify(argv)
        );
        const carriers = argv.filter((entry) => entry.includes(MAC_PROJECT));
        check(
          `${platform}/${tool.id}#${index}: the folder travels in exactly one argv element`,
          carriers.length === 1,
          JSON.stringify(argv)
        );
        check(
          `${platform}/${tool.id}#${index}: the folder is not glued into a command line`,
          argv.every((entry) => entry === MAC_PROJECT || !entry.includes(" " + MAC_PROJECT) || entry.endsWith("=" + MAC_PROJECT)),
          JSON.stringify(argv)
        );
      }
    }
  }

  check(
    "Windows keeps the eight documented tools",
    JSON.stringify(internals.toolTable("win32").map((tool) => tool.id)) ===
      JSON.stringify(["vscode", "explorer", "cmd", "powershell", "pwsh", "gitbash", "wt", "wsl"])
  );
  check(
    "macOS offers VS Code, Finder, Terminal and iTerm2",
    JSON.stringify(internals.toolTable("darwin").map((tool) => tool.id)) ===
      JSON.stringify(["vscode", "finder", "terminal", "iterm"])
  );
  check(
    "Linux offers VS Code, the file manager and a terminal",
    JSON.stringify(internals.toolTable("linux").map((tool) => tool.id)) === JSON.stringify(["vscode", "filemanager", "terminal"])
  );
  check(
    "Windows Terminal is the only console host, and only on Windows",
    internals.consoleHostIds("win32").size === 1 &&
      internals.consoleHostIds("win32").has("wt") &&
      internals.consoleHostIds("darwin").size === 0 &&
      internals.consoleHostIds("linux").size === 0
  );

  // -- detection against a stubbed macOS disk
  const macEnv = { HOME: "/Users/tester", PATH: "/usr/bin:/bin" };
  internals.resetDetectionCache();
  const macDetected = internals.detectTools({
    platform: "darwin",
    env: macEnv,
    fileSystem: fakeFileSystem([MAC_OPEN, MAC_CODE], [MAC_VSCODE_APP, MAC_TERMINAL_APP])
  });
  const macIds = macDetected.map((tool) => tool.id);
  check(
    "macOS: VS Code, Finder and Terminal are detected; iTerm2 is not",
    JSON.stringify(macIds) === JSON.stringify(["vscode", "finder", "terminal"]),

    macIds.join(", ")
  );
  check(
    "macOS: the VS Code command line is preferred when it exists",
    (macDetected.find((tool) => tool.id === "vscode") || {}).executable === MAC_CODE
  );

  internals.resetDetectionCache();
  const macLaunch = internals.buildLaunch("terminal", MAC_PROJECT, {
    platform: "darwin",
    env: macEnv,
    fileSystem: fakeFileSystem([MAC_OPEN], [MAC_TERMINAL_APP])
  });
  check(
    "macOS: Terminal is started through LaunchServices on the folder",
    macLaunch.executable === MAC_OPEN &&
      JSON.stringify(macLaunch.argv) === JSON.stringify(["-a", "Terminal", MAC_ROOT]),
    JSON.stringify(macLaunch.argv)
  );
  check("macOS: the launch goes through no shell", macLaunch.options.shell === false);
  check("macOS: the launch opens in the project folder", macLaunch.options.cwd === MAC_ROOT, macLaunch.options.cwd);
  check(
    "macOS: the folder rides in the last argv element",
    macLaunch.argvTarget === "last" && macLaunch.dirIndex === macLaunch.argv.length - 1,
    JSON.stringify([macLaunch.argvTarget, macLaunch.dirIndex])
  );
  check("macOS: no console host is involved", macLaunch.consoleHost === null);

  const macSpawned = [];
  internals.resetDetectionCache();
  const macResult = internals.launchTool("finder", MAC_PROJECT, {
    platform: "darwin",
    env: macEnv,
    fileSystem: fakeFileSystem([MAC_OPEN]),
    spawn: (command, argv, options) => {
      macSpawned.push({ command, argv, options });
      return { pid: 4242, unref() {} };
    }
  });
  check(
    "macOS: opening Finder spawns `open <folder>` exactly once",
    macSpawned.length === 1 &&
      macSpawned[0].command === MAC_OPEN &&
      JSON.stringify(macSpawned[0].argv) === JSON.stringify([MAC_ROOT]),
    JSON.stringify(macSpawned)
  );
  check("macOS: the launched process id is reported back", macResult.pid === 4242, String(macResult.pid));
  check(
    "macOS: the child environment is POSIX, not Windows",
    macSpawned[0].options.env.HOME === "/Users/tester" &&
      macSpawned[0].options.env.OS === undefined &&
      macSpawned[0].options.env.PATHEXT === undefined,
    JSON.stringify({ HOME: macSpawned[0].options.env.HOME, OS: macSpawned[0].options.env.OS })
  );

  // -- detection against a stubbed Linux disk
  const linuxEnv = { HOME: "/home/tester", PATH: "/usr/bin:/bin" };
  internals.resetDetectionCache();
  const linuxDetected = internals.detectTools({
    platform: "linux",
    env: linuxEnv,
    fileSystem: fakeFileSystem(["/usr/bin/code", "/usr/bin/xdg-open", "/usr/bin/konsole", "/usr/bin/gnome-terminal"])
  });
  const linuxTerminal = linuxDetected.find((tool) => tool.id === "terminal") || {};
  check(
    "Linux: the first terminal emulator of the table wins",
    linuxTerminal.executable === "/usr/bin/gnome-terminal",
    String(linuxTerminal.executable)
  );
  internals.resetDetectionCache();
  const linuxLaunch = internals.buildLaunch("terminal", "/home/tester/project", {
    platform: "linux",
    env: linuxEnv,
    fileSystem: fakeFileSystem(["/usr/bin/gnome-terminal", "/usr/bin/konsole"])
  });
  check(
    "Linux: the terminal is told the folder as its working directory",
    JSON.stringify(linuxLaunch.argv) === JSON.stringify(["--working-directory", resolve("/home/tester/project")]),
    JSON.stringify(linuxLaunch.argv)
  );
  internals.resetDetectionCache();
  const codeOnlyOnPath = internals.detectTools({
    platform: "linux",
    env: { HOME: "/home/tester", PATH: "/opt/tools/bin" },
    fileSystem: fakeFileSystem(["/opt/tools/bin/code"])
  });
  check(
    "Linux: VS Code is also found through PATH",
    String((codeOnlyOnPath.find((tool) => tool.id === "vscode") || {}).executable || "")
      .split(String.fromCharCode(92))
      .join("/") === "/opt/tools/bin/code",
    String(JSON.stringify((codeOnlyOnPath.find((tool) => tool.id === "vscode") || {}).executable || "")),
    JSON.stringify(codeOnlyOnPath.map((tool) => tool.id))
  );

  // -- validation is per platform
  const macCustom = internals.normalizeToolEntries(
    [{ id: "editor", executable: "/usr/local/bin/code", args: ["{dir}"] }],
    "darwin"
  );
  check(
    "macOS: a custom program without a .exe is accepted",
    macCustom.entries.length === 1 && macCustom.skipped.length === 0,
    JSON.stringify(macCustom.skipped)
  );
  const linuxCustom = internals.normalizeToolEntries(
    [{ id: "editor", executable: "/usr/bin/gedit", args: ["{dir}"] }],
    "linux"
  );
  check("Linux: a custom program without a .exe is accepted", linuxCustom.entries.length === 1);
  const windowsCustom = internals.normalizeToolEntries(
    [{ id: "editor", executable: "C:/Tools/editor", args: ["{dir}"] }],
    "win32"
  );
  check(
    "Windows: a custom program without .exe is still rejected",
    windowsCustom.entries.length === 0 && typeof windowsCustom.skipped[0].reason === "string",
    JSON.stringify(windowsCustom.skipped)
  );
  const macHost = internals.normalizeToolEntries(
    [{ id: "editor", executable: "/usr/local/bin/code", args: ["{dir}"], consoleHost: "wt" }],
    "darwin"
  );
  check(
    "macOS: a Windows console host is refused with a reason",
    macHost.entries.length === 0 && typeof macHost.skipped[0].reason === "string",
    JSON.stringify(macHost.skipped)
  );

  // -- the child environment, per platform
  const posixChild = internals.buildChildEnvironment(
    {
      HOME: "/Users/tester",
      PATH: "/usr/bin:/bin",
      OS: "Windows_NT",
      PATHEXT: ".EXE",
      ComSpec: "C:/Windows/System32/cmd.exe",
      USERPROFILE: "C:/Users/tester",
      LOCALAPPDATA: "C:/Users/tester/AppData/Local",
      ELECTRON_RUN_AS_NODE: "1"
    },
    null,
    "darwin"
  );
  check("macOS: the child keeps HOME", posixChild.HOME === "/Users/tester", String(posixChild.HOME));
  check(
    "macOS: the child never sees the Windows-only variables",
    posixChild.OS === undefined &&
      posixChild.PATHEXT === undefined &&
      posixChild.ComSpec === undefined &&
      posixChild.USERPROFILE === undefined &&
      posixChild.LOCALAPPDATA === undefined,
    JSON.stringify(Object.keys(posixChild))
  );
  check("macOS: the child never sees the host markers", posixChild.ELECTRON_RUN_AS_NODE === undefined);
  check(
    "macOS: the child gets a user name it can work with",
    typeof posixChild.USER === "string" && posixChild.USER.length > 0,
    String(posixChild.USER)
  );
  check("macOS: LOGNAME mirrors USER", posixChild.LOGNAME === posixChild.USER, String(posixChild.LOGNAME));
  check(
    "Windows: the same call still fills in the Windows variables",
    internals.buildChildEnvironment({ USERPROFILE: "C:/Users/tester" }, null, "win32").OS === "Windows_NT"
  );

  // -- the settings payload tells the renderer which platform it is on
  const macPayload = internals.configPayload(
    { platform: "darwin", entries: [], skipped: [], tools: [] },
    "en",
    null,
    null
  );
  check("the settings sheet is told the platform", macPayload.platform === "darwin", String(macPayload.platform));
  check(
    "the settings sheet is told there is no console host on macOS",
    Array.isArray(macPayload.consoleHosts) && macPayload.consoleHosts.length === 0,
    JSON.stringify(macPayload.consoleHosts)
  );
  check(
    "the settings sheet offers the macOS built-ins",
    JSON.stringify(macPayload.builtins.map((builtin) => builtin.id)) ===
      JSON.stringify(["vscode", "finder", "terminal", "iterm"]),
    JSON.stringify(macPayload.builtins.map((builtin) => builtin.id))
  );
  const winPayload = internals.configPayload(
    { platform: "win32", entries: [], skipped: [], tools: [] },
    "en",
    null,
    null
  );
  check(
    "the settings sheet offers Windows Terminal as the console host",
    JSON.stringify(winPayload.consoleHosts) === JSON.stringify(["wt"]),
    JSON.stringify(winPayload.consoleHosts)
  );
}

// ----------------------------------------------------------------------------
// 9. teardown
// ----------------------------------------------------------------------------
{
  const { pi } = stubPi({ workspacePath: pluginRoot });
  globalThis.pi = pi;
  const captured = captureConsole();
  let error = null;
  try {
    await main.onUnload();
  } catch (thrown) {
    error = thrown;
  }
  const logs = captured.texts("log");
  captured.restore();
  check("onUnload() finishes without throwing", error === null, error && error.message);
  check("onUnload() logs the teardown", logs.some((line) => line.includes("[open-tools] unloaded")), logs.join(" | "));
}

// ----------------------------------------------------------------------------
// report
// ----------------------------------------------------------------------------
const failed = results.filter((entry) => !entry.ok);
for (const entry of results) {
  if (entry.ok) console.log("ok   " + entry.name);
  else console.error("FAIL " + entry.name + (entry.detail ? " — " + entry.detail : ""));
}
console.log("");
console.log(`${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length > 0) {
  process.exitCode = 1;
} else {
  console.log("selftest OK");
}

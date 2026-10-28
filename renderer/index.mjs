import React from "react";

/**
 * mfy.pi-desktop-open-tools — the composer toolbar button.
 *
 * This module draws inside PI-Desktop's own window. It never starts a program:
 * it asks the plugin's main process (`onRendererCall` in main.js) what is
 * installed and which folder is open, and then names one tool id. The only
 * action dispatched is `plugin.call`, the only methods are the three the
 * manifest declares, and no path or executable ever travels from here.
 */

const PLUGIN_ID = "mfy.pi-desktop-open-tools";

const TEXT = {
  en: {
    button: "Open in",
    title: "Open the project folder in an external tool",
    menuTitle: "Open the project folder with",
    menuConfig: "Configure tools…",
    loading: "Looking for installed tools…",
    noProject: "No project folder is open",
    noTools: "No tool is set up — open Configure tools… to add one",
    failed: "The tools could not be listed",
    configTitle: "External tools",
    configSubtitle: "What the button offers, in order",
    configLoading: "Loading…",
    configClose: "Close",
    configSave: "Save",
    configSaving: "Saving…",
    configReset: "Restore defaults",
    configSaved: "Saved",
    configSaveFailed: "Could not save",
    configLoadFailed: "The tool list could not be loaded",
    configEmpty: "No tool is set up yet — add one below.",
    configIgnored: "These entries were ignored:",
    configInMenu: "In the menu",
    configDetails: "Settings",
    configHideDetails: "Hide",
    configMoveUp: "Move up",
    configMoveDown: "Move down",
    configRemove: "Remove",
    configName: "Name",
    configNameHint: "Shown in the menu",
    configExecutable: "Program (.exe)",
    configExecutableHint: "Absolute path. Leave empty to use the copy found on this machine.",
    configExecutablePlaceholder: "C:\\path\\to\\tool.exe",
    configFound: "found automatically",
    configNotFound: "not found",
    configArgs: "Arguments",
    configArgsHint: "One argument per line. {dir} stands for the project folder and must be on a line of its own.",
    configArgsInherited: "Using the built-in arguments",
    configConsole: "Needs a console window (opened by Windows Terminal)",
    configConsoleInfo: "Opened by Windows Terminal",
    configStatusReady: "ready",
    configStatusMissing: "not available",
    configStatusDisabled: "turned off",
    configBuiltin: "built-in",
    configCustom: "custom",
    configAdd: "Add a tool",
    configAddBuiltin: "Built-in tool…",
    configAddCustom: "Custom tool…",
    configAddAction: "Add",
    configIdHint: "id:",
    configLimit: "Up to {count} tools",
    configIntro: "This order is the menu order. A tool you turn off stays in the list but leaves the menu.",
    configAddOpen: "Add a tool",
    configPick: "Choose…",
    configCancel: "Cancel",
    configCustomize: "Settings",
    configStatusPending: "not checked yet",
    configStoredIn: "saved in the plugin data folder"
  },
  "zh-CN": {
    button: "打开到",
    title: "用外部工具打开项目文件夹",
    menuTitle: "用以下工具打开项目文件夹",
    menuConfig: "配置外部工具…",
    loading: "正在探测已安装的工具…",
    noProject: "当前没有打开项目文件夹",
    noTools: "还没有配置工具 —— 打开「配置外部工具…」添加一个",
    failed: "无法列出可用的工具",
    configTitle: "外部工具",
    configSubtitle: "按钮里列哪些工具、按什么顺序",
    configLoading: "正在加载…",
    configClose: "关闭",
    configSave: "保存",
    configSaving: "正在保存…",
    configReset: "恢复默认",
    configSaved: "已保存",
    configSaveFailed: "保存失败",
    configLoadFailed: "无法加载工具配置",
    configEmpty: "还没有配置任何工具 —— 在下面添加一个。",
    configIgnored: "以下条目无法识别，已被忽略：",
    configInMenu: "在菜单中显示",
    configDetails: "设置",
    configHideDetails: "收起",
    configMoveUp: "上移",
    configMoveDown: "下移",
    configRemove: "移除",
    configName: "名称",
    configNameHint: "显示在菜单里的名字",
    configExecutable: "程序（.exe）",
    configExecutableHint: "绝对路径；留空表示使用本机自动探测到的那个。",
    configExecutablePlaceholder: "C:\\路径\\工具.exe",
    configFound: "已自动探测到",
    configNotFound: "未找到",
    configArgs: "参数",
    configArgsHint: "一行一个参数。{dir} 代表项目文件夹，必须单独占一行。",
    configArgsInherited: "使用内置参数",
    configConsole: "需要控制台窗口（用 Windows 终端打开）",
    configConsoleInfo: "由 Windows 终端打开",
    configStatusReady: "可用",
    configStatusMissing: "不可用",
    configStatusDisabled: "已停用",
    configBuiltin: "内置",
    configCustom: "自定义",
    configAdd: "添加工具",
    configAddBuiltin: "内置工具…",
    configAddCustom: "自定义工具…",
    configAddAction: "添加",
    configIdHint: "id：",
    configLimit: "最多 {count} 个工具",
    configIntro: "这里的顺序就是菜单顺序。停用的工具留在列表里，但不会出现在菜单中。",
    configAddOpen: "添加工具",
    configPick: "请选择…",
    configCancel: "取消",
    configCustomize: "设置",
    configStatusPending: "尚未检测",
    configStoredIn: "保存在插件数据目录"
  }
};

const STYLE = `
/* Every colour comes from the host's design tokens, so the sheet follows the
   appearance setting. The one rule that matters: the sheet and the dropdown sit
   on --ds-bg-elevated-opaque, never on --ds-bg-elevated, which is translucent
   in the light theme (white at 70%) and let the window show through. */
.ot-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 28px;
  min-width: 28px;
  padding: 0 5px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--ds-text-secondary, #b9b9b9);
  font: inherit;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.ot-btn:hover:not(:disabled) {
  background: var(--ds-bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--ds-text-primary, #ededed);
}
.ot-btn:focus-visible {
  outline: 2px solid var(--ds-focus, #4c8dff);
  outline-offset: 1px;
}
.ot-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.ot-btn__caret {
  opacity: 0.7;
}
.ot-menu {
  position: fixed;
  z-index: 2;
  min-width: 208px;
  max-width: 320px;
  padding: 6px;
  border-radius: 12px;
  background: var(--ds-bg-elevated-opaque, #282828);
  color: var(--ds-text-primary, #ededed);
  box-shadow: var(--ds-elevation-stroke, 0 0 0 0.5px rgba(0, 0, 0, 0.14)),
    var(--ds-shadow-model-menu, 0 12px 32px rgba(0, 0, 0, 0.28));
  font: inherit;
  font-size: 13px;
}
.ot-menu__title {
  padding: 4px 8px 6px;
  font-size: 11px;
  letter-spacing: 0.02em;
  color: var(--ds-text-muted, rgba(255, 255, 255, 0.55));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ot-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.ot-item:hover,
.ot-item:focus-visible {
  background: var(--ds-bg-hover, rgba(255, 255, 255, 0.08));
  outline: none;
}
.ot-item__name {
  flex: 1 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ot-item__hint {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--ds-text-faint, rgba(255, 255, 255, 0.4));
}
.ot-sep {
  height: 1px;
  margin: 6px 4px;
  background: var(--ds-border-subtle, rgba(255, 255, 255, 0.08));
}
.ot-foot-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ds-text-muted, rgba(255, 255, 255, 0.6));
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.ot-foot-item:hover,
.ot-foot-item:focus-visible {
  background: var(--ds-bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--ds-text-primary, #ededed);
  outline: none;
}

/* ------------------------------------------------------------------ the sheet */
@keyframes ot-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes ot-rise {
  from { opacity: 0; transform: translateY(10px) scale(0.995); }
  to { opacity: 1; transform: none; }
}
.ot-backdrop {
  position: fixed;
  inset: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  background: var(--ds-modal-veil, rgba(0, 0, 0, 0.32));
  -webkit-backdrop-filter: blur(3px);
  backdrop-filter: blur(3px);
  animation: ot-fade 120ms ease-out;
}
.ot-sheet {
  display: flex;
  flex-direction: column;
  width: min(720px, 100%);
  max-height: min(780px, calc(100dvh - 64px));
  border-radius: 16px;
  background: var(--ds-bg-elevated-opaque, #282828);
  color: var(--ds-text-primary, #ededed);
  box-shadow: var(--ds-elevation-stroke, 0 0 0 0.5px rgba(0, 0, 0, 0.14)),
    var(--ds-shadow-dialog, 0 16px 48px rgba(0, 0, 0, 0.28));
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
  overflow: hidden;
  animation: ot-rise 160ms cubic-bezier(0.2, 0.8, 0.3, 1);
}
.ot-sheet__head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 18px 20px 14px;
}
.ot-sheet__heading {
  flex: 1 1 auto;
  min-width: 0;
}
.ot-sheet__title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.ot-sheet__sub {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--ds-text-muted, rgba(255, 255, 255, 0.55));
}
.ot-sheet__body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0 20px 14px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--ds-border-strong, rgba(255, 255, 255, 0.2)) transparent;
}
.ot-sheet__foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--ds-border-subtle, rgba(255, 255, 255, 0.08));
}

/* -------------------------------------------------------------------- a tool */
.ot-list {
  display: block;
}
.ot-card {
  margin-top: 6px;
  border-radius: 12px;
  background: var(--ds-tile, rgba(255, 255, 255, 0.04));
  transition: background 120ms ease;
}
.ot-card:first-child {
  margin-top: 0;
}
.ot-card:hover {
  background: var(--ds-tile-hover, rgba(255, 255, 255, 0.06));
}
.ot-card[data-status="disabled"] .ot-name {
  color: var(--ds-text-muted, rgba(255, 255, 255, 0.55));
}
.ot-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px 9px 6px;
}
.ot-move {
  display: grid;
  flex: 0 0 auto;
  gap: 1px;
}
.ot-move button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 13px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ds-text-faint, rgba(255, 255, 255, 0.35));
  font-size: 9px;
  line-height: 1;
  cursor: pointer;
}
.ot-move button:hover:not(:disabled) {
  background: var(--ds-bg-hover, rgba(255, 255, 255, 0.1));
  color: var(--ds-text-primary, #ededed);
}
.ot-move button:disabled {
  opacity: 0.25;
  cursor: default;
}
.ot-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ds-success, #00a240);
  box-shadow: 0 0 0 3px var(--ds-tile, rgba(255, 255, 255, 0.04));
}
.ot-dot--missing {
  background: var(--ds-warning, #e25507);
}
.ot-dot--disabled {
  background: var(--ds-text-faint, rgba(255, 255, 255, 0.35));
}
.ot-row__main {
  flex: 1 1 auto;
  min-width: 0;
}
.ot-row__top {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.ot-name {
  flex: 0 1 auto;
  min-width: 40px;
  max-width: 100%;
  margin-left: -6px;
  padding: 2px 6px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 500;
}
.ot-name:hover {
  border-color: var(--ds-border-default, rgba(255, 255, 255, 0.08));
}
.ot-name:focus {
  border-color: var(--ds-accent, #4c8dff);
  background: var(--ds-settings-field-bg, #212121);
  outline: none;
}
.ot-tag {
  flex: 0 0 auto;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--ds-bg-chip, rgba(255, 255, 255, 0.06));
  color: var(--ds-text-muted, rgba(255, 255, 255, 0.55));
  font-size: 10px;
  line-height: 16px;
}
.ot-meta {
  margin-top: 1px;
  font-size: 11px;
  color: var(--ds-text-faint, rgba(255, 255, 255, 0.35));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ot-reason {
  margin-top: 2px;
  font-size: 11px;
  color: var(--ds-warning, #e25507);
}
.ot-switch {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  width: 32px;
  height: 18px;
}
.ot-switch input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
  z-index: 1;
}
.ot-switch span {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 999px;
  background: var(--ds-switch-track-off, rgba(255, 255, 255, 0.12));
  transition: background 120ms ease;
}
.ot-switch span::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--ds-switch-knob-off, #fff);
  box-shadow: var(--ds-raised-shadow, 0 1px 2px rgba(0, 0, 0, 0.35));
  transition: transform 120ms cubic-bezier(0.2, 0.8, 0.3, 1);
}
.ot-switch:hover span {
  background: var(--ds-switch-track-off-hover, rgba(255, 255, 255, 0.18));
}
.ot-switch input:checked + span {
  background: var(--ds-accent, #4c8dff);
}
.ot-switch input:checked + span::after {
  background: var(--ds-switch-knob-on, #181818);
  transform: translateX(14px);
}
.ot-switch input:focus-visible + span {
  outline: 2px solid var(--ds-focus, #4c8dff);
  outline-offset: 2px;
}
.ot-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ds-text-muted, rgba(255, 255, 255, 0.55));
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.ot-icon:hover:not(:disabled) {
  background: var(--ds-bg-hover, rgba(255, 255, 255, 0.1));
  color: var(--ds-text-primary, #ededed);
}
.ot-icon:focus-visible {
  outline: 2px solid var(--ds-focus, #4c8dff);
  outline-offset: 1px;
}
.ot-icon:disabled {
  opacity: 0.25;
  cursor: default;
}
.ot-icon--danger:hover:not(:disabled) {
  color: var(--ds-error, #e02e2a);
}

/* ----------------------------------------------------------------- settings */
.ot-detail {
  display: grid;
  gap: 12px;
  margin: 0 10px 10px;
  padding: 12px 14px 14px;
  border-radius: 10px;
  background: var(--ds-field-inset-bg, rgba(255, 255, 255, 0.05));
  animation: ot-fade 120ms ease-out;
}
.ot-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}
.ot-field {
  display: grid;
  gap: 5px;
  min-width: 0;
}
.ot-field--wide {
  grid-column: 1 / -1;
}
.ot-field__label {
  font-size: 11px;
  color: var(--ds-text-muted, rgba(255, 255, 255, 0.55));
}
.ot-field__hint {
  font-size: 11px;
  color: var(--ds-text-faint, rgba(255, 255, 255, 0.35));
}
.ot-input,
.ot-select,
.ot-textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--ds-border-default, rgba(255, 255, 255, 0.08));
  border-radius: 8px;
  background: var(--ds-settings-field-bg, #212121);
  color: inherit;
  font: inherit;
}
.ot-input::placeholder,
.ot-textarea::placeholder {
  color: var(--ds-placeholder-ink, rgba(255, 255, 255, 0.3));
}
.ot-textarea {
  min-height: 60px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}
.ot-input:focus,
.ot-select:focus,
.ot-textarea:focus {
  border-color: var(--ds-accent, #4c8dff);
  outline: none;
}
.ot-check {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--ds-text-secondary, rgba(255, 255, 255, 0.7));
}
.ot-check input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--ds-accent, #4c8dff);
}

/* ---------------------------------------------------------------- add a tool */
.ot-add {
  display: grid;
  gap: 12px;
  margin-top: 8px;
  padding: 14px;
  border-radius: 12px;
  background: var(--ds-field-inset-bg, rgba(255, 255, 255, 0.05));
  animation: ot-rise 140ms cubic-bezier(0.2, 0.8, 0.3, 1);
}
.ot-add__title {
  font-size: 12px;
  font-weight: 600;
}
.ot-add__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

/* ------------------------------------------------------------------- feedback */
.ot-button {
  padding: 6px 12px;
  border: 1px solid var(--ds-border-strong, rgba(255, 255, 255, 0.16));
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: background 120ms ease, opacity 120ms ease;
}
.ot-button:hover:not(:disabled) {
  background: var(--ds-bg-hover, rgba(255, 255, 255, 0.08));
}
.ot-button:focus-visible {
  outline: 2px solid var(--ds-focus, #4c8dff);
  outline-offset: 1px;
}
.ot-button:disabled {
  opacity: 0.45;
  cursor: default;
}
.ot-button--ghost {
  border-color: transparent;
  color: var(--ds-text-secondary, rgba(255, 255, 255, 0.7));
}
.ot-button--primary {
  border-color: transparent;
  background: var(--ds-accent, #4c8dff);
  color: var(--ds-bg-primary, #181818);
  font-weight: 500;
}
.ot-button--primary:hover:not(:disabled) {
  background: var(--ds-accent-hover, #ffffff);
}
.ot-warn {
  margin: 4px 0 10px;
  padding: 9px 11px;
  border-radius: 9px;
  background: var(--ds-tile, rgba(255, 255, 255, 0.04));
  color: var(--ds-warning, #e25507);
  font-size: 12px;
}
.ot-empty {
  padding: 32px 12px;
  text-align: center;
  color: var(--ds-text-faint, rgba(255, 255, 255, 0.35));
}
.ot-msg {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ot-msg--ok {
  color: var(--ds-success, #00a240);
}
.ot-msg--error {
  color: var(--ds-error, #e02e2a);
}
.ot-spacer {
  flex: 1 1 auto;
}
`;

let host = null;
let styleDisposer = null;
let layerHandle = null;
let menuElement = null;
let menuCleanup = null;

function hostLanguage() {
  let raw = "";
  try {
    raw = String(document.documentElement.getAttribute("lang") || "");
  } catch {
    raw = "";
  }
  if (!raw) {
    try {
      raw = String((typeof navigator !== "undefined" && navigator.language) || "");
    } catch {
      raw = "";
    }
  }
  return raw.toLowerCase();
}

function languageFor(raw) {
  return String(raw || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function text() {
  return TEXT[languageFor(hostLanguage())];
}

/** The single action this plugin dispatches. */
function dispatchPluginCall(method, args) {
  if (!host || typeof host.dispatch !== "function") {
    return Promise.reject(new Error("the renderer host is not available"));
  }
  const payload = { method };
  if (args !== undefined) payload.args = args;
  return host.dispatch("plugin.call", payload);
}

/**
 * Read the list and shape it for the button and the menu. Called on mount and
 * again every time the menu opens: the sheet writes the list for every window,
 * so a chat that was already open must not keep showing what it read at mount.
 */
async function loadToolList() {
  try {
    const answer = await requestTools();
    if (answer && answer.ok === true) {
      return { status: "ready", root: answer.root || null, tools: answer.tools || [], message: null };
    }
    const copy = text();
    return {
      status: "blocked",
      root: null,
      tools: (answer && answer.tools) || [],
      message: (answer && answer.message) || copy.noProject
    };
  } catch (error) {
    console.warn("[open-tools] listTools failed", error);
    return { status: "failed", root: null, tools: [], message: text().failed };
  }
}

/** Ask the main process what it can open and where the project lives. */
function requestTools() {
  return dispatchPluginCall("listTools");
}

/** Ask the main process to start one tool (an id from its own whitelist). */
function openTool(id) {
  return dispatchPluginCall("openTool", { id });
}

/** The full tool list with each entry's status, for the settings layer. */
function requestToolConfig() {
  return dispatchPluginCall("toolConfig");
}

/** Persist the whole list; the main process validates every entry first. */
function saveToolConfig(entries) {
  return dispatchPluginCall("saveToolConfig", { entries });
}

/** Drop the setting and go back to the built-in defaults. */
function resetToolConfig() {
  return dispatchPluginCall("resetToolConfig");
}

function closeMenu() {
  if (typeof menuCleanup === "function") {
    try {
      menuCleanup();
    } catch {
      /* listeners are best effort */
    }
    menuCleanup = null;
  }
  if (menuElement && menuElement.parentNode) {
    menuElement.parentNode.removeChild(menuElement);
  }
  menuElement = null;
  if (layerHandle) {
    try {
      layerHandle.close();
    } catch {
      /* the host may already have closed the layer */
    }
    layerHandle = null;
  }
}

async function choose(id) {
  try {
    const answer = await openTool(id);
    if (!answer || answer.ok !== true) {
      console.warn("[open-tools] openTool declined", answer && answer.error, answer && answer.message);
    }
    return answer;
  } catch (error) {
    console.warn("[open-tools] openTool failed", error);
    return { ok: false, error: "CALL_FAILED", message: String((error && error.message) || error) };
  }
}

function positionMenu(menu, anchor) {
  const anchorBox = anchor.getBoundingClientRect();
  const box = menu.getBoundingClientRect();
  const gap = 8;
  const margin = 8;
  const viewportWidth = window.innerWidth || 1024;
  const viewportHeight = window.innerHeight || 768;
  let left = anchorBox.left;
  if (left + box.width > viewportWidth - margin) left = viewportWidth - margin - box.width;
  left = Math.max(margin, left);
  let top = anchorBox.top - box.height - gap;
  if (top < margin) top = Math.min(viewportHeight - margin - box.height, anchorBox.bottom + gap);
  top = Math.max(margin, top);
  menu.style.left = Math.round(left) + "px";
  menu.style.top = Math.round(top) + "px";
}

function openMenu(anchor, state) {
  closeMenu();
  if (!host || !host.ui || typeof host.ui.openLayer !== "function") return;
  let layer;
  try {
    layer = host.ui.openLayer();
  } catch (error) {
    console.warn("[open-tools] openLayer failed", error);
    return;
  }
  layerHandle = layer;
  const copy = text();
  const menu = document.createElement("div");
  menu.className = "ot-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", copy.menuTitle);

  const heading = document.createElement("div");
  heading.className = "ot-menu__title";
  heading.textContent = state.root || copy.menuTitle;
  heading.title = state.root || copy.menuTitle;
  menu.appendChild(heading);

  const items = [];
  for (const tool of state.tools) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ot-item";
    item.setAttribute("role", "menuitem");
    item.dataset.toolId = tool.id;
    const name = document.createElement("span");
    name.className = "ot-item__name";
    name.textContent = tool.label || tool.id;
    item.appendChild(name);
    if (tool.executableName) {
      const hint = document.createElement("span");
      hint.className = "ot-item__hint";
      hint.textContent = tool.executableName;
      item.appendChild(hint);
    }
    item.addEventListener("click", () => {
      closeMenu();
      if (item.dataset.toolId) void choose(item.dataset.toolId);
    });
    menu.appendChild(item);
    items.push(item);
  }

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "ot-menu__title";
    empty.textContent = copy.noTools;
    menu.appendChild(empty);
  }

  const separator = document.createElement("div");
  separator.className = "ot-sep";
  menu.appendChild(separator);

  const configItem = document.createElement("button");
  configItem.type = "button";
  configItem.className = "ot-foot-item";
  configItem.setAttribute("role", "menuitem");
  configItem.textContent = copy.menuConfig;
  configItem.addEventListener("click", () => {
    closeMenu();
    void openConfig();
  });
  menu.appendChild(configItem);
  items.push(configItem);

  layer.element.appendChild(menu);
  menuElement = menu;
  positionMenu(menu, anchor);

  const onPointerDown = (event) => {
    const target = event.target;
    if (menu.contains(target) || anchor.contains(target)) return;
    closeMenu();
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      if (typeof anchor.focus === "function") anchor.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = index < 0 ? (step > 0 ? 0 : items.length - 1) : (index + step + items.length) % items.length;
    items[next].focus();
  };
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  menuCleanup = () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
  };
  if (items.length > 0) {
    try {
      items[0].focus({ preventScroll: true });
    } catch {
      items[0].focus();
    }
  }
}

/**
 * Open the menu with the list as it is *now*. The button keeps a copy of the
 * list for its own label, but that copy can be stale in a chat that was opened
 * before the sheet was used in another one, so the list is read again here.
 */
async function openMenuFrom(anchor, fallback) {
  const fresh = await loadToolList();
  const state = fresh || fallback || { status: "failed", root: null, tools: [], message: text().failed };
  if (menuElement) closeMenu();
  openMenu(anchor, state);
  return fresh;
}

// --------------------------------------------------------------- config layer
//
// The list lives in tools.json in the plugin's own data directory, and the main
// process is the only writer: this layer edits a working copy and posts it back
// through `saveToolConfig`, which validates every field again before writing.
// Nothing here can name an executable the main process would not accept.

const DIR_PLACEHOLDER = "{dir}";

let configState = null;

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  const attributes = props || {};
  for (const key of Object.keys(attributes)) {
    const value = attributes[key];
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "value" || key === "checked" || key === "disabled" || key === "selected") node[key] = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    if (Array.isArray(child)) {
      for (const nested of child) if (nested !== undefined && nested !== null) node.appendChild(nested);
      continue;
    }
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function labelForServer(label, fallback, language) {
  if (typeof label === "string") return label;
  if (label && typeof label === "object") return label[language] || label.en || fallback;
  return fallback;
}

function dotClass(status) {
  if (status === "missing" || status === "pending") return "ot-dot ot-dot--missing";
  if (status === "disabled") return "ot-dot ot-dot--disabled";
  return "ot-dot";
}

function statusLabel(status) {
  const copy = configState ? configState.copy : text();
  if (status === "ready") return copy.configStatusReady;
  if (status === "disabled") return copy.configStatusDisabled;
  if (status === "pending") return copy.configStatusPending;
  return copy.configStatusMissing;
}
function splitArgs(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0);
}

function argsText(entry) {
  const args = Array.isArray(entry.args) ? entry.args : Array.isArray(entry.defaultArgs) ? entry.defaultArgs : [DIR_PLACEHOLDER];
  return args.join("\n");
}

/** The stored shape for one working entry; the main process validates it again. */
function toStoredEntry(entry) {
  const stored = { id: entry.id };
  const label = String(entry.label || "").trim();
  if (label && label !== entry.defaultLabel) stored.label = label;
  if (entry.enabled === false) stored.enabled = false;
  const executable = String(entry.executableOverride || "").trim();
  if (executable) stored.executable = executable;
  if (Array.isArray(entry.args)) {
    const same = Array.isArray(entry.defaultArgs) && JSON.stringify(entry.args) === JSON.stringify(entry.defaultArgs);
    if (!same) stored.args = entry.args.slice();
  }
  if (entry.consoleHost && entry.consoleHost !== entry.defaultConsoleHost) stored.consoleHost = entry.consoleHost;
  return stored;
}

function workingEntry(entry, language) {
  return {
    id: entry.id,
    label: labelForServer(entry.label, entry.id, language),
    defaultLabel: entry.defaultLabel || null,
    builtin: entry.builtin === true,
    enabled: entry.enabled !== false,
    status: entry.status || "missing",
    reason: entry.reason || null,
    executable: entry.executable || null,
    executableOverride: entry.executableOverride || "",
    args: Array.isArray(entry.args) ? entry.args.slice() : null,
    defaultArgs: Array.isArray(entry.defaultArgs) ? entry.defaultArgs.slice() : null,
    consoleHost: entry.consoleHost || null,
    defaultConsoleHost: entry.defaultConsoleHost || null,
    expanded: entry.expanded === true
  };
}

/** Adopt a `toolConfig` payload into the open layer's working copy. */
function adoptConfig(payload) {
  if (!configState) return null;
  const language = languageFor((payload && payload.locale) || hostLanguage());
  configState.entries = ((payload && payload.entries) || []).map((entry) => workingEntry(entry, language));
  configState.builtins = (payload && payload.builtins) || [];
  configState.skipped = (payload && payload.skipped) || [];
  configState.project = (payload && payload.project) || null;
  configState.limit = (payload && payload.limit) || 32;
  configState.file = (payload && payload.file) || null;
  return configState;
}

function closeConfig() {
  if (!configState) return;
  const state = configState;
  configState = null;
  if (typeof state.keydown === "function") {
    try {
      state.keydown();
    } catch {
      /* the host may already have torn the layer down */
    }
  }
  try {
    state.layer.close();
  } catch {
    /* the host may already have closed the layer */
  }
}

async function openConfig() {
  closeMenu();
  closeConfig();
  if (!host || !host.ui || typeof host.ui.openLayer !== "function") return;
  let layer;
  try {
    layer = host.ui.openLayer();
  } catch (error) {
    console.warn("[open-tools] openLayer failed", error);
    return;
  }
  configState = {
    layer,
    copy: text(),
    status: "loading",
    entries: [],
    builtins: [],
    skipped: [],
    project: null,
    limit: 32,
    saving: false,
    message: null,
    tone: null,
    add: { kind: "", label: "", executable: "", args: DIR_PLACEHOLDER, consoleHost: false },
    adding: false,
    file: null,
    view: null,
    keydown: null
  };
  renderConfig();

  let payload = null;
  try {
    payload = await requestToolConfig();
  } catch (error) {
    console.warn("[open-tools] toolConfig failed", error);
  }
  if (!configState) return;
  if (payload && payload.ok === true) {
    adoptConfig(payload);
    configState.status = "ready";
  } else {
    configState.status = "error";
    configState.message = (payload && payload.message) || configState.copy.configLoadFailed;
    configState.tone = "error";
  }
  renderConfig();
}

function field(labelText, control, hint, wide) {
  const wrap = el("label", { class: wide ? "ot-field ot-field--wide" : "ot-field" });
  wrap.appendChild(el("span", { class: "ot-field__label", text: labelText }));
  wrap.appendChild(control);
  for (const line of Array.isArray(hint) ? hint : hint ? [hint] : []) {
    wrap.appendChild(el("span", { class: "ot-field__hint", text: line }));
  }
  return wrap;
}

function renderDetail(entry) {
  const copy = configState.copy;
  const detail = el("div", { class: "ot-detail" });
  const fields = el("div", { class: "ot-fields" });

  const executableInput = el("input", {
    class: "ot-input",
    type: "text",
    value: entry.executableOverride,
    placeholder: entry.executable || copy.configExecutablePlaceholder,
    spellcheck: "false"
  });
  executableInput.addEventListener("input", (event) => {
    entry.executableOverride = event.target.value;
  });
  const executableHint = entry.executable ? copy.configFound + " · " + entry.executable : copy.configNotFound;
  fields.appendChild(field(copy.configExecutable, executableInput, [copy.configExecutableHint, executableHint], true));

  const argsArea = el("textarea", { class: "ot-textarea", rows: 3 });
  argsArea.value = argsText(entry);
  argsArea.addEventListener("input", (event) => {
    entry.args = splitArgs(event.target.value);
  });
  const argsHints = [copy.configArgsHint];
  if (!Array.isArray(entry.args) && Array.isArray(entry.defaultArgs)) argsHints.push(copy.configArgsInherited);
  fields.appendChild(field(copy.configArgs, argsArea, argsHints, true));
  detail.appendChild(fields);

  if (entry.builtin) {
    if (entry.defaultConsoleHost) detail.appendChild(el("div", { class: "ot-field__hint", text: copy.configConsoleInfo }));
  } else {
    const consoleLabel = el("label", { class: "ot-check" });
    const consoleBox = el("input", { type: "checkbox" });
    consoleBox.checked = entry.consoleHost === "wt";
    consoleBox.addEventListener("change", (event) => {
      entry.consoleHost = event.target.checked ? "wt" : null;
    });
    consoleLabel.appendChild(consoleBox);
    consoleLabel.appendChild(el("span", { text: copy.configConsole }));
    detail.appendChild(consoleLabel);
  }
  return detail;
}
function renderRow(entry) {
  const state = configState;
  const copy = state.copy;
  const index = state.entries.indexOf(entry);

  const card = el("div", { class: "ot-card" });

  // Order and deletion change the list, so they re-paint it. The switch and the
  // chevron do not: they patch their own card, which keeps the switch's
  // transition and the row's hover state alive instead of flashing.
  const move = el("div", { class: "ot-move" });
  const up = el("button", { type: "button", title: copy.configMoveUp, "aria-label": copy.configMoveUp, text: "▲" });
  up.disabled = index <= 0;
  up.addEventListener("click", () => {
    if (index <= 0) return;
    state.entries.splice(index - 1, 0, state.entries.splice(index, 1)[0]);
    renderConfig();
  });
  const down = el("button", { type: "button", title: copy.configMoveDown, "aria-label": copy.configMoveDown, text: "▼" });
  down.disabled = index < 0 || index >= state.entries.length - 1;
  down.addEventListener("click", () => {
    if (index < 0 || index >= state.entries.length - 1) return;
    state.entries.splice(index + 1, 0, state.entries.splice(index, 1)[0]);
    renderConfig();
  });
  move.appendChild(up);
  move.appendChild(down);

  const dot = el("span", { class: dotClass(entry.enabled === false ? "disabled" : entry.status) });
  const applyStatus = () => {
    const status = entry.enabled === false ? "disabled" : entry.status;
    card.dataset.status = status;
    dot.className = dotClass(status);
    dot.title = statusLabel(status);
  };
  applyStatus();

  const main = el("div", { class: "ot-row__main" });
  const top = el("div", { class: "ot-row__top" });
  const labelInput = el("input", {
    class: "ot-name",
    type: "text",
    value: entry.label,
    "aria-label": copy.configName,
    title: copy.configName,
    spellcheck: "false"
  });
  labelInput.size = Math.min(Math.max(String(entry.label || "").length || 8, 8), 34);
  labelInput.addEventListener("input", (event) => {
    entry.label = event.target.value;
  });
  top.appendChild(labelInput);
  top.appendChild(el("span", { class: "ot-tag", text: entry.builtin ? copy.configBuiltin : copy.configCustom }));
  main.appendChild(top);
  main.appendChild(el("div", { class: "ot-meta", text: entry.executable || copy.configNotFound }));
  if (entry.reason) main.appendChild(el("div", { class: "ot-reason", text: entry.reason }));

  const switchLabel = el("label", { class: "ot-switch", title: copy.configInMenu });
  const toggle = el("input", { type: "checkbox", "aria-label": copy.configInMenu });
  toggle.checked = entry.enabled !== false;
  toggle.addEventListener("change", (event) => {
    entry.enabled = event.target.checked;
    applyStatus();
  });
  switchLabel.appendChild(toggle);
  switchLabel.appendChild(el("span", {}));

  const details = el("button", {
    type: "button",
    class: "ot-icon",
    title: entry.expanded ? copy.configHideDetails : copy.configDetails,
    "aria-label": copy.configDetails,
    "aria-expanded": entry.expanded ? "true" : "false",
    text: entry.expanded ? "▴" : "▾"
  });
  details.addEventListener("click", () => {
    entry.expanded = !entry.expanded;
    if (entry.expanded) {
      card.appendChild(renderDetail(entry));
    } else {
      const detail = card.querySelector(".ot-detail");
      if (detail && detail.parentNode) detail.parentNode.removeChild(detail);
    }
    details.textContent = entry.expanded ? "▴" : "▾";
    details.title = entry.expanded ? copy.configHideDetails : copy.configDetails;
    details.setAttribute("aria-expanded", entry.expanded ? "true" : "false");
  });

  const remove = el("button", {
    type: "button",
    class: "ot-icon ot-icon--danger",
    title: copy.configRemove,
    "aria-label": copy.configRemove,
    text: "✕"
  });
  remove.addEventListener("click", () => {
    const position = state.entries.indexOf(entry);
    if (position >= 0) state.entries.splice(position, 1);
    renderConfig();
  });

  card.appendChild(el("div", { class: "ot-row" }, move, dot, main, switchLabel, details, remove));
  if (entry.expanded) card.appendChild(renderDetail(entry));
  return card;
}
function makeId(label, executable, entries) {
  let source = String(label || "").trim();
  if (!source && executable) source = String(executable).split(/[\\/]/).pop().replace(/\.exe$/i, "");
  if (!source) source = "tool";
  let base = source
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  if (!/^[a-z]/.test(base)) base = "tool" + (base ? "-" + base : "");
  base = base.replace(/-+$/, "");
  if (!base) base = "tool";
  let candidate = base;
  let suffix = 2;
  while (entries.some((entry) => entry.id === candidate)) {
    candidate = base + "-" + suffix;
    suffix += 1;
  }
  return candidate;
}

function renderAddForm() {
  const state = configState;
  const copy = state.copy;
  const form = state.add;
  const wrap = el("div", { class: "ot-add" });
  wrap.appendChild(el("div", { class: "ot-add__title", text: copy.configAdd }));

  const missing = state.builtins.filter((builtin) => !state.entries.some((entry) => entry.id === builtin.id));
  const select = el("select", { class: "ot-select", "aria-label": copy.configAdd });
  select.appendChild(el("option", { value: "", text: copy.configPick }));
  for (const builtin of missing) {
    const option = el("option", { value: builtin.id, text: builtin.label + "  (" + builtin.id + ")" });
    if (form.kind === builtin.id) option.selected = true;
    select.appendChild(option);
  }
  const customOption = el("option", { value: "custom", text: copy.configAddCustom });
  if (form.kind === "custom") customOption.selected = true;
  select.appendChild(customOption);
  select.addEventListener("change", (event) => {
    form.kind = event.target.value;
    renderConfig();
  });
  wrap.appendChild(select);

  if (form.kind === "custom") {
    const fields = el("div", { class: "ot-fields" });

    const nameInput = el("input", { class: "ot-input", type: "text", value: form.label, placeholder: copy.configNameHint, spellcheck: "false" });
    nameInput.addEventListener("input", (event) => {
      form.label = event.target.value;
    });
    fields.appendChild(field(copy.configName, nameInput));

    const exeInput = el("input", {
      class: "ot-input",
      type: "text",
      value: form.executable,
      placeholder: copy.configExecutablePlaceholder,
      spellcheck: "false"
    });
    exeInput.addEventListener("input", (event) => {
      form.executable = event.target.value;
    });
    fields.appendChild(field(copy.configExecutable, exeInput));
    wrap.appendChild(fields);
    wrap.appendChild(el("div", { class: "ot-field__hint", text: copy.configExecutableHint }));

    const argsArea = el("textarea", { class: "ot-textarea", rows: 2 });
    argsArea.value = form.args;
    argsArea.addEventListener("input", (event) => {
      form.args = event.target.value;
    });
    const argsField = field(copy.configArgs, argsArea, copy.configArgsHint, true);
    wrap.appendChild(argsField);

    const consoleLabel = el("label", { class: "ot-check" });
    const consoleBox = el("input", { type: "checkbox" });
    consoleBox.checked = form.consoleHost === true;
    consoleBox.addEventListener("change", (event) => {
      form.consoleHost = event.target.checked;
    });
    consoleLabel.appendChild(consoleBox);
    consoleLabel.appendChild(el("span", { text: copy.configConsole }));
    wrap.appendChild(consoleLabel);
  }

  const actions = el("div", { class: "ot-add__row" });
  const addButton = el("button", { type: "button", class: "ot-button ot-button--primary", text: copy.configAddAction });
  addButton.disabled = !form.kind;
  addButton.addEventListener("click", () => addFromForm());
  actions.appendChild(addButton);
  const cancelButton = el("button", { type: "button", class: "ot-button ot-button--ghost", text: copy.configCancel });
  cancelButton.addEventListener("click", () => {
    resetAddForm(state);
    state.adding = false;
    renderConfig();
  });
  actions.appendChild(cancelButton);
  wrap.appendChild(actions);
  return wrap;
}
function resetAddForm(state) {
  state.add = { kind: "", label: "", executable: "", args: DIR_PLACEHOLDER, consoleHost: false };
}

function addFromForm() {
  const state = configState;
  if (!state) return;
  const form = state.add;
  if (form.kind === "custom") {
    const label = String(form.label || "").trim();
    const executable = String(form.executable || "").trim();
    const args = splitArgs(form.args);
    const id = makeId(label, executable, state.entries);
    state.entries.push({
      id,
      label: label || id,
      defaultLabel: null,
      builtin: false,
      enabled: true,
      status: "pending",
      reason: null,
      executable: executable || null,
      executableOverride: executable,
      args: args.length > 0 ? args : [DIR_PLACEHOLDER],
      defaultArgs: null,
      consoleHost: form.consoleHost ? "wt" : null,
      defaultConsoleHost: null,
      expanded: true
    });
  } else if (form.kind) {
    const builtin = state.builtins.find((candidate) => candidate.id === form.kind);
    state.entries.push({
      id: form.kind,
      label: builtin ? builtin.label : form.kind,
      defaultLabel: builtin ? builtin.label : null,
      builtin: true,
      enabled: true,
      status: "pending",
      reason: null,
      executable: null,
      executableOverride: "",
      args: null,
      defaultArgs: null,
      consoleHost: builtin ? builtin.consoleHost : null,
      defaultConsoleHost: builtin ? builtin.consoleHost : null,
      expanded: false
    });
  } else {
    return;
  }
  resetAddForm(state);
  state.adding = false;
  state.message = null;
  state.tone = null;
  renderConfig();
}
/**
 * The sheet is built once and then patched. Rebuilding it on every click would
 * replay the entry animation and drop the switch's own transition, which reads
 * as a flicker; the head, the list and the footer are therefore painted into
 * containers that already exist.
 */
function ensureConfigShell() {
  const state = configState;
  if (!state) return null;
  if (state.view) return state.view;
  const copy = state.copy;
  const head = el("div", { class: "ot-sheet__head" });
  const body = el("div", { class: "ot-sheet__body" });
  const foot = el("div", { class: "ot-sheet__foot" });
  const sheet = el(
    "div",
    { class: "ot-sheet", role: "dialog", "aria-modal": "true", "aria-label": copy.configTitle },
    head,
    body,
    foot
  );
  const backdrop = el("div", { class: "ot-backdrop" }, sheet);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeConfig();
  });
  try {
    state.layer.element.appendChild(backdrop);
  } catch (error) {
    console.warn("[open-tools] could not draw the sheet", error);
    return null;
  }
  state.root = backdrop;
  state.view = { head, body, foot, sheet, backdrop };
  const onKeyDown = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeConfig();
  };
  document.addEventListener("keydown", onKeyDown, true);
  state.keydown = () => document.removeEventListener("keydown", onKeyDown, true);
  return state.view;
}

function clearNode(node) {
  try {
    node.textContent = "";
  } catch {
    /* the host element only accepts appends */
  }
}

function paintHead(view) {
  const state = configState;
  const copy = state.copy;
  clearNode(view.head);

  const heading = el("div", { class: "ot-sheet__heading" });
  heading.appendChild(el("div", { class: "ot-sheet__title", text: copy.configTitle }));
  heading.appendChild(el("div", { class: "ot-sheet__sub", text: copy.configIntro }));
  heading.title = state.file || "";
  view.head.appendChild(heading);

  const addButton = el("button", {
    type: "button",
    class: state.adding ? "ot-button ot-button--ghost" : "ot-button",
    text: state.adding ? copy.configCancel : "＋ " + copy.configAddOpen
  });
  addButton.disabled = state.status !== "ready";
  addButton.addEventListener("click", () => {
    state.adding = !state.adding;
    if (!state.adding) resetAddForm(state);
    state.message = null;
    state.tone = null;
    renderConfig();
  });
  view.head.appendChild(addButton);

  const closeButton = el("button", {
    type: "button",
    class: "ot-icon",
    title: copy.configClose,
    "aria-label": copy.configClose,
    text: "✕"
  });
  closeButton.addEventListener("click", () => closeConfig());
  view.head.appendChild(closeButton);
}

function paintBody(view) {
  const state = configState;
  const copy = state.copy;
  clearNode(view.body);

  if (state.status === "loading") {
    view.body.appendChild(el("div", { class: "ot-empty", text: copy.configLoading }));
    return;
  }
  if (state.status === "error") {
    view.body.appendChild(el("div", { class: "ot-warn", text: state.message || copy.configLoadFailed }));
    return;
  }
  if (state.skipped.length > 0) {
    const warn = el("div", { class: "ot-warn" });
    warn.appendChild(el("div", { text: copy.configIgnored }));
    for (const reason of state.skipped) warn.appendChild(el("div", { text: "· " + reason }));
    view.body.appendChild(warn);
  }
  const list = el("div", { class: "ot-list" });
  if (state.entries.length === 0) list.appendChild(el("div", { class: "ot-empty", text: copy.configEmpty }));
  for (const entry of state.entries.slice()) list.appendChild(renderRow(entry));
  view.body.appendChild(list);
  if (state.adding) view.body.appendChild(renderAddForm());
  if (state.entries.length >= state.limit) {
    view.body.appendChild(
      el("div", { class: "ot-field__hint", text: copy.configLimit.replace("{count}", String(state.limit)) })
    );
  }
}

function paintFoot(view) {
  const state = configState;
  const copy = state.copy;
  clearNode(view.foot);

  if (state.message) {
    view.foot.appendChild(
      el("span", {
        class: state.tone === "error" ? "ot-msg ot-msg--error" : "ot-msg ot-msg--ok",
        text: state.message,
        title: state.message
      })
    );
  } else {
    view.foot.appendChild(el("span", { class: "ot-spacer" }));
  }
  const resetButton = el("button", { type: "button", class: "ot-button ot-button--ghost", text: copy.configReset });
  resetButton.disabled = state.saving || state.status !== "ready";
  resetButton.addEventListener("click", () => void commitConfig(null, true));
  view.foot.appendChild(resetButton);
  const cancelButton = el("button", { type: "button", class: "ot-button ot-button--ghost", text: copy.configCancel });
  cancelButton.addEventListener("click", () => closeConfig());
  view.foot.appendChild(cancelButton);
  const saveButton = el("button", {
    type: "button",
    class: "ot-button ot-button--primary",
    text: state.saving ? copy.configSaving : copy.configSave
  });
  saveButton.disabled = state.saving || state.status !== "ready";
  saveButton.addEventListener("click", () => void commitConfig(state.entries.map(toStoredEntry), false));
  view.foot.appendChild(saveButton);
}

function renderConfig() {
  if (!configState) return;
  const view = ensureConfigShell();
  if (!view) return;
  paintHead(view);
  paintBody(view);
  paintFoot(view);
}
async function commitConfig(entries, reset) {
  const state = configState;
  if (!state || state.saving) return;
  state.saving = true;
  state.message = null;
  state.tone = null;
  renderConfig();
  let answer;
  try {
    answer = reset ? await resetToolConfig() : await saveToolConfig(entries);
  } catch (error) {
    answer = { ok: false, error: "CALL_FAILED", message: String((error && error.message) || error) };
  }
  if (!configState) return;
  configState.saving = false;
  if (answer && answer.ok === true) {
    adoptConfig(answer);
    configState.status = "ready";
    // Saving is the whole point of the sheet: it closes on success, like any
    // other dialog. A failed save stays open with the reason instead.
    closeConfig();
    return;
  }
  configState.message = (answer && answer.message) || state.copy.configSaveFailed;
  configState.tone = "error";
  renderConfig();
}
function icon() {
  return React.createElement(
    "svg",
    {
      width: 16,
      height: 16,
      viewBox: "0 0 16 16",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.4,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      focusable: "false"
    },
    React.createElement("path", { d: "M6.3 3.7H4.6a1.9 1.9 0 0 0-1.9 1.9v5.8a1.9 1.9 0 0 0 1.9 1.9h5.8a1.9 1.9 0 0 0 1.9-1.9V9.7" }),
    React.createElement("path", { d: "M9.6 2.7h3.7v3.7" }),
    React.createElement("path", { d: "M13.3 2.7 7.6 8.4" })
  );
}

function caret() {
  return React.createElement(
    "svg",
    {
      className: "ot-btn__caret",
      width: 8,
      height: 8,
      viewBox: "0 0 8 8",
      fill: "currentColor",
      "aria-hidden": "true",
      focusable: "false"
    },
    React.createElement("path", { d: "M1 3h6L4 6.2z" })
  );
}

function OpenToolsButton() {
  const [state, setState] = React.useState({ status: "loading", root: null, tools: [], message: null });
  const buttonRef = React.useRef(null);
  const aliveRef = React.useRef(true);

  const load = React.useCallback(async () => {
    const next = await loadToolList();
    if (aliveRef.current) setState(next);
    return next;
  }, []);

  React.useEffect(() => {
    aliveRef.current = true;
    void load();
    return () => {
      aliveRef.current = false;
      closeMenu();
    };
  }, [load]);

  const copy = text();
  const hasTools = state.tools.length > 0;
  // Only while the list is still arriving: an empty menu must stay reachable,
  // because "Configure tools…" lives in it.
  const disabled = state.status === "loading";
  let title = copy.title;
  if (state.status === "loading") title = copy.loading;
  else if (!hasTools) title = state.message || copy.noTools;
  else if (state.root) title = copy.title + " — " + state.root;

  return React.createElement(
    "button",
    {
      ref: buttonRef,
      type: "button",
      className: "ot-btn",
      title,
      "aria-label": title,
      "aria-haspopup": "menu",
      "aria-expanded": false,
      disabled,
      onClick: async () => {
        if (!buttonRef.current || !aliveRef.current) return;
        if (menuElement) {
          closeMenu();
          return;
        }
        const fresh = await openMenuFrom(buttonRef.current, state);
        if (fresh && aliveRef.current) setState(fresh);
      }
    },
    icon(),
    caret()
  );
}

export function onLoad(pi) {
  host = pi;
  try {
    styleDisposer = pi.ui.injectStyle(STYLE);
  } catch (error) {
    console.warn("[open-tools] injectStyle failed", error);
  }
  pi.slots.register({ slot: "composerControl", positions: ["left"], component: OpenToolsButton });
}

export function onUnload() {
  closeMenu();
  if (typeof styleDisposer === "function") {
    try {
      styleDisposer();
    } catch {
      /* the host disposes styles on unload as well */
    }
  }
  styleDisposer = null;
  host = null;
}

/** Test surface for scripts/selftest.mjs — never used by the host. */
export const __test = {
  PLUGIN_ID,
  TEXT,
  STYLE,
  DIR_PLACEHOLDER,
  OpenToolsButton,
  languageFor,
  dispatchPluginCall,
  requestTools,
  loadToolList,
  requestToolConfig,
  saveToolConfig,
  resetToolConfig,
  openTool,
  choose,
  openMenu,
  openMenuFrom,
  closeMenu,
  openConfig,
  closeConfig,
  renderConfig,
  adoptConfig,
  toStoredEntry,
  makeId,
  splitArgs,
  configEntries: () => (configState ? configState.entries.map((entry) => ({ ...entry })) : []),
  configMessage: () => (configState ? configState.message : null),
  configView: () => (configState ? configState.view : null),
  commit: () => (configState ? configState.entries : []),
  saveNow: () => (configState ? commitConfig(configState.entries.map(toStoredEntry), false) : Promise.resolve()),
  text
};

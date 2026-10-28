#!/usr/bin/env node
/**
 * Build dist/<id>-<version>.piplug.
 *
 * A `.piplug` is a **store-only (uncompressed) zip**: every entry has
 * compression method 0, because the installer rejects deflated entries. The
 * host's own `PluginPack` tool does this; it is not available in every session,
 * so this script writes the archive itself — local file headers, a central
 * directory and the end record, nothing else.
 *
 * What goes in is the *runtime*, nothing else: manifest.json plus every file the
 * manifest points at (main, renderer, panel, skills, themes, views, agent
 * extensions). The repository is never walked, so `scripts/`, `README.md`,
 * `.git*` and the host's `.pi` folder cannot leak into a published package — the
 * marketplace audit reads every packaged file and refuses a plugin whose tools
 * ship dynamic module loading.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every path the manifest references, as package-relative names. */
function shippedPaths(manifest) {
  const paths = new Set(["manifest.json"]);
  const add = (value) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    paths.add(trimmed.replace(/\\/g, "/").replace(/^\.\//, ""));
  };

  add(manifest.main);
  add(manifest.renderer);
  add(manifest.ui && manifest.ui.panel);

  const contributes = manifest.contributes || {};
  for (const skill of contributes.skills || []) add(typeof skill === "string" ? skill : skill && skill.path);
  for (const extension of contributes.agentExtensions || []) add(extension);
  for (const theme of contributes.themes || []) add(theme && theme.path);
  for (const view of Object.values(contributes.views || {})) add(typeof view === "string" ? view : view && view.entry);

  return [...paths].sort();
}

/** Resolve every shipped path, refusing anything outside the plugin directory. */
function resolveShippedFiles(paths) {
  const files = [];
  for (const archiveName of paths) {
    const absolutePath = resolve(pluginRoot, archiveName);
    const inside = relative(pluginRoot, absolutePath);
    if (!inside || inside.startsWith("..") || isAbsolute(inside) || inside.split(sep).includes("..")) {
      throw new Error("manifest references a path outside the plugin: " + archiveName);
    }
    if (!existsSync(absolutePath)) {
      throw new Error("manifest references a file that does not exist: " + archiveName);
    }
    const info = statSync(absolutePath);
    if (!info.isFile()) throw new Error("manifest references something that is not a file: " + archiveName);
    files.push({ archiveName, absolutePath, mtime: info.mtime });
  }
  return files;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function dosTimestamp(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function buildStoreOnlyZip(entries) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.archiveName, "utf8");
    const data = entry.data;
    const crc = crc32(data);
    const stamp = dosTimestamp(entry.mtime);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 names
    localHeader.writeUInt16LE(0, 8); // method 0: stored
    localHeader.writeUInt16LE(stamp.time, 10);
    localHeader.writeUInt16LE(stamp.date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localChunks.push(localHeader, nameBytes, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(stamp.time, 12);
    centralHeader.writeUInt16LE(stamp.date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file, 0644
    centralHeader.writeUInt32LE(offset, 42);
    centralChunks.push(centralHeader, nameBytes);

    offset += localHeader.length + nameBytes.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDirectory, end]);
}

const manifest = JSON.parse(readFileSync(join(pluginRoot, "manifest.json"), "utf8"));
let files;
try {
  files = resolveShippedFiles(shippedPaths(manifest));
} catch (error) {
  console.error("FAIL: " + String((error && error.message) || error));
  process.exit(1);
}
if (!files.some((file) => file.archiveName === "manifest.json")) {
  console.error("FAIL: manifest.json is not part of the package");
  process.exit(1);
}

const entries = files.map((file) => ({
  archiveName: file.archiveName,
  data: readFileSync(file.absolutePath),
  mtime: file.mtime
}));

const archive = buildStoreOnlyZip(entries);
const outputDirectory = join(pluginRoot, "dist");
const outputPath = join(outputDirectory, `${manifest.id}-${manifest.version}.piplug`);
if (!existsSync(outputDirectory)) mkdirSync(outputDirectory, { recursive: true });
writeFileSync(outputPath, archive);

console.log(`packed ${entries.length} files into ${outputPath}`);
console.log(`stored (uncompressed) size: ${archive.length} bytes`);
for (const entry of entries) console.log("  " + entry.archiveName + "  " + entry.data.length + " bytes");
const skipped = ["scripts/", "README.md", ".git/", "dist/"].join(", ");
console.log(`not packaged (runtime only): ${skipped}`);

#!/usr/bin/env node
/**
 * Check dist/<id>-<version>.piplug the way the installer reads it.
 *
 * A `.piplug` must be a **store-only** zip: the host rejects deflated entries.
 * This script parses the archive itself (end record → central directory → local
 * headers), so nothing is assumed:
 *
 *   - every entry has compression method 0 and is not encrypted;
 *   - names are relative, forward-slashed, contain no `..`, no drive letter and
 *     no `.git` / `node_modules` / `dist` segment;
 *   - no entry is a symlink or a directory record;
 *   - each entry's CRC and length match the stored bytes, and the stored bytes
 *     are exactly the file on disk;
 *   - `manifest.json` is the first thing the installer needs, and the id and
 *     version inside it match the archive name;
 *   - at most 2000 entries and at most 50 MB uncompressed;
 *   - the archive holds **exactly** the files the manifest references — no
 *     `scripts/`, no `README.md`, no `.git*` (the marketplace audit reads every
 *     packaged file);
 *   - packaged `.js/.mjs/.cjs` files contain no dynamic or remote code
 *     execution (`import(...)`, `eval(...)`, `new Function(...)`,
 *     `importScripts(...)`, a computed `require(...)`), which is what SEC003
 *     refuses.
 *
 * Exit code 0 means every rule passed.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(pluginRoot, "manifest.json"), "utf8"));
const archivePath = join(pluginRoot, "dist", `${manifest.id}-${manifest.version}.piplug`);

const MAX_ENTRIES = 2000;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const FORBIDDEN_SEGMENTS = new Set([".git", "node_modules", "dist"]);
/** Development-only things that must never reach a published package. */
const DEVELOPMENT_ENTRY = /^(scripts\/|\.git|README\.md$)/i;

/** File types the marketplace audit reads as code. */
const SCANNED_EXTENSIONS = [".js", ".mjs", ".cjs"];

/**
 * The audit (SEC003) refuses "dynamic or remote code execution". Same shape of
 * check, applied here so a rejected upload is never a surprise.
 */
const DYNAMIC_CODE_RULES = [
  { label: "dynamic module loading", pattern: /\bimport\s*\(/ },
  { label: "eval", pattern: /(^|[^.\w$])eval\s*\(/ },
  { label: "new Function", pattern: /\bnew\s+Function\s*\(/ },
  { label: "importScripts", pattern: /\bimportScripts\s*\(/ },
  { label: "require with a computed specifier", pattern: /\brequire\s*\(\s*[^"'`\s)]/ }
];

/**
 * Every path the manifest points at. Mirrors scripts/pack.mjs: a package holds
 * the runtime and nothing else.
 */
function shippedPaths(source) {
  const paths = new Set(["manifest.json"]);
  const add = (value) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    paths.add(trimmed.replace(/\\/g, "/").replace(/^\.\//, ""));
  };
  add(source.main);
  add(source.renderer);
  add(source.ui && source.ui.panel);
  const contributes = source.contributes || {};
  for (const skill of contributes.skills || []) add(typeof skill === "string" ? skill : skill && skill.path);
  for (const extension of contributes.agentExtensions || []) add(extension);
  for (const theme of contributes.themes || []) add(theme && theme.path);
  for (const view of Object.values(contributes.views || {})) add(typeof view === "string" ? view : view && view.entry);
  return [...paths].sort();
}


const failures = [];
const passes = [];
function check(condition, message) {
  if (condition) passes.push(message);
  else failures.push(message);
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

function readEntry(archive, entry) {
  const localNameLength = archive.readUInt16LE(entry.localOffset + 26);
  const localExtraLength = archive.readUInt16LE(entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + localNameLength + localExtraLength;
  return archive.subarray(dataStart, dataStart + entry.uncompressedSize);
}

function findEndRecord(buffer) {
  const lowest = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= lowest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return {
        entriesOnDisk: buffer.readUInt16LE(offset + 8),
        entries: buffer.readUInt16LE(offset + 10),
        centralSize: buffer.readUInt32LE(offset + 12),
        centralOffset: buffer.readUInt32LE(offset + 16),
        commentLength: buffer.readUInt16LE(offset + 20),
        offset
      };
    }
  }
  return null;
}

check(existsSync(archivePath), `the package exists (${archivePath})`);

if (existsSync(archivePath)) {
  const archive = readFileSync(archivePath);
  const end = findEndRecord(archive);
  check(Boolean(end), "the archive ends with a valid zip end-of-central-directory record");

  if (end) {
    check(end.commentLength === 0, "the archive carries no zip comment");
    check(end.entries === end.entriesOnDisk, "the entry counts in the end record agree");
    check(end.entries > 0, "the archive holds at least one entry");
    check(end.entries <= MAX_ENTRIES, `at most ${MAX_ENTRIES} entries (found ${end.entries})`);
    check(
      end.centralOffset + end.centralSize === end.offset,
      "the central directory sits exactly where the end record says"
    );

    const entries = [];
    let cursor = end.centralOffset;
    let centralProblem = null;
    for (let index = 0; index < end.entries; index += 1) {
      if (archive.readUInt32LE(cursor) !== 0x02014b50) {
        centralProblem = `entry ${index} has no central directory header at ${cursor}`;
        break;
      }
      const flags = archive.readUInt16LE(cursor + 8);
      const method = archive.readUInt16LE(cursor + 10);
      const crc = archive.readUInt32LE(cursor + 16);
      const compressedSize = archive.readUInt32LE(cursor + 20);
      const uncompressedSize = archive.readUInt32LE(cursor + 24);
      const nameLength = archive.readUInt16LE(cursor + 28);
      const extraLength = archive.readUInt16LE(cursor + 30);
      const commentLength = archive.readUInt16LE(cursor + 32);
      const externalAttributes = archive.readUInt32LE(cursor + 38);
      const localOffset = archive.readUInt32LE(cursor + 42);
      const name = archive.toString("utf8", cursor + 46, cursor + 46 + nameLength);
      entries.push({
        name,
        flags,
        method,
        crc,
        compressedSize,
        uncompressedSize,
        externalAttributes,
        localOffset,
        extraLength
      });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    check(centralProblem === null, "every central directory header parses", centralProblem || "");

    const names = new Set();
    let totalBytes = 0;
    for (const entry of entries) {
      totalBytes += entry.uncompressedSize;
      check(entry.method === 0, `${entry.name}: stored, not compressed (method ${entry.method})`);
      check((entry.flags & 0x1) === 0, `${entry.name}: not encrypted`);
      check(!entry.name.includes("\\"), `${entry.name}: uses forward slashes only`);
      check(!entry.name.startsWith("/") && !/^[a-zA-Z]:/.test(entry.name), `${entry.name}: relative path`);
      check(!entry.name.split("/").includes(".."), `${entry.name}: no ".." segment`);
      check(!entry.name.endsWith("/"), `${entry.name}: a file entry, not a directory record`);
      check(!entry.name.split("/").some((segment) => FORBIDDEN_SEGMENTS.has(segment)), `${entry.name}: outside the excluded folders`);
      const unixMode = (entry.externalAttributes >>> 16) & 0xffff;
      check((unixMode & 0xf000) !== 0xa000, `${entry.name}: not a symlink`);
      check(entry.compressedSize === entry.uncompressedSize, `${entry.name}: stored size equals file size`);
      check(!names.has(entry.name), `${entry.name}: appears once`);
      names.add(entry.name);

      // The stored bytes: local header → name → data.
      const localNameLength = archive.readUInt16LE(entry.localOffset + 26);
      const localExtraLength = archive.readUInt16LE(entry.localOffset + 28);
      const dataStart = entry.localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + entry.uncompressedSize;
      const stored = archive.subarray(dataStart, dataEnd);
      check(archive.readUInt32LE(entry.localOffset) === 0x04034b50, `${entry.name}: local header present`);
      check(archive.readUInt16LE(entry.localOffset + 8) === 0, `${entry.name}: local header also says stored`);
      check(crc32(stored) === entry.crc, `${entry.name}: CRC matches the stored bytes`);

      const onDisk = join(pluginRoot, entry.name);
      if (existsSync(onDisk)) {
        const disk = readFileSync(onDisk);
        check(disk.length === entry.uncompressedSize && Buffer.compare(disk, stored) === 0, `${entry.name}: identical to the file on disk`);
      } else {
        check(false, `${entry.name}: exists in the plugin directory too`);
      }
    }

    check(
      entries.length <= MAX_ENTRIES,
      `at most ${MAX_ENTRIES} entries (found ${entries.length})`
    );
    check(
      totalBytes <= MAX_TOTAL_BYTES,
      `at most 50 MB uncompressed (found ${totalBytes} bytes)`
    );
    const packagedNames = [...names].sort();
    // --- the package is the runtime, and only the runtime ---------------
    // The audit reads every packaged file, so one stray dev script (a harness
    // that calls import() on a path, say) is enough to reject the upload.
    const expected = shippedPaths(manifest);
    check(
      packagedNames.length === expected.length && packagedNames.every((name, index) => name === expected[index]),
      `the package holds exactly the files the manifest references (${expected.join(", ")})`
    );
    for (const name of packagedNames) {
      check(!DEVELOPMENT_ENTRY.test(name), `${name}: the package ships no development files`);
    }

    // Same shape of scan the marketplace audit applies, before uploading.
    let scannedFiles = 0;
    for (const entry of entries) {
      const lower = entry.name.toLowerCase();
      if (!SCANNED_EXTENSIONS.some((extension) => lower.endsWith(extension))) continue;
      scannedFiles += 1;
      const lines = readEntry(archive, entry).toString("utf8").split(/\r?\n/);
      let findings = 0;
      for (let index = 0; index < lines.length; index += 1) {
        for (const rule of DYNAMIC_CODE_RULES) {
          if (!rule.pattern.test(lines[index])) continue;
          findings += 1;
          check(false, `${entry.name}:${index + 1}: the audit would flag this (${rule.label})`);
        }
      }
      check(findings === 0, `${entry.name}: no dynamic or remote code execution`);
    }
    check(scannedFiles > 0, `the scan covered the packaged code (${scannedFiles} files)`);


    const manifestEntry = entries.find((entry) => entry.name === "manifest.json");
    check(Boolean(manifestEntry), "manifest.json is in the archive");
    if (manifestEntry) {
      const localNameLength = archive.readUInt16LE(manifestEntry.localOffset + 26);
      const localExtraLength = archive.readUInt16LE(manifestEntry.localOffset + 28);
      const dataStart = manifestEntry.localOffset + 30 + localNameLength + localExtraLength;
      const text = archive.toString("utf8", dataStart, dataStart + manifestEntry.uncompressedSize);
      let packaged = null;
      try {
        packaged = JSON.parse(text);
        check(true, "the packaged manifest.json parses");
      } catch (error) {
        check(false, "the packaged manifest.json parses: " + String((error && error.message) || error));
      }
      if (packaged) {
        check(packaged.id === manifest.id, `the packaged id is ${manifest.id}`);
        check(packaged.version === manifest.version, `the packaged version is ${manifest.version}`);
        check(packaged.main === manifest.main, `the packaged entry point is ${manifest.main}`);
      }
      const expectedName = `${manifest.id}-${manifest.version}.piplug`;
      check(
        archivePath.endsWith(expectedName),
        `the archive is named <id>-<version>.piplug (${expectedName})`
      );
      check(
        entries.some((entry) => entry.name === manifest.renderer),
        `the renderer entry is packaged (${manifest.renderer})`
      );
    }
  }
}

for (const message of passes) console.log("ok   " + message);
for (const message of failures) console.error("FAIL " + message);
console.log("");
console.log(`${passes.length} passed, ${failures.length} failed`);
if (failures.length > 0) {
  process.exitCode = 1;
} else {
  console.log("package OK");
}

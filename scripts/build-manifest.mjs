#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const manifestPath = path.join(rootDir, "build-manifest.json");

const command = process.argv[2];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getByPath(value, keyPath) {
  return keyPath.split(".").reduce((current, key) => current?.[key], value);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function syncPackageVersion(filePath, expectedVersion) {
  const pkg = readJson(filePath);
  if (pkg.version === expectedVersion) {
    return false;
  }
  pkg.version = expectedVersion;
  writeJson(filePath, pkg);
  return true;
}

function syncTauriVersion(filePath, expectedVersion) {
  const config = readJson(filePath);
  if (config.version === expectedVersion) {
    return false;
  }
  config.version = expectedVersion;
  writeJson(filePath, config);
  return true;
}

function syncCargoVersion(filePath, expectedVersion) {
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  let inPackage = false;
  let changed = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\[package\]\s*$/.test(line)) {
      inPackage = true;
      continue;
    }
    if (inPackage && /^\[.*\]\s*$/.test(line)) {
      inPackage = false;
    }
    if (inPackage && /^version = ".+"$/.test(line)) {
      const expectedLine = `version = "${expectedVersion}"`;
      if (line !== expectedLine) {
        lines[i] = expectedLine;
        changed = true;
      }
      break;
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, `${lines.join("\n").replace(/\n?$/, "\n")}`);
  }

  return changed;
}

function syncTextFile(filePath, expectedContent) {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const normalized = `${expectedContent}\n`;
  if (current === normalized) {
    return false;
  }
  fs.writeFileSync(filePath, normalized);
  return true;
}

function syncFiles({ check }) {
  const manifest = readJson(manifestPath);
  const expectedVersion = manifest.appVersion;
  const expectedNodeVersion = manifest.runtime.node.version;
  const targets = [
    {
      label: "package.json",
      filePath: path.join(rootDir, "package.json"),
      sync: (filePath) => syncPackageVersion(filePath, expectedVersion),
    },
    {
      label: "src-tauri/tauri.conf.json",
      filePath: path.join(rootDir, "src-tauri", "tauri.conf.json"),
      sync: (filePath) => syncTauriVersion(filePath, expectedVersion),
    },
    {
      label: "src-tauri/Cargo.toml",
      filePath: path.join(rootDir, "src-tauri", "Cargo.toml"),
      sync: (filePath) => syncCargoVersion(filePath, expectedVersion),
    },
    {
      label: ".nvmrc",
      filePath: path.join(rootDir, ".nvmrc"),
      sync: (filePath) => syncTextFile(filePath, expectedNodeVersion),
    },
  ];

  const changed = [];
  for (const target of targets) {
    if (target.sync(target.filePath)) {
      changed.push(target.label);
    }
  }

  if (check) {
    if (changed.length > 0) {
      console.error(
        `build-manifest drift detected. Run "node scripts/build-manifest.mjs sync".\n${changed
          .map((label) => `- ${label}`)
          .join("\n")}`
      );
      process.exit(1);
    }
    console.log("build-manifest is in sync");
    return;
  }

  if (changed.length === 0) {
    console.log("build-manifest already synced");
    return;
  }

  console.log(`synced build-manifest to:\n${changed.map((label) => `- ${label}`).join("\n")}`);
}

if (command === "get") {
  const keyPath = process.argv[3];
  if (!keyPath) {
    console.error("Usage: node scripts/build-manifest.mjs get <path>");
    process.exit(1);
  }

  const manifest = readJson(manifestPath);
  const value = getByPath(manifest, keyPath);
  if (value === undefined) {
    console.error(`Unknown manifest path: ${keyPath}`);
    process.exit(1);
  }

  if (typeof value === "object") {
    console.log(JSON.stringify(value));
  } else {
    console.log(value);
  }
} else if (command === "sync") {
  syncFiles({ check: false });
} else if (command === "check") {
  syncFiles({ check: true });
} else {
  console.error("Usage: node scripts/build-manifest.mjs <get|sync|check> [args]");
  process.exit(1);
}

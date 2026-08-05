#!/usr/bin/env node
/**
 * Stage the compiled ZK artifacts where the browser can fetch them.
 *
 * In Node the SDK reads prover keys and ZKIR straight off disk
 * (NodeZkConfigProvider). In the browser it fetches them over HTTP with
 * FetchZkConfigProvider, which expects:
 *
 *   <baseURL>/keys/<circuitId>.prover
 *   <baseURL>/keys/<circuitId>.verifier
 *   <baseURL>/zkir/<circuitId>.bzkir
 *
 * Vite only serves one `publicDir`, so we copy `managed/canary/{keys,zkir}`
 * into `public/managed/canary/` rather than duplicating 5.6 MB of binaries in
 * git. This runs before both `dev` and `build`, so a fresh clone and a Vercel
 * build both get the artifacts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'managed', 'canary');
const dest = path.join(root, 'public', 'managed', 'canary');

// Only these two subdirectories are needed in the browser. `contract/` is
// imported by the bundler and `compiler/` is build metadata; neither should be
// published as a static asset.
const SUBDIRS = ['keys', 'zkir'];

if (!fs.existsSync(src)) {
  console.error(
    '\n❌ managed/canary not found. Compile the contract first:\n' +
      '   npm run compile\n',
  );
  process.exit(1);
}

let copied = 0;
let bytes = 0;

for (const subdir of SUBDIRS) {
  const from = path.join(src, subdir);
  const to = path.join(dest, subdir);
  if (!fs.existsSync(from)) {
    console.error(`\n❌ Missing ${path.relative(root, from)}. Run: npm run compile\n`);
    process.exit(1);
  }
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const fromFile = path.join(from, name);
    const toFile = path.join(to, name);
    const stat = fs.statSync(fromFile);
    if (!stat.isFile()) continue;

    // Skip if already staged and unchanged — keeps `npm run dev` restarts fast.
    if (fs.existsSync(toFile)) {
      const existing = fs.statSync(toFile);
      if (existing.size === stat.size && existing.mtimeMs >= stat.mtimeMs) continue;
    }
    fs.copyFileSync(fromFile, toFile);
    copied += 1;
    bytes += stat.size;
  }
}

const mb = (bytes / 1024 / 1024).toFixed(1);
console.log(
  copied === 0
    ? '  ZK artifacts already staged in public/managed/canary/'
    : `  Staged ${copied} ZK artifact(s) (${mb} MB) in public/managed/canary/`,
);

/**
 * Prints a summary of what `compact compile` just produced.
 *
 * The compiler itself only reports "Compiling N circuits:" without naming them,
 * so this reads the authoritative circuit list out of contract-info.json and
 * confirms that the corresponding proving/verifying keys and ZKIR landed on
 * disk.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const OUT = process.argv[2] ?? 'managed/canary';
const SRC = process.argv[3] ?? 'contracts/canary.compact';

const infoPath = path.join(OUT, 'compiler', 'contract-info.json');
if (!fs.existsSync(infoPath)) {
  console.error(`No contract-info.json at ${infoPath} — did the compile succeed?`);
  process.exit(1);
}

const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
const has = (dir, file) => fs.existsSync(path.join(OUT, dir, file));

console.log('');
console.log(`✓ Compiled ${SRC}`);
console.log(
  `  language ${info['language-version']}  |  compiler ${info['compiler-version']}  |  runtime ${info['runtime-version']}`,
);
console.log('');

const rows = info.circuits.map((c) => {
  const zk = c.proof === true;
  return {
    name: c.name,
    kind: c.pure ? 'pure' : 'impure',
    proof: zk ? 'ZK proof' : '—',
    keys: zk ? (has('keys', `${c.name}.prover`) && has('keys', `${c.name}.verifier`) ? '✓' : '✗') : '',
    zkir: zk ? (has('zkir', `${c.name}.zkir`) ? '✓' : '✗') : '',
  };
});

const w = Math.max(7, ...rows.map((r) => r.name.length));
console.log(`  ${'CIRCUIT'.padEnd(w)}  ${'KIND'.padEnd(6)}  ${'PROOF'.padEnd(8)}  KEYS  ZKIR`);
console.log(`  ${'-'.repeat(w)}  ------  --------  ----  ----`);
for (const r of rows) {
  console.log(
    `  ${r.name.padEnd(w)}  ${r.kind.padEnd(6)}  ${r.proof.padEnd(8)}  ${r.keys.padEnd(4)}  ${r.zkir}`,
  );
}

const proving = rows.filter((r) => r.proof === 'ZK proof').length;
console.log('');
console.log(`  ${rows.length} circuits (${proving} generating ZK proofs)`);
console.log(`  Artifacts -> ${OUT}/{contract,keys,zkir}`);
console.log('');

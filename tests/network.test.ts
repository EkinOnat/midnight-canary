/**
 * Network argument parsing.
 *
 * Written after `npm run verify -- --network preview` silently targeted the
 * wrong network on Windows. npm parses `--network` as one of its own config
 * options there, warns `Unknown cli config "--network"`, and runs
 * `tsx src/verify.ts preview` — so the script received a bare positional and no
 * flag, found nothing, and fell through to `undeployed`, whose endpoints are
 * all localhost. Every wallet then retried against a dead socket forever.
 *
 * The failure was expensive because it was quiet: the documented command, run
 * exactly as documented, did something other than what it said.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DEFAULT_NETWORK, parseNetworkFlag, resolveNetwork } from '../src/network.js';

/** argv as Node builds it: [execPath, scriptPath, ...args]. */
const argv = (...args: string[]) => ['node', 'src/verify.ts', ...args];

describe('network argument', () => {
  it('reads the separated flag', () => {
    expect(parseNetworkFlag(argv('--network', 'preview'))).toBe('preview');
  });

  it('reads the joined flag', () => {
    expect(parseNetworkFlag(argv('--network=preprod'))).toBe('preprod');
  });

  it('reads a bare positional — the form npm leaves behind on Windows', () => {
    expect(parseNetworkFlag(argv('preview'))).toBe('preview');
  });

  it('prefers an explicit flag over a positional', () => {
    expect(parseNetworkFlag(argv('preview', '--network', 'preprod'))).toBe('preprod');
  });

  it('does not mistake a flag value for a network', () => {
    // `--address` takes a hex string; the parser must step over it rather than
    // scanning it as a positional.
    const hex = '713e14035854aee952c8f2c56f2b871f14f1ce8a8b59d2fa96e51f9d2204bbc8';
    expect(parseNetworkFlag(argv('--address', hex))).toBeNull();
  });

  it('still finds a positional alongside another flag', () => {
    const hex = '713e14035854aee952c8f2c56f2b871f14f1ce8a8b59d2fa96e51f9d2204bbc8';
    expect(parseNetworkFlag(argv('--address', hex, 'preview'))).toBe('preview');
    expect(parseNetworkFlag(argv('--address=' + hex, 'preview'))).toBe('preview');
  });

  it('returns null when nothing names a network', () => {
    expect(parseNetworkFlag(argv())).toBeNull();
    expect(parseNetworkFlag(argv('--verbose'))).toBeNull();
  });

  it('rejects an unknown network rather than guessing', () => {
    expect(() => parseNetworkFlag(argv('--network', 'mainnet'))).toThrow(/Unknown network/);
    expect(() => parseNetworkFlag(argv('--network=nope'))).toThrow(/Unknown network/);
  });

  it('rejects a flag with no value', () => {
    expect(() => parseNetworkFlag(argv('--network'))).toThrow(/requires a value/);
  });

  it('ignores a stray word that is not a network id', () => {
    expect(parseNetworkFlag(argv('somethingelse'))).toBeNull();
  });
});

/**
 * What a command does when nothing tells it where to point.
 *
 * The default used to be `undeployed`, whose endpoints are all localhost, so
 * on a fresh clone `npm run verify` with no argument silently aimed at a
 * devnet that was not running and retried forever. No mistake was needed to
 * hit it — omitting the argument was enough.
 */
describe('default network', () => {
  /** An empty directory, so there is no state file to resolve from. */
  const freshClone = () => fs.mkdtempSync(path.join(os.tmpdir(), 'canary-net-'));

  it('is preview, not a localhost devnet', () => {
    expect(DEFAULT_NETWORK).toBe('preview');
  });

  it('points a fresh clone at a network that actually exists', () => {
    const cwd = freshClone();
    try {
      const r = resolveNetwork({ argv: argv(), cwd, env: {} });
      expect(r.network).toBe('preview');
      expect(r.source).toBe('default');
      // The specific regression: every endpoint on the old default was
      // loopback, so nothing failed — it just never connected.
      expect(r.config.indexer).not.toMatch(/127\.0\.0\.1|localhost/);
      expect(r.config.node).not.toMatch(/127\.0\.0\.1|localhost/);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('still reaches the local devnet when asked for it by name', () => {
    const cwd = freshClone();
    try {
      const r = resolveNetwork({ argv: argv('undeployed'), cwd, env: {} });
      expect(r.network).toBe('undeployed');
      expect(r.source).toBe('flag');
      expect(r.config.indexer).toMatch(/127\.0\.0\.1/);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('reports where the choice came from, so a default is never mistaken for a decision', () => {
    const cwd = freshClone();
    try {
      expect(resolveNetwork({ argv: argv(), cwd, env: {} }).source).toBe('default');
      expect(resolveNetwork({ argv: argv('preprod'), cwd, env: {} }).source).toBe('flag');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

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
import { parseNetworkFlag } from '../src/network.js';

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

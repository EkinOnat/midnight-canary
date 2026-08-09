/**
 * Wallet-connection error mapping.
 *
 * Every string asserted below was produced by a real Lace 4.0.1 wallet during
 * development. They matter because Lace reports a network disagreement as a
 * plain `Error`, not a coded `APIError`, so the message text is the only thing
 * available to branch on — and a silent regression here would replace an
 * actionable instruction with a raw stack trace at exactly the moment someone
 * is trying to connect.
 *
 * Lace distinguishes two cases and so must we, because the fix differs:
 *   "Invalid network ID: X"  — the dApp asked for a network the wallet has
 *                              never heard of. Our configuration is wrong.
 *   "Network ID mismatch"    — the network is recognised, but the wallet is
 *                              parked on a different one. Their setting.
 */
import { describe, it, expect } from 'vitest';
import {
  ConnectError,
  connectWallet,
  deepestMessage,
  describeWalletError,
  pickWallet,
} from '../src/lib/connector.js';
import type { DiscoveredWallet } from '../src/lib/connector.js';

/** A wallet whose `connect` always fails in the given way. */
const failingWith = (thrown: unknown, name = 'lace'): DiscoveredWallet => ({
  id: 'test',
  name,
  icon: '',
  apiVersion: '4.0.1',
  api: {
    rdns: 'io.lace.wallet',
    name,
    icon: '',
    apiVersion: '4.0.1',
    connect: () => Promise.reject(thrown),
  } as unknown as DiscoveredWallet['api'],
});

/** The shape the connector API documents for its own errors. */
const apiError = (code: string, reason: string) =>
  Object.assign(new Error(reason), { type: 'DAppConnectorAPIError', code, reason });

const kindOf = async (thrown: unknown): Promise<ConnectError> => {
  try {
    await connectWallet(failingWith(thrown), 'preview');
  } catch (e) {
    return e as ConnectError;
  }
  throw new Error('connectWallet resolved when it should have thrown');
};

describe('connect errors — network disagreements', () => {
  it('maps "Network ID mismatch" to a wallet-side fix', async () => {
    const e = await kindOf(new Error('Network ID mismatch'));
    expect(e.kind).toBe('network-mismatch');
    expect(e.message).toContain('not on "preview"');
    // The hint has to name the action, not just the problem.
    expect(e.detail).toMatch(/switch its network to preview/i);
  });

  it('maps "Invalid network ID" to a build-side fix, not a wallet-side one', async () => {
    const e = await kindOf(
      new Error(
        'Invalid network ID: Preview\nValid networks are: mainnet, testnet, devnet, qanet, undeployed, preview, preprod',
      ),
    );
    expect(e.kind).toBe('network-unsupported');
    // The wallet's own list of valid networks is the most useful thing we can
    // show, so it must survive into the detail rather than being swallowed.
    expect(e.detail).toContain('Valid networks are');
  });

  it('treats "Unsupported network ID" the same as "Invalid network ID"', async () => {
    const e = await kindOf(
      new Error(
        'Unsupported network ID: testnet\nSupported networks are: undeployed, mainnet, preview, preprod',
      ),
    );
    expect(e.kind).toBe('network-unsupported');
  });
});

describe('connect errors — coded connector failures', () => {
  it('maps a rejected connection request', async () => {
    const e = await kindOf(apiError('Rejected', 'User declined'));
    expect(e.kind).toBe('rejected');
    expect(e.message).toContain('rejected in lace');
  });

  it('maps a rejected permission grant the same way', async () => {
    expect((await kindOf(apiError('PermissionRejected', 'nope'))).kind).toBe('rejected');
  });

  it('maps a lost connection', async () => {
    expect((await kindOf(apiError('Disconnected', 'gone'))).kind).toBe('disconnected');
  });
});

describe('connect errors — anything else', () => {
  it('falls back to unknown and preserves the original message', async () => {
    const e = await kindOf(new Error('the proof server caught fire'));
    expect(e.kind).toBe('unknown');
    expect(e.detail).toBe('the proof server caught fire');
  });

  it('survives a non-Error being thrown', async () => {
    const e = await kindOf('just a string');
    expect(e.kind).toBe('unknown');
    expect(e.detail).toBe('just a string');
  });
});

/**
 * Regression cover for a real failure. A check-in on Preview surfaced as
 *
 *   Unexpected error submitting scoped transaction '<unnamed>': Error
 *
 * and nothing else. Midnight.js builds that string with
 * `new Error(\`...: ${String(err)}\`, { cause: err })`, so when the underlying
 * error has an empty message the interpolation degrades to the bare word
 * "Error" — and reading only `.message` threw away the one link that said what
 * actually went wrong.
 */
describe('error cause chains', () => {
  const wrapped = (summary: string, cause: unknown) => new Error(summary, { cause });

  it('reaches past a wrapper whose summary lost the cause', () => {
    const real = new Error('Not enough Dust to pay the transaction fee');
    const outer = wrapped("Unexpected error submitting scoped transaction '<unnamed>': Error", real);

    expect(deepestMessage(outer)).toBe('Not enough Dust to pay the transaction fee');
  });

  it('discards a wrapper that says only "Error"', () => {
    // The exact shape observed: an inner error carrying no message at all.
    const outer = wrapped("Unexpected error submitting scoped transaction '<unnamed>': Error", new Error(''));

    // Nothing in the chain is informative, so the caller's fallback must win
    // rather than the misleading summary.
    expect(describeWalletError(outer, 'The circuit call did not complete.')).toBe(
      'The circuit call did not complete.',
    );
  });

  it('reads Effect-style causes, which are plain objects rather than Errors', () => {
    const outer = wrapped('Unexpected error submitting scoped transaction: Error', {
      name: 'TransactionRejected',
      message: 'transaction was rejected by the node',
    });

    expect(deepestMessage(outer)).toBe('transaction was rejected by the node');
  });

  it('takes the innermost message when several wrappers nest', () => {
    const chain = wrapped('outer', wrapped('middle', new Error('the real reason')));
    expect(deepestMessage(chain)).toBe('the real reason');
  });

  it('survives a cyclic cause chain instead of hanging', () => {
    const a = new Error('first');
    const b = new Error('second');
    (a as { cause?: unknown }).cause = b;
    (b as { cause?: unknown }).cause = a;

    expect(deepestMessage(a)).toBe('second');
  });

  it('still prefers a coded connector error over the chain', () => {
    const apiErr = Object.assign(new Error(''), {
      type: 'DAppConnectorAPIError',
      code: 'Rejected',
      reason: 'user said no',
    });
    expect(describeWalletError(apiErr, 'fallback')).toBe('Rejected in the wallet.');
  });
});

describe('wallet selection', () => {
  const wallet = (rdns: string, name: string): DiscoveredWallet => ({
    id: rdns,
    name,
    icon: '',
    apiVersion: '4.0.1',
    api: { rdns, name, icon: '', apiVersion: '4.0.1' } as unknown as DiscoveredWallet['api'],
  });

  it('prefers Lace when several wallets are injected', () => {
    const wallets = [wallet('com.other.wallet', 'Other'), wallet('io.lace.wallet', 'Lace')];
    expect(pickWallet(wallets)?.name).toBe('Lace');
  });

  it('falls back to the first wallet when none is Lace', () => {
    expect(pickWallet([wallet('com.a.wallet', 'A'), wallet('com.b.wallet', 'B')])?.name).toBe('A');
  });

  it('returns undefined when nothing is installed', () => {
    expect(pickWallet([])).toBeUndefined();
  });
});

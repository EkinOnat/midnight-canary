/**
 * Fee-readiness classification.
 *
 * Written after a real failure: a wallet funded from the Preview faucet held
 * 1000 tNIGHT and zero tDUST, and every check-in died at submission with a
 * message that named no cause. The circuit had run and the proof had been
 * generated first, so a minute went into learning something `getDustBalance`
 * would have said immediately.
 *
 * The distinction that matters is between a wallet that is generating DUST and
 * one that is not, because the remedies are opposites: wait, versus go and
 * delegate. `cap` is what separates them — it is the ceiling implied by
 * currently delegated NIGHT, so a cap of zero means nothing is delegated.
 */
import { describe, it, expect } from 'vitest';
import { classifyDust } from '../src/lib/dust.js';

describe('fee readiness', () => {
  it('lets a funded wallet through', () => {
    const v = classifyDust({ balance: 5_000n, cap: 5_000n });
    expect(v.kind).toBe('ready');
    expect(v.canPay).toBe(true);
  });

  it('allows a balance well below the cap — DUST accrues, it need not be full', () => {
    const v = classifyDust({ balance: 1n, cap: 5_000_000n });
    expect(v.canPay).toBe(true);
  });

  it('tells a wallet mid-generation to wait, not to go back to the faucet', () => {
    const v = classifyDust({ balance: 0n, cap: 5_000n });
    expect(v.kind).toBe('generating');
    expect(v.canPay).toBe(false);
    expect(v.hint).toMatch(/wait/i);
    expect(v.hint).not.toMatch(/faucet/i);
  });

  it('tells an undelegated wallet to delegate, and names the control that does it', () => {
    // The exact case observed: tNIGHT received, never delegated, so no DUST is
    // being generated and none ever will be without action.
    const v = classifyDust({ balance: 0n, cap: 0n });
    expect(v.kind).toBe('undelegated');
    expect(v.canPay).toBe(false);
    expect(v.hint).toContain('Generate tDUST');
  });

  it('does not tell an undelegated wallet that waiting will help', () => {
    // The failure this guards against is advice that quietly wastes an hour.
    const v = classifyDust({ balance: 0n, cap: 0n });
    expect(v.hint).not.toMatch(/wait a moment and try again/i);
  });
});

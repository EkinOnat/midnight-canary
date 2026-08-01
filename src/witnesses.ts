/**
 * Canary — private state and witness implementations.
 *
 * Everything in `CanaryPrivateState` stays on the responder's machine. The
 * witness functions below are the only bridge between that local state and
 * the zero-knowledge proof, and neither value they return is ever written to
 * the ledger or included in a transaction.
 */
import type { Ledger } from '../managed/canary/contract/index.js';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

export type CanaryPrivateState = {
  /** 32-byte identity secret. Never leaves this process. */
  readonly secretKey: Uint8Array;
  /** Wellbeing score, 1..5. Never leaves this process. */
  readonly score: number;
};

export const createCanaryPrivateState = (
  secretKey: Uint8Array,
  score: number,
): CanaryPrivateState => ({ secretKey, score });

export const witnesses = {
  localSecretKey: ({
    privateState,
  }: WitnessContext<Ledger, CanaryPrivateState>): [CanaryPrivateState, Uint8Array] => [
    privateState,
    privateState.secretKey,
  ],

  wellbeingScore: ({
    privateState,
  }: WitnessContext<Ledger, CanaryPrivateState>): [CanaryPrivateState, bigint] => [
    privateState,
    BigInt(privateState.score),
  ],
};

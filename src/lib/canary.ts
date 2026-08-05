/**
 * Browser binding to the compiled Canary contract.
 *
 * The compiled module in `managed/canary/contract/` is the *same artifact* the
 * Node CLI uses — it is imported by the bundler here rather than loaded from
 * disk, and the witnesses come from `src/witnesses.ts` unchanged. So the
 * browser and the CLI prove identical circuits over identical private state.
 */
import * as Canary from '../../managed/canary/contract/index.js';
import type { Ledger } from '../../managed/canary/contract/index.js';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import type { ContractState } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { witnesses, type CanaryPrivateState } from '../witnesses';

export type { CanaryPrivateState, Ledger };
export { createCanaryPrivateState } from '../witnesses';

/** The two circuits that generate a ZK proof. The three `pure` helpers inline. */
export type CanaryCircuitId = 'checkIn' | 'closeRound';

/**
 * `withCompiledFileAssets` records where file-based assets live. In the browser
 * nothing reads from a file path — `FetchZkConfigProvider` fetches keys and
 * ZKIR over HTTP — but the builder requires the slot to be filled before the
 * contract is usable, so it is set to the artifact directory's name.
 */
export const compiledContract = CompiledContract.make<
  Canary.Contract<CanaryPrivateState>,
  CanaryPrivateState
>('canary', Canary.Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets('canary'),
);

/** The contract's public ledger state, as shown in the "what the chain saw" panel. */
export interface PublicPulse {
  readonly round: number;
  readonly responses: number;
  readonly alerts: number;
  readonly alertThreshold: number;
  readonly nullifiers: number;
}

/** Decode raw on-chain contract state into the public counters. */
export function readPulse(state: ContractState): PublicPulse {
  const l = Canary.ledger(state.data);
  return {
    round: Number(l.round),
    responses: Number(l.responses),
    alerts: Number(l.alerts),
    alertThreshold: Number(l.alertThreshold),
    nullifiers: Number(l.checkedIn.size()),
  };
}

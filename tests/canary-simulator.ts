/**
 * In-process test harness for the Canary contract.
 *
 * Runs circuits against the real compiled contract and a local query context,
 * so tests exercise the actual generated ZK logic without needing a node, a
 * proof server, or a funded wallet.
 *
 * Pattern follows midnightntwrk/example-bboard's BBoardSimulator.
 */
import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  type Ledger,
  ledger,
} from '../managed/canary/contract/index.js';
import { type CanaryPrivateState, witnesses } from '../src/witnesses.js';

export class CanarySimulator {
  readonly contract: Contract<CanaryPrivateState>;
  circuitContext: CircuitContext<CanaryPrivateState>;

  constructor(secretKey: Uint8Array, score: number) {
    this.contract = new Contract<CanaryPrivateState>(witnesses);
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext({ secretKey, score }, '0'.repeat(64)),
      );
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(
        currentContractState.data,
        sampleContractAddress(),
      ),
    };
  }

  /** Swap in a different responder: a different secret and a different score. */
  public switchUser(secretKey: Uint8Array, score: number): void {
    this.circuitContext.currentPrivateState = { secretKey, score };
  }

  public getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public getPrivateState(): CanaryPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  public checkIn(): Ledger {
    this.circuitContext = this.contract.impureCircuits.checkIn(
      this.circuitContext,
    ).context;
    return this.getLedger();
  }

  public closeRound(): Ledger {
    this.circuitContext = this.contract.impureCircuits.closeRound(
      this.circuitContext,
    ).context;
    return this.getLedger();
  }

  /** All nullifiers currently recorded on the ledger, as hex, sorted. */
  public nullifiers(): string[] {
    return [...this.getLedger().checkedIn]
      .map((n) => Buffer.from(n).toString('hex'))
      .sort();
  }

  /**
   * A deterministic, exhaustive snapshot of everything this contract makes
   * public. Used by the privacy tests: if a private value ever leaked into
   * public state, it would have to show up here.
   */
  public publicStateBlob(): string {
    const l = this.getLedger();
    return JSON.stringify({
      round: l.round.toString(),
      responses: l.responses.toString(),
      alerts: l.alerts.toString(),
      alertThreshold: l.alertThreshold.toString(),
      admin: Buffer.from(l.admin).toString('hex'),
      checkedIn: this.nullifiers(),
    });
  }
}

/** Deterministic 32-byte key so tests are reproducible. */
export const key = (seed: number): Uint8Array =>
  Uint8Array.from({ length: 32 }, (_, i) => (seed * 31 + i * 7) % 256);

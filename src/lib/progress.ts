/**
 * Call-progress signalling.
 *
 * `callTx.checkIn()` is a single await that runs the circuit, proves it,
 * balances the transaction and submits it. To show which of those is happening
 * — proof generation in particular, since that is the slow, interesting part —
 * the providers emit a phase as each begins.
 *
 * Only phase names cross this channel. No witness value, transaction or key
 * material is ever emitted.
 */
export type CallPhase =
  | 'executing'
  | 'proving'
  | 'balancing'
  | 'submitting'
  | 'confirming'
  | 'done';

/**
 * Wording note: "on this device" appears twice on purpose. Those are the two
 * phases where the private score is in play, and the whole product rests on
 * where they happen.
 */
export const PHASE_LABELS: Record<CallPhase, string> = {
  executing: 'Running the circuit on this device',
  proving: 'Generating the zero-knowledge proof on this device',
  balancing: 'Wallet paying the fee',
  submitting: 'Submitting to the network',
  confirming: 'Waiting for the block',
  done: 'Done',
};

/** The order phases actually occur in, for rendering progress as a list. */
export const PHASE_ORDER: readonly Exclude<CallPhase, 'done'>[] = [
  'executing',
  'proving',
  'balancing',
  'submitting',
  'confirming',
];

type Listener = (phase: CallPhase) => void;

const listeners = new Set<Listener>();

export function onCallPhase(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitCallPhase(phase: CallPhase): void {
  for (const listener of listeners) listener(phase);
}

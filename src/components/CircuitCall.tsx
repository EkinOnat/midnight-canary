/**
 * Calls Canary's `checkIn` circuit, and owns the split that carries the whole
 * design argument: your side on the left, the chain's side on the right, a
 * labelled seam between them.
 *
 * The privacy rule this component enforces: the wellbeing score is written to a
 * ref, never to React state, and the ref is cleared the moment the call is
 * made. Once picked, the number is not re-rendered anywhere — not on a button,
 * not in the result, not in an aria-label. The same goes for the identity
 * secret, which is only ever shown as a six-character fingerprint.
 *
 * `closeRound` is not exposed here: it is gated on a hash of the deployer's
 * secret, which a Lace key cannot produce. It stays a CLI operation.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import type { MidnightSession } from '../hooks/useMidnight';
import { PRIVATE_STATE_ID } from '../config';
import { createCanaryPrivateState, scrubbedPrivateState } from '../lib/canary';
import { getIdentitySecret, identityFingerprint, rotateIdentitySecret } from '../lib/identity';
import { PHASE_LABELS, PHASE_ORDER, onCallPhase, type CallPhase } from '../lib/progress';
import { describeWalletError, errorDetail } from '../lib/connector';

const SCORES = [1, 2, 3, 4, 5] as const;
const CROSSING_MS = 1200;

interface Receipt {
  readonly txId: string;
  readonly blockHeight: number;
}

export function CircuitCall({
  session,
  children,
}: {
  session: MidnightSession;
  children?: ReactNode;
}) {
  const { status, contract, providers, pulse, pulseError, refreshPulse } = session;

  // The private score. A ref, not state: state would be rendered, retained in
  // devtools, and captured by React's profiler.
  const scoreRef = useRef<number | null>(null);
  const [armed, setArmed] = useState(false);

  const [phase, setPhase] = useState<CallPhase | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [callError, setCallError] = useState<CallFailure | null>(null);
  const [crossing, setCrossing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fingerprint, setFingerprint] = useState(() => identityFingerprint(getIdentitySecret()));

  const running = phase !== null;
  const connected = status === 'connected' && contract !== null && providers !== null;

  useEffect(() => onCallPhase(setPhase), []);

  // The seam animation runs once per successful check-in, then resets so it can
  // run again on the next one.
  useEffect(() => {
    if (!receipt) return;
    setCrossing(true);
    const t = setTimeout(() => setCrossing(false), CROSSING_MS);
    return () => clearTimeout(t);
  }, [receipt]);

  const arm = useCallback((value: number) => {
    scoreRef.current = value;
    setArmed(true);
    setCallError(null);
  }, []);

  const disarm = useCallback(() => {
    scoreRef.current = null;
    setArmed(false);
  }, []);

  // An indexer round-trip is fast but not instant, and a button that looks
  // untouched reads as broken. `refreshPulse` reports failure through
  // `pulseError`, so there is nothing to catch here — only a flag to clear.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshPulse();
    } finally {
      setRefreshing(false);
    }
  }, [refreshPulse]);

  const newIdentity = useCallback(() => {
    setFingerprint(identityFingerprint(rotateIdentitySecret()));
    setReceipt(null);
    setCallError(null);
  }, []);

  const checkIn = useCallback(async () => {
    const score = scoreRef.current;
    if (!connected || score === null) return;

    setCallError(null);
    setReceipt(null);
    setPhase('executing');

    try {
      // Hand the witnesses to the local private-state store. This is the only
      // place the score exists outside the ref, and it goes straight into the
      // encrypted local store — never into a request body.
      await providers.privateStateProvider.set(
        PRIVATE_STATE_ID,
        createCanaryPrivateState(getIdentitySecret(), score),
      );

      // Clear the in-memory copy before the long await, so it is not sitting in
      // a ref for the 30-60s the proof takes.
      scoreRef.current = null;

      const tx = await contract.callTx.checkIn();
      setReceipt({ txId: tx.public.txId, blockHeight: tx.public.blockHeight });
      setArmed(false);
      await refreshPulse();
    } catch (e) {
      setCallError(explainCallError(e));
    } finally {
      // Leave no real answer behind in the store between calls.
      scoreRef.current = null;
      try {
        await providers?.privateStateProvider.set(PRIVATE_STATE_ID, scrubbedPrivateState());
      } catch {
        /* scrubbing is best-effort; a failure here reveals nothing */
      }
      setPhase(null);
    }
  }, [connected, contract, providers, refreshPulse]);

  const phaseIndex = PHASE_ORDER.findIndex((p) => p === phase);

  return (
    <div className="split">
      <section className="yours" aria-labelledby="yours-head">
        {children}

        <h2 className="head" id="yours-head">
          Your side
        </h2>

        <p className="ask">How has your week actually been?</p>

        <fieldset className="scale" disabled={running}>
          <legend className="sr-only">Your wellbeing score, 1 to 5</legend>
          {armed ? (
            <div className="sealed">
              <span className="sealed-mark">Kept to yourself</span>
              <button type="button" className="act" onClick={disarm}>
                Change
              </button>
            </div>
          ) : (
            <>
              <div className="scale-anchors" aria-hidden="true">
                <span>Rough</span>
                <span>Good</span>
              </div>
              <div className="scale-row">
                {SCORES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="tick"
                    onClick={() => arm(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </>
          )}
        </fieldset>

        <p className="who">
          <span>
            Responder <code>#{fingerprint}</code> — generated here, never sent
          </span>
          <button type="button" className="act" onClick={newIdentity} disabled={running}>
            New identity
          </button>
        </p>

        <button
          type="button"
          className="act act-key"
          onClick={() => void checkIn()}
          disabled={!connected || !armed || running}
        >
          {running ? 'Working…' : 'Check in'}
        </button>
        <p className="claim">Proved without revealing your input</p>

        {/* A live region has to already be in the document when its content
            changes, or screen readers routinely miss the first announcement.
            The visual list below was mounted at the same instant it got its
            text, so it never announced reliably. This one is always mounted
            and only its text changes; the list is decorative to assistive
            tech. It matters here more than usual — proof generation is the
            longest wait in the app and the phase is the only signal that
            anything is happening. */}
        <p className="sr-only" role="status" aria-live="polite">
          {phase ? PHASE_LABELS[phase] : ''}
        </p>

        {running ? (
          <ol className="phases" aria-hidden="true">
            {PHASE_ORDER.map((p, i) => (
              <li
                key={p}
                className={`phase ${i === phaseIndex ? 'phase-now' : i < phaseIndex ? 'phase-done' : ''}`}
              >
                <span className="phase-pip" aria-hidden="true" />
                {PHASE_LABELS[p]}
              </li>
            ))}
          </ol>
        ) : null}

        {!connected && status !== 'connecting' ? (
          <p className="phases">Connect a wallet to check in.</p>
        ) : null}

        {callError ? (
          <div className="phases" role="alert">
            <p className="call-error">{callError.message}</p>
            {/* Collapsed rather than hidden. The sentence above is what to do;
                this is what happened, and it is the only thing worth pasting
                into a bug report. */}
            {callError.detail ? (
              <details className="call-detail">
                <summary>What the wallet reported</summary>
                <code className="wrapcode">{callError.detail}</code>
              </details>
            ) : null}
          </div>
        ) : null}

        <div className="kept">
          <div>
            Score <i className="redacted" aria-label="hidden" />
          </div>
          <div>
            Identity <i className="redacted" aria-label="hidden" />
          </div>
          <p className="kept-note">
            Neither is written to the ledger, passed as a circuit argument, or included in the
            transaction. They exist only as inputs to the proof.
          </p>
        </div>
      </section>

      {/* The signature element: the boundary, labelled with the only two things
          that ever cross it. */}
      <div className={`seam-col ${crossing ? 'seam-crossing' : ''}`} aria-hidden="true">
        <span className="seam-label">one hash · one bit</span>
        <span className="seam-spark" />
      </div>

      <section className="chain" aria-labelledby="chain-head">
        <h2 className="chain-head" id="chain-head">
          The chain&rsquo;s side
        </h2>
        <p className="chain-sub">Public state, read live from the indexer. Anyone can read it.</p>

        {pulse ? (
          <dl className="rows">
            <dt>round</dt>
            <dd>{pulse.round}</dd>
            <dt>responses</dt>
            <dd className={crossing ? 'bumped' : ''}>{pulse.responses}</dd>
            <dt>alerts</dt>
            <dd className={crossing ? 'bumped' : ''}>
              {pulse.alerts}
              {pulse.responses > 0
                ? ` · ${Math.round((pulse.alerts / pulse.responses) * 100)}%`
                : ''}
            </dd>
            <dt>alert at</dt>
            <dd>&le; {pulse.alertThreshold}</dd>
            <dt>nullifiers</dt>
            <dd>{pulse.nullifiers}</dd>
          </dl>
        ) : (
          <p className="chain-empty">{pulseError ?? 'Reading public state…'}</p>
        )}

        <div className="chain-block">
          <h3 className="chain-head">Your last transaction</h3>
          {receipt ? (
            <dl className="rows">
              <dt>tx</dt>
              <dd>
                <code className="wrapcode">{receipt.txId}</code>
              </dd>
              <dt>block</dt>
              <dd>{receipt.blockHeight}</dd>
            </dl>
          ) : (
            <p className="chain-empty">Nothing from you yet.</p>
          )}
        </div>

        <div className="chain-block">
          <button
            type="button"
            className="act"
            onClick={() => void refresh()}
            disabled={running || refreshing}
            aria-busy={refreshing}
          >
            {refreshing ? 'Reading…' : 'Refresh'}
          </button>
        </div>

        <p className="chain-foot">
          Nothing above distinguishes a 3 from a 5, or names who answered. The score is not
          encrypted here — it was never sent.
        </p>
      </section>
    </div>
  );
}

/**
 * The user-facing sentence, and the raw detail behind it.
 *
 * Both are returned because they answer different questions. The sentence says
 * what to do next; the detail says what actually happened, and is the only
 * thing worth pasting into a bug report. Collapsing them into one string, as
 * this did originally, meant an unrecognised failure showed the wrapper's
 * summary — which for Midnight.js is a sentence ending in ": Error" — and the
 * real cause was never displayed at all.
 */
interface CallFailure {
  readonly message: string;
  readonly detail: string | null;
}

function explainCallError(e: unknown): CallFailure {
  const raw = describeWalletError(e, 'The circuit call did not complete.');
  // The full chain, wrappers included — they name the stage that failed, which
  // is the first thing worth knowing when diagnosing one of these.
  const detail = errorDetail(e);
  const say = (message: string): CallFailure => ({ message, detail });

  if (/already checked in/i.test(raw)) {
    return {
      message:
        'This identity already checked in for the current round. Use “New identity” to check in as a different responder.',
      detail: null,
    };
  }
  if (/Not enough Dust|Insufficient Funds|could not balance|no dust/i.test(raw)) {
    return say(
      'The wallet has no DUST to pay the fee. Fund it from the faucet, register the NIGHT for DUST generation, and wait for the balance to appear.',
    );
  }
  if (/Failed to fetch ZK artifact|text\/html/i.test(raw)) {
    return say(
      'Could not load the proving keys from /managed/canary/. Check that the ZK artifacts shipped alongside the site.',
    );
  }

  // The node applied the transaction and rejected it. Distinct from a failure
  // to submit: the fee was spent, so the wallet balance moved even though the
  // check-in did not land.
  const status = txStatusOf(e);
  if (status && status !== 'SucceedEntirely') {
    return say(
      `The network rejected the transaction (${status}). The most common cause on Preview is not having enough DUST to cover the fee at the moment it was applied.`,
    );
  }

  // Submission specifically — the proof was generated and the wallet signed
  // and balanced the transaction, so the failure is between the wallet and the
  // node rather than anything to do with the score.
  if (/error submitting scoped transaction/i.test(rawOuter(e))) {
    return say(
      'The proof was generated and the wallet signed the transaction, but the network did not accept it. Check that the wallet holds DUST — not just NIGHT — and that it is still on Preview, then try again.',
    );
  }

  return say(raw);
}

/** The outermost message, used only to identify which stage the wrapper names. */
function rawOuter(e: unknown): string {
  return e instanceof Error ? e.message : '';
}

/** `TxFailedError` carries the node's verdict on a transaction it did apply. */
function txStatusOf(e: unknown): string | null {
  for (let cur: unknown = e, hops = 0; cur && hops < 8; hops++) {
    const status = (cur as { finalizedTxData?: { status?: unknown } }).finalizedTxData?.status;
    if (typeof status === 'string') return status;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * Whether the wallet can actually pay for a check-in, and what to do if not.
 *
 * Fees on Midnight are paid in DUST, which cannot be sent or bought — it is
 * generated over time by NIGHT that has been delegated to a DUST address. The
 * faucet hands out tNIGHT, not tDUST, so a freshly funded wallet holds tokens
 * and still cannot transact until the delegation is made and DUST has accrued.
 *
 * That failure mode is invisible until submission: the circuit runs, the proof
 * is generated, and the wallet even balances and signs the transaction. Only
 * then does the network refuse it — a minute of proving spent to learn
 * something the wallet knew before we started. `getDustBalance` reports both
 * the current balance and the cap, and the two together say which of three
 * situations the wallet is in, so we can say so up front.
 */

export interface DustStatus {
  /** Spendable now. Regenerates over time once NIGHT is delegated. */
  readonly balance: bigint;
  /** The ceiling implied by the currently delegated NIGHT. Zero means none is. */
  readonly cap: bigint;
}

export type DustReadiness = 'ready' | 'generating' | 'undelegated';

export interface DustVerdict {
  readonly kind: DustReadiness;
  /** True when a check-in can be paid for right now. */
  readonly canPay: boolean;
  readonly message: string;
  readonly hint: string;
}

export function classifyDust(dust: DustStatus): DustVerdict {
  if (dust.balance > 0n) {
    return {
      kind: 'ready',
      canPay: true,
      message: 'The wallet can pay the check-in fee.',
      hint: '',
    };
  }

  // A cap above zero means NIGHT is delegated and DUST is accruing against it;
  // the balance is simply still at zero. Waiting is the whole fix, so say that
  // rather than sending someone back to the faucet they already used.
  if (dust.cap > 0n) {
    return {
      kind: 'generating',
      canPay: false,
      message: 'Your wallet has no DUST yet, but it is generating some.',
      hint: 'DUST starts accruing about a minute after delegation and builds up from there. Wait a moment and try again.',
    };
  }

  return {
    kind: 'undelegated',
    canPay: false,
    message: 'Your wallet has no DUST, and none is being generated.',
    hint: 'Fees are paid in DUST, which the faucet does not hand out — it gives tNIGHT. In Lace, use "Generate tDUST" to delegate your tNIGHT, then wait about a minute for the balance to start building.',
  };
}

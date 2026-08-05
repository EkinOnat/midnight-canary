/**
 * Transaction encoding across the DApp-connector boundary.
 *
 * Midnight.js hands us live `Transaction` objects (WASM-backed); the connector
 * API takes and returns them as opaque strings. The connector docs specify the
 * ledger *type* on each side but not the string encoding, so both directions
 * live here alone — if a wallet turns out to want base64 rather than hex, this
 * is the one file that changes.
 */
import { Transaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { FinalizedTransaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';
import { fromHex, toHex } from '@midnight-ntwrk/midnight-js-utils';

/** Serialize a transaction for `balanceUnsealedTransaction` / `submitTransaction`. */
export function encodeTx(tx: UnboundTransaction | FinalizedTransaction): string {
  return toHex(tx.serialize());
}

/**
 * Decode what the wallet hands back from `balanceUnsealedTransaction`: proven,
 * signed and cryptographically bound — `Transaction<SignatureEnabled, Proof,
 * Binding>`, which is midnight-js's `FinalizedTransaction`.
 *
 * The marker arguments are the string literals `ledger-v8` uses to pick the
 * right generic instantiation at runtime.
 */
export function decodeFinalizedTx(encoded: string): FinalizedTransaction {
  return Transaction.deserialize(
    'signature',
    'proof',
    'binding',
    new Uint8Array(fromHex(stripPrefix(encoded))),
  ) as FinalizedTransaction;
}

function stripPrefix(s: string): string {
  return s.startsWith('0x') ? s.slice(2) : s;
}

/**
 * The responder's identity secret, and the password that encrypts local state.
 *
 * Canary derives a responder's on-chain nullifier from a 32-byte secret. In the
 * CLI that secret comes from a typed passphrase; in the browser it is generated
 * once with `crypto.getRandomValues` and kept in `localStorage`. It is never
 * displayed, never logged, and never leaves this machine — only
 * `persistentHash("canary:nul:v1", round, secret)` ever reaches the chain.
 */
import { validatePassword } from '@midnight-ntwrk/midnight-js-utils';

const SECRET_KEY = 'canary.identity.v1';
const PASSWORD_KEY = 'canary.storage-password.v1';

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Load the local identity secret, generating one on first use.
 *
 * Losing it (clearing site data) simply makes you a new anonymous responder —
 * there is nothing to recover, which is the point.
 */
export function getIdentitySecret(): Uint8Array {
  let hex = localStorage.getItem(SECRET_KEY);
  if (!hex || !/^[0-9a-f]{64}$/.test(hex)) {
    hex = randomHex(32);
    localStorage.setItem(SECRET_KEY, hex);
  }
  return hexToBytes(hex);
}

/** Discard the current identity and mint a fresh one. */
export function rotateIdentitySecret(): Uint8Array {
  localStorage.setItem(SECRET_KEY, randomHex(32));
  return getIdentitySecret();
}

/** A short, non-reversible tag so the UI can say *which* identity is loaded without showing it. */
export function identityFingerprint(secret: Uint8Array): string {
  // FNV-1a over the secret. Deliberately weak and truncated: it is a UI label,
  // not a commitment, and a short digest cannot be walked back to the secret.
  let h = 0x811c9dc5;
  for (const b of secret) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0').slice(0, 6);
}

/**
 * The password encrypting the private-state store at rest.
 *
 * Generated per browser rather than baked into the bundle — a constant shipped
 * in public JS would not be a secret at all. If a build-time password is
 * supplied it wins, so a self-hoster can choose their own.
 */
export function getStoragePassword(override?: string): string {
  if (override) {
    validatePassword(override); // fail loudly at startup, not mid-transaction
    return override;
  }
  const existing = localStorage.getItem(PASSWORD_KEY);
  if (existing) return existing;

  // The SDK's policy rejects sequential runs like `abcd`, which random hex can
  // produce, so generate until it passes. In practice this succeeds first try.
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = `Cy-${randomHex(16)}-${randomHex(4).toUpperCase()}!`;
    try {
      validatePassword(candidate);
      localStorage.setItem(PASSWORD_KEY, candidate);
      return candidate;
    } catch {
      /* try again */
    }
  }
  throw new Error('Could not generate a storage password meeting the SDK policy.');
}

/**
 * Frontend configuration.
 *
 * Everything here is build-time public — it ends up in the JS bundle. That is
 * fine: a contract address and an indexer URL are public information. Nothing
 * secret belongs in this file.
 */

/**
 * The Midnight network this build targets.
 *
 * Preview, not Preprod: as of 2026-08-03 the Preprod RPC and faucet are down,
 * and Midnight/Rise In directed builders to Preview. `preprod` still works if
 * you set it here — the indexer endpoints for both live in
 * {@link fallbackIndexer} and in `src/network.ts`.
 */
export const TARGET_NETWORK = (import.meta.env.VITE_MIDNIGHT_NETWORK ?? 'preview').trim();

/**
 * The deployed Canary contract on {@link TARGET_NETWORK}.
 *
 * Defaults to the live Preview deployment so a fresh clone runs with no setup.
 * Override with `VITE_CONTRACT_ADDRESS` to point at your own.
 */
const DEFAULT_ADDRESSES: Record<string, string> = {
  preview: '713e14035854aee952c8f2c56f2b871f14f1ce8a8b59d2fa96e51f9d2204bbc8',
};

export const CONTRACT_ADDRESS = (
  import.meta.env.VITE_CONTRACT_ADDRESS?.trim() || DEFAULT_ADDRESSES[TARGET_NETWORK] || ''
).trim();

/**
 * Fallback indexer endpoints, mirroring `src/network.ts`. Only used if the
 * connected wallet does not report its own configuration — when it does, we
 * prefer the wallet's, because the user may have pointed it somewhere they
 * trust more.
 */
const FALLBACK_INDEXERS: Record<string, { http: string; ws: string }> = {
  preview: {
    http: 'https://indexer.preview.midnight.network/api/v4/graphql',
    ws: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
  },
  preprod: {
    http: 'https://indexer.preprod.midnight.network/api/v4/graphql',
    ws: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  },
};

export const fallbackIndexer = (network: string) =>
  FALLBACK_INDEXERS[network] ?? FALLBACK_INDEXERS.preview;

/**
 * Optional build-time password for the local private-state store.
 *
 * Left unset by default on purpose: a constant shipped in public JS is not a
 * secret. When it is empty, `getStoragePassword` mints a random per-browser
 * password instead. Set it only if you are self-hosting and want to control
 * the value.
 */
export const PRIVATE_STATE_PASSWORD =
  import.meta.env.VITE_PRIVATE_STATE_PASSWORD?.trim() || undefined;

/**
 * Where {@link FetchZkConfigProvider} looks for prover keys and ZKIR.
 *
 * A function, not a constant: reading `window` at module scope would make
 * importing this file throw outside a browser, which would in turn make every
 * module that transitively imports it impossible to unit-test.
 */
export const zkConfigBaseUrl = () => `${window.location.origin}/managed/canary`;

/** Must match the `privateStateId` used by `src/deploy.ts` and `src/cli.ts`. */
export const PRIVATE_STATE_ID = 'canaryPrivateState';

/** True when the build has no contract address wired up. */
export const isConfigured = CONTRACT_ADDRESS.length > 0;

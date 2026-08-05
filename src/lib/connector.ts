/**
 * Lace / DApp-connector discovery and connection.
 *
 * `@midnight-ntwrk/dapp-connector-api` v4 replaced the old
 * `window.midnight.mnLace.enable()` shape. Wallets now inject one or more
 * `InitialAPI` objects under `window.midnight`, keyed by an opaque id, and the
 * DApp picks one and calls `connect(networkId)`.
 *
 * Everything that can go wrong on the way to a connection is turned into a
 * {@link ConnectError} with a `kind` the UI can branch on, so no raw stack
 * trace reaches the screen.
 */
import type { ConnectedAPI, InitialAPI, APIError } from '@midnight-ntwrk/dapp-connector-api';

export type ConnectErrorKind =
  | 'not-installed'
  | 'rejected'
  /** The wallet knows this network but is currently on a different one. */
  | 'network-mismatch'
  /** The wallet does not recognise the network this build targets at all. */
  | 'network-unsupported'
  | 'disconnected'
  | 'unknown';

export class ConnectError extends Error {
  constructor(
    readonly kind: ConnectErrorKind,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ConnectError';
  }
}

/** The connector's errors are plain objects, not an Error subclass — see its docs. */
function asApiError(e: unknown): APIError | null {
  return e !== null &&
    typeof e === 'object' &&
    (e as { type?: unknown }).type === 'DAppConnectorAPIError'
    ? (e as APIError)
    : null;
}

export interface DiscoveredWallet {
  /** The key under `window.midnight`. */
  readonly id: string;
  readonly api: InitialAPI;
  readonly name: string;
  readonly icon: string;
  readonly apiVersion: string;
}

/**
 * List every wallet that has injected a connector API.
 *
 * Extensions inject asynchronously, so a hard read on first paint can miss a
 * wallet that is about to appear. Callers poll via {@link waitForWallets}.
 */
export function discoverWallets(): DiscoveredWallet[] {
  // Guarded so this module can be imported and its error mapping exercised
  // outside a browser — see tests/connector.test.ts.
  const injected = typeof window === 'undefined' ? undefined : window.midnight;
  if (!injected) return [];
  return Object.entries(injected)
    .filter(([, api]) => typeof api?.connect === 'function')
    .map(([id, api]) => ({
      id,
      api,
      // Wallet-supplied strings. React escapes them on render, and the icon is
      // only ever used as an <img src>, per the connector API's XSS warning.
      name: typeof api.name === 'string' ? api.name : id,
      icon: typeof api.icon === 'string' ? api.icon : '',
      apiVersion: typeof api.apiVersion === 'string' ? api.apiVersion : 'unknown',
    }));
}

/** Poll for injected wallets for up to `timeoutMs`. Resolves as soon as one appears. */
export async function waitForWallets(timeoutMs = 2500): Promise<DiscoveredWallet[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = discoverWallets();
    if (found.length > 0 || Date.now() >= deadline) return found;
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** Prefer Lace when several wallets are present, otherwise take the first. */
export function pickWallet(wallets: DiscoveredWallet[]): DiscoveredWallet | undefined {
  return (
    wallets.find((w) => /lace/i.test(w.api.rdns ?? '') || /lace/i.test(w.name)) ?? wallets[0]
  );
}

export interface Connection {
  readonly wallet: DiscoveredWallet;
  readonly api: ConnectedAPI;
  readonly networkId: string;
}

/**
 * Connect to `wallet` and assert it really is on `targetNetwork`.
 *
 * `connect()` takes the desired network only as a *hint*, so the reported
 * network is checked afterwards — a wallet sitting on Preview would otherwise
 * fail much later with an opaque "contract not found".
 */
export async function connectWallet(
  wallet: DiscoveredWallet,
  targetNetwork: string,
): Promise<Connection> {
  let api: ConnectedAPI;
  try {
    api = await wallet.api.connect(targetNetwork);
  } catch (e) {
    const apiErr = asApiError(e);
    if (apiErr?.code === 'Rejected' || apiErr?.code === 'PermissionRejected') {
      throw new ConnectError(
        'rejected',
        `Connection request was rejected in ${wallet.name}.`,
        apiErr.reason,
      );
    }
    if (apiErr?.code === 'Disconnected') {
      throw new ConnectError('disconnected', `${wallet.name} disconnected.`, apiErr.reason);
    }

    // A network disagreement is rejected inside `connect()`, before there is any
    // API handle to interrogate, and Lace reports it as a plain Error rather
    // than a coded APIError — so the message is the only thing to match on.
    //
    // It distinguishes two cases, and so should we: "Invalid/Unsupported
    // network ID" means this build asked for a network the wallet has never
    // heard of (our bug), while "Network ID mismatch" means the network is
    // recognised but the wallet is parked on a different one (their setting).
    const message = e instanceof Error ? e.message : String(e);
    if (/(invalid|unsupported) network id/i.test(message)) {
      throw new ConnectError(
        'network-unsupported',
        `${wallet.name} does not recognise the network "${targetNetwork}".`,
        message,
      );
    }
    if (/network[\s_-]?id mismatch|network mismatch/i.test(message)) {
      throw new ConnectError(
        'network-mismatch',
        `${wallet.name} is not on "${targetNetwork}".`,
        `Open ${wallet.name}, switch its network to ${targetNetwork}, then connect again.`,
      );
    }

    throw new ConnectError(
      'unknown',
      `${wallet.name} could not complete the connection.`,
      message,
    );
  }

  const status = await api.getConnectionStatus();
  if (status.status !== 'connected') {
    throw new ConnectError('disconnected', `${wallet.name} reported the connection was lost.`);
  }
  if (status.networkId !== targetNetwork) {
    throw new ConnectError(
      'network-mismatch',
      `Network mismatch — ${wallet.name} is on "${status.networkId}", this dApp targets "${targetNetwork}".`,
      `Switch the network in ${wallet.name} and connect again.`,
    );
  }

  // Give the wallet a chance to collect every permission this dApp needs in one
  // prompt, rather than interrupting mid-transaction.
  try {
    await api.hintUsage([
      'getConfiguration',
      'getShieldedAddresses',
      'getUnshieldedAddress',
      'getProvingProvider',
      'balanceUnsealedTransaction',
      'submitTransaction',
    ]);
  } catch (e) {
    const apiErr = asApiError(e);
    if (apiErr?.code === 'Rejected' || apiErr?.code === 'PermissionRejected') {
      throw new ConnectError(
        'rejected',
        `${wallet.name} denied the permissions this dApp needs.`,
        apiErr.reason,
      );
    }
    // Anything else here is advisory — a wallet may not implement hintUsage.
  }

  return { wallet, api, networkId: status.networkId };
}

/** Turn any post-connection connector failure into a readable message. */
export function describeWalletError(e: unknown, fallback: string): string {
  const apiErr = asApiError(e);
  if (apiErr) {
    switch (apiErr.code) {
      case 'Rejected':
      case 'PermissionRejected':
        return 'Rejected in the wallet.';
      case 'Disconnected':
        return 'The wallet disconnected. Reconnect and try again.';
      case 'InvalidRequest':
        return `The wallet rejected the request as invalid. ${apiErr.reason ?? ''}`.trim();
      default:
        return apiErr.reason || fallback;
    }
  }
  return e instanceof Error ? e.message : fallback;
}

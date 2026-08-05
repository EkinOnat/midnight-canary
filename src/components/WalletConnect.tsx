/**
 * Wallet connect / disconnect, and the notice strip that reports why a
 * connection failed.
 *
 * Two exports because the two pieces live in different places on the page: the
 * control sits in the top rail as ambient context, while a failure needs the
 * full width because it concerns the whole page.
 *
 * The connector API warns that a wallet's `name` and `icon` are attacker-
 * controllable strings. `name` therefore only ever lands in a text node (React
 * escapes it) and `icon` only ever in an `<img src>` — never in markup, and
 * never as a URL we navigate to.
 */
import type { MidnightSession } from '../hooks/useMidnight';

export function WalletConnect({ session }: { session: MidnightSession }) {
  const { status, wallets, walletName, address, connect, disconnect, targetNetwork } = session;

  const connected = status === 'connected';
  const busy = status === 'connecting' || status === 'detecting';
  const noWallet = wallets.length === 0 && status !== 'detecting';

  if (connected) {
    return (
      <div className="rail-wallet">
        <span className="rail-status">
          <i className="dot dot-live" aria-hidden="true" />
          {walletName}
        </span>
        <code className="trunc" title={address ?? undefined}>
          {address}
        </code>
        <button type="button" className="act" onClick={disconnect}>
          Disconnect
        </button>
      </div>
    );
  }

  // More than one wallet injected a connector API — let the person choose
  // rather than guessing on their behalf.
  if (wallets.length > 1) {
    return (
      <div className="rail-wallet">
        {wallets.map((w) => (
          <button
            key={w.id}
            type="button"
            className="act"
            disabled={busy}
            onClick={() => void connect(w)}
          >
            {w.name}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="rail-wallet">
      <span className="rail-status">
        <i className="dot" aria-hidden="true" />
        {noWallet ? 'No wallet' : 'Not connected'}
      </span>
      {noWallet ? (
        <a className="act" href="https://www.lace.io/" target="_blank" rel="noreferrer noopener">
          Install Lace
        </a>
      ) : (
        <button type="button" className="act" disabled={busy} onClick={() => void connect()}>
          {status === 'detecting'
            ? 'Looking…'
            : status === 'connecting'
              ? `Approve in wallet`
              : `Connect on ${targetNetwork}`}
        </button>
      )}
    </div>
  );
}

/** The failure strip. Renders nothing when there is nothing wrong. */
export function WalletNotice({ session }: { session: MidnightSession }) {
  if (!session.error) return null;
  return (
    <div className="notice" role="alert">
      <span className="notice-tag">Wallet</span>
      <span>{session.error}</span>
      {session.errorHint ? <span className="notice-hint">{session.errorHint}</span> : null}
    </div>
  );
}

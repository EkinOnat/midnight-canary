/**
 * The last error state, and the only one React will not let a hook handle.
 *
 * Everything recoverable is already caught closer to where it happens — wallet
 * failures in `useMidnight`, circuit-call failures in `CircuitCall`, indexer
 * failures in the pulse read. What is left is a render or lifecycle throw: a
 * malformed ledger response, a WASM module that fails to initialise. Without a
 * boundary those unmount the whole tree and leave a blank page, which on a page
 * about privacy reads far worse than an error — it reads like something went
 * wrong with your data.
 *
 * So the fallback says the one thing that actually matters here: the score and
 * the identity secret never left this device, and a crash does not change that.
 * It is true by construction — both live in a ref and in the local encrypted
 * store, and neither is in any React state this boundary could have been
 * rendering.
 *
 * The message is deliberately not sent anywhere. There is no error-reporting
 * endpoint, because a stack trace from this app is still a network request the
 * README promises it does not make.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  readonly children: ReactNode;
}

interface State {
  readonly message: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return {
      message: error instanceof Error ? error.message : String(error),
    };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Not reported anywhere on purpose — see the note above. React has already
    // logged it to the console in development, which is where a developer
    // would look for `info.componentStack`.
    void error;
    void info;
  }

  private readonly reload = () => window.location.reload();

  override render(): ReactNode {
    const { message } = this.state;
    if (message === null) return this.props.children;

    return (
      <div className="shell">
        <div className="notice" role="alert">
          <span className="notice-tag">Error</span>
          <span>The page stopped working.</span>
          <span className="notice-hint">Reloading usually clears it.</span>
        </div>

        <main className="crash">
          <h1 className="headline">Nothing of yours was in flight.</h1>
          <p className="standfirst">
            Your score and your identity secret never leave this device, so a crash here
            cannot have exposed them. Whatever failed, failed while drawing the page.
          </p>

          <p className="crash-detail">
            <code className="wrapcode">{message}</code>
          </p>

          <button type="button" className="act act-key" onClick={this.reload}>
            Reload
          </button>

          <p className="crash-foot">
            If it keeps happening, the contract&rsquo;s public state is still readable
            without this page — see{' '}
            <a
              href="https://github.com/EkinOnat/midnight-canary#verify-the-deployment"
              target="_blank"
              rel="noreferrer noopener"
            >
              Verify the Deployment
            </a>
            .
          </p>
        </main>
      </div>
    );
  }
}

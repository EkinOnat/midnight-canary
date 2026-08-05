/**
 * The Midnight.js SDK hook: wallet session, providers, and the deployed
 * contract, exposed as one piece of React state.
 *
 * Deliberately holds no private data. The responder's identity secret and
 * wellbeing score never enter this hook's state — they are written straight
 * into the private-state store at call time by `CircuitCall`, so there is no
 * React state that could end up rendered or in a devtools snapshot.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';

import { CONTRACT_ADDRESS, PRIVATE_STATE_ID, TARGET_NETWORK, isConfigured } from '../config';
import {
  ConnectError,
  connectWallet,
  pickWallet,
  waitForWallets,
  type DiscoveredWallet,
} from '../lib/connector';
import { buildProviders, publicDataProviderFor, type CanaryProviders } from '../lib/providers';
import type { PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';
import { compiledContract, readPulse, scrubbedPrivateState, type PublicPulse } from '../lib/canary';

export type ConnectionStatus = 'idle' | 'detecting' | 'connecting' | 'connected' | 'error';

export interface MidnightSession {
  readonly status: ConnectionStatus;
  readonly error: string | null;
  readonly errorHint: string | null;
  /** Wallets that have injected a connector API. Empty means none installed. */
  readonly wallets: readonly DiscoveredWallet[];
  readonly walletName: string | null;
  readonly walletIcon: string | null;
  readonly address: string | null;
  readonly networkId: string | null;
  readonly indexerUri: string | null;
  readonly contractAddress: string;
  readonly targetNetwork: string;
  readonly pulse: PublicPulse | null;
  readonly pulseError: string | null;
  connect(wallet?: DiscoveredWallet): Promise<void>;
  disconnect(): void;
  refreshPulse(): Promise<void>;
  /** Available once connected; used by `CircuitCall` to invoke `checkIn`. */
  readonly providers: CanaryProviders | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly contract: any | null;
}

export function useMidnight(): MidnightSession {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const [wallets, setWallets] = useState<readonly DiscoveredWallet[]>([]);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [walletIcon, setWalletIcon] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [networkId, setNetworkId] = useState<string | null>(null);
  const [indexerUri, setIndexerUri] = useState<string | null>(null);
  const [providers, setProviders] = useState<CanaryProviders | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [contract, setContract] = useState<any | null>(null);
  const [pulse, setPulse] = useState<PublicPulse | null>(null);
  const [pulseError, setPulseError] = useState<string | null>(null);

  const apiRef = useRef<ConnectedAPI | null>(null);
  const providersRef = useRef<CanaryProviders | null>(null);
  // Wallet-free indexer client, built once and reused for reads before connect
  // and after disconnect.
  const publicOnlyRef = useRef<PublicDataProvider | null>(null);
  const publicOnly = () =>
    (publicOnlyRef.current ??= publicDataProviderFor(TARGET_NETWORK));

  // Extensions inject asynchronously, so poll briefly on mount rather than
  // reading window.midnight once and declaring the wallet missing.
  useEffect(() => {
    let cancelled = false;
    setStatus('detecting');
    waitForWallets().then((found) => {
      if (cancelled) return;
      setWallets(found);
      setStatus('idle');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const readPulseFrom = useCallback(async (dataProvider: PublicDataProvider) => {
    try {
      const state = await dataProvider.queryContractState(CONTRACT_ADDRESS);
      if (!state) {
        setPulse(null);
        setPulseError(`No contract state found at this address on ${TARGET_NETWORK}.`);
        return;
      }
      setPulse(readPulse(state));
      setPulseError(null);
    } catch (e) {
      setPulseError(e instanceof Error ? e.message : 'Could not read public state.');
    }
  }, []);

  // The counters are public, so show them straight away rather than making
  // people connect a wallet to read something anyone can read.
  useEffect(() => {
    if (!isConfigured) return;
    let cancelled = false;
    void (async () => {
      const state = await publicOnly()
        .queryContractState(CONTRACT_ADDRESS)
        .catch(() => null);
      if (cancelled) return;
      if (state) {
        setPulse(readPulse(state));
        setPulseError(null);
      } else {
        setPulseError(`Could not reach the ${TARGET_NETWORK} indexer.`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disconnect = useCallback(() => {
    apiRef.current = null;
    providersRef.current = null;
    setProviders(null);
    setContract(null);
    setAddress(null);
    setNetworkId(null);
    setIndexerUri(null);
    // The pulse is public — no reason to blank it just because the wallet went
    // away.
    setWalletName(null);
    setWalletIcon(null);
    setError(null);
    setErrorHint(null);
    setStatus('idle');
  }, []);

  const connect = useCallback(
    async (preferred?: DiscoveredWallet) => {
      setError(null);
      setErrorHint(null);

      if (!isConfigured) {
        setStatus('error');
        setError('This build has no contract address configured.');
        setErrorHint('Set VITE_CONTRACT_ADDRESS and rebuild.');
        return;
      }

      setStatus('connecting');
      try {
        const found = preferred ? [preferred] : ((await waitForWallets()) as DiscoveredWallet[]);
        setWallets(found);
        const wallet = preferred ?? pickWallet(found);
        if (!wallet) {
          throw new ConnectError(
            'not-installed',
            'No Midnight wallet detected.',
            'Install the Lace wallet extension, then reload this page.',
          );
        }

        const connection = await connectWallet(wallet, TARGET_NETWORK);
        apiRef.current = connection.api;

        const built = await buildProviders(connection.api, connection.networkId);
        providersRef.current = built.providers;

        // Seeds the private state on first connect. `findDeployedContract`
        // keeps any state already stored for this contract, so an existing
        // identity survives a reconnect.
        const found_ = await findDeployedContract(built.providers, {
          compiledContract: compiledContract as never,
          contractAddress: CONTRACT_ADDRESS,
          privateStateId: PRIVATE_STATE_ID,
          initialPrivateState: scrubbedPrivateState(),
        });

        setProviders(built.providers);
        setContract(found_);
        setAddress(built.unshieldedAddress);
        setIndexerUri(built.indexerUri);
        setNetworkId(connection.networkId);
        setWalletName(wallet.name);
        setWalletIcon(wallet.icon || null);
        setStatus('connected');

        await readPulseFrom(built.providers.publicDataProvider);
      } catch (e) {
        apiRef.current = null;
        providersRef.current = null;
        setProviders(null);
        setContract(null);
        setStatus('error');
        if (e instanceof ConnectError) {
          setError(e.message);
          setErrorHint(e.detail ?? hintFor(e.kind));
        } else {
          setError(e instanceof Error ? e.message : 'Could not connect.');
          setErrorHint(null);
        }
      }
    },
    [readPulseFrom],
  );

  const refreshPulse = useCallback(async () => {
    await readPulseFrom(providersRef.current?.publicDataProvider ?? publicOnly());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readPulseFrom]);

  return {
    status,
    error,
    errorHint,
    wallets,
    walletName,
    walletIcon,
    address,
    networkId,
    indexerUri,
    contractAddress: CONTRACT_ADDRESS,
    targetNetwork: TARGET_NETWORK,
    pulse,
    pulseError,
    connect,
    disconnect,
    refreshPulse,
    providers,
    contract,
  };
}

function hintFor(kind: ConnectError['kind']): string | null {
  switch (kind) {
    case 'not-installed':
      return 'Install the Lace wallet extension, then reload this page.';
    case 'rejected':
      return 'Approve the connection request in the wallet popup and try again.';
    case 'network-mismatch':
      return `Switch your wallet to ${TARGET_NETWORK} and connect again.`;
    case 'network-unsupported':
      return `This build targets "${TARGET_NETWORK}". Set VITE_MIDNIGHT_NETWORK to a network your wallet supports.`;
    case 'disconnected':
      return 'Unlock the wallet and connect again.';
    default:
      return null;
  }
}

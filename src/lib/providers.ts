/**
 * Turn a connected Lace session into the provider set Midnight.js expects.
 *
 * Midnight.js wants six providers. Four are off-the-shelf; two —
 * `walletProvider` and `midnightProvider` — are the adapter between
 * Midnight.js's live `Transaction` objects and the connector API's string
 * interface. That adapter is the whole of this file.
 *
 * Where proving happens matters for the privacy claim, so to be precise:
 * `getProvingProvider` hands back a prover owned by the *wallet*, which the
 * user configures and which runs on their machine. The witness values are fed
 * into it locally; they are not sent to this dApp's server (there isn't one)
 * and not to any third party.
 */
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  createProofProvider,
  type MidnightProviders,
  type UnboundTransaction,
} from '@midnight-ntwrk/midnight-js-types';
import type { FinalizedTransaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { parseCoinPublicKeyToHex, parseEncPublicKeyToHex } from '@midnight-ntwrk/midnight-js-utils';

import {
  CONTRACT_ADDRESS,
  PRIVATE_STATE_ID,
  PRIVATE_STATE_PASSWORD,
  zkConfigBaseUrl,
  fallbackIndexer,
} from '../config';
import { getStoragePassword } from './identity';
import { decodeFinalizedTx, encodeTx } from './tx-codec';
import { emitCallPhase } from './progress';
import type { CanaryCircuitId, CanaryPrivateState } from './canary';

export type CanaryProviders = MidnightProviders<
  CanaryCircuitId,
  typeof PRIVATE_STATE_ID,
  CanaryPrivateState
>;

export interface BuiltProviders {
  readonly providers: CanaryProviders;
  /** The wallet's own address, for display. */
  readonly unshieldedAddress: string;
  /** Which indexer we ended up talking to — the wallet's, or our fallback. */
  readonly indexerUri: string;
}

/**
 * An indexer client that needs no wallet.
 *
 * Canary's counters are public by construction, so the page can show them
 * before anyone connects. Uses the network's default indexer, since there is no
 * wallet yet to nominate one.
 *
 * The third argument is passed explicitly because the provider defaults it to
 * `isomorphic-ws`'s `WebSocket` named export, which does not exist in that
 * package's browser build.
 */
export function publicDataProviderFor(network: string) {
  const fb = fallbackIndexer(network);
  setNetworkId(network);
  return indexerPublicDataProvider(
    fb.http,
    fb.ws,
    WebSocket as unknown as Parameters<typeof indexerPublicDataProvider>[2],
  );
}

export async function buildProviders(
  api: ConnectedAPI,
  networkId: string,
): Promise<BuiltProviders> {
  // Bech32m keys and addresses are network-tagged, so the decoders need to know
  // which network they are looking at before anything is parsed.
  setNetworkId(networkId);

  const [config, shielded, unshielded] = await Promise.all([
    api.getConfiguration().catch(() => null),
    api.getShieldedAddresses(),
    api.getUnshieldedAddress(),
  ]);

  // Prefer the wallet's configured indexer: the user may have pointed it at an
  // instance they trust, and Midnight's guidance is to respect that.
  const fallback = fallbackIndexer(networkId);
  const indexerUri = config?.indexerUri || fallback.http;
  const indexerWsUri = config?.indexerWsUri || fallback.ws;

  // Prover keys and ZKIR are served from this origin under /managed/canary/.
  //
  // The bound fetch is required, not defensive. FetchZkConfigProvider stores
  // its fetch on the instance and calls it as `this.fetchFunc(...)`, and
  // cross-fetch's browser build re-exports the *unbound* global fetch — so the
  // default invokes native fetch with the provider as `this` and the browser
  // rejects it with "Failed to execute 'fetch' on 'Window': Illegal
  // invocation". It surfaces at connect, because findDeployedContract fetches
  // the verifier keys to check them against the deployed contract.
  const zkConfigProvider = new FetchZkConfigProvider<CanaryCircuitId>(
    zkConfigBaseUrl(),
    globalThis.fetch.bind(globalThis),
  );

  // Proving is delegated to the wallet, which proves locally. `KeyMaterialProvider`
  // is the connector's name for the same three methods `ZKConfigProvider` exposes.
  const provingProvider = await api.getProvingProvider(zkConfigProvider.asKeyMaterialProvider());
  const baseProofProvider = createProofProvider(provingProvider);

  // A thin wrapper so the UI can distinguish proving from submitting. It
  // forwards the call untouched and emits only the phase name.
  const proofProvider = {
    proveTx: (...args: Parameters<typeof baseProofProvider.proveTx>) => {
      emitCallPhase('proving');
      return baseProofProvider.proveTx(...args);
    },
  };

  const coinPublicKey = parseCoinPublicKeyToHex(shielded.shieldedCoinPublicKey, networkId);
  const encryptionPublicKey = parseEncPublicKeyToHex(shielded.shieldedEncryptionPublicKey, networkId);

  const walletProvider = {
    getCoinPublicKey: () => coinPublicKey,
    getEncryptionPublicKey: () => encryptionPublicKey,

    /**
     * A proven contract call is unbalanced: it has no fee payment and no
     * binding. The wallet adds both. `balanceUnsealedTransaction` is the right
     * call here (rather than `balanceSealedTransaction`) precisely because the
     * transaction is still unbound at this point.
     */
    async balanceTx(tx: UnboundTransaction): Promise<FinalizedTransaction> {
      emitCallPhase('balancing');
      const { tx: balanced } = await api.balanceUnsealedTransaction(encodeTx(tx));
      return decodeFinalizedTx(balanced);
    },
  };

  const midnightProvider = {
    /**
     * The connector resolves with `void`, but Midnight.js wants the id it can
     * watch for. A transaction carries its own identifiers, so we read one off
     * the object we just submitted rather than inventing one.
     */
    async submitTx(tx: FinalizedTransaction): Promise<string> {
      emitCallPhase('submitting');
      await api.submitTransaction(encodeTx(tx));
      const [identifier] = tx.identifiers();
      emitCallPhase('confirming');
      return identifier ?? tx.transactionHash();
    },
  };

  const privateStateProvider = levelPrivateStateProvider<
    typeof PRIVATE_STATE_ID,
    CanaryPrivateState
  >({
    privateStateStoreName: 'canary-state',
    // Scopes the store per wallet, so two accounts in the same browser do not
    // read each other's identity secrets.
    accountId: unshielded.unshieldedAddress,
    privateStoragePasswordProvider: () => getStoragePassword(PRIVATE_STATE_PASSWORD),
  });
  privateStateProvider.setContractAddress(CONTRACT_ADDRESS);

  const providers: CanaryProviders = {
    privateStateProvider,
    // The third argument is passed explicitly because the provider defaults it
    // to `isomorphic-ws`'s `WebSocket` named export, which does not exist in
    // that package's browser build. Handing it the platform WebSocket avoids
    // relying on a downstream undefined-check.
    publicDataProvider: indexerPublicDataProvider(
      indexerUri,
      indexerWsUri,
      WebSocket as unknown as Parameters<typeof indexerPublicDataProvider>[2],
    ),
    zkConfigProvider,
    proofProvider,
    walletProvider,
    midnightProvider,
  };

  return { providers, unshieldedAddress: unshielded.unshieldedAddress, indexerUri };
}

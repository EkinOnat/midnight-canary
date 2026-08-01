/**
 * CLI for interacting with the deployed Canary contract.
 *
 * Check in privately, read the public pulse, or (as admin) close a round.
 *
 * Your identity secret is derived locally from a passphrase you type; it is
 * never transmitted and never written to the ledger. Different passphrases are
 * different responders, which is what lets one operator demo a multi-person
 * round against a single wallet.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as nodeCrypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';

// Midnight SDK imports
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { resolveNetwork, getOrCreateSeed, getDeployment } from './network';
import { createWallet, persistWalletState, unshieldedToken, type WalletContext } from './wallet';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { witnesses, createCanaryPrivateState, type CanaryPrivateState } from './witnesses';
import type * as CanaryModule from '../managed/canary/contract/index.js';

// Enable WebSocket for GraphQL subscriptions
// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

// Must match the privateStateId used at deploy time so the CLI reconnects to
// the same private state.
const PRIVATE_STATE_ID = 'canaryPrivateState';

const { network, config: networkConfig } = resolveNetwork();
const SEED = getOrCreateSeed(network);

// Same derivation as deploy.ts — whoever holds the wallet seed is the admin.
function deriveAdminSecret(seed: string): Uint8Array {
  return new Uint8Array(
    nodeCrypto.createHash('sha256').update(`canary:admin-secret:v1:${seed}`).digest(),
  );
}

// A responder's identity secret. Stays on this machine; only its hash (mixed
// with the round number) ever reaches the chain, as a nullifier.
function deriveIdentitySecret(passphrase: string): Uint8Array {
  return new Uint8Array(
    nodeCrypto.createHash('sha256').update(`canary:identity:v1:${passphrase}`).digest(),
  );
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'managed', 'canary');
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');

if (!fs.existsSync(contractPath)) {
  console.error('\n❌ Contract not compiled! Run: npm run compile\n');
  process.exit(1);
}

// Loaded at runtime (only exists after `npm run compile`), typed statically.
const Canary = (await import(
  pathToFileURL(contractPath).href
)) as typeof CanaryModule;

const compiledContract = CompiledContract.make<
  CanaryModule.Contract<CanaryPrivateState>,
  CanaryPrivateState
>('canary', Canary.Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

// ─── Providers ─────────────────────────────────────────────────────────────────

async function createProviders(walletCtx: WalletContext) {
  // The SDK requires the private-state password to be at least 16 characters.
  // The default below is a placeholder for local devnet only — set a strong
  // password via PRIVATE_STATE_PASSWORD when you move to a non-local target.
  const privateStatePassword = process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Local-Devnet-Development-Placeholder-1';

  const walletProvider = {
    // In Midnight.js 4.1.x the WalletProvider interface returns the key objects
    // (CoinPublicKey / EncPublicKey) directly — no longer hex strings.
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      // balanceUnboundTransaction -> finalizeRecipe is the complete balancing
      // path in wallet-sdk 1.x; the earlier explicit signRecipe step is gone.
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return walletCtx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const accountId = walletCtx.unshieldedKeystore.getBech32Address().toString();

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'canary-state',
      accountId,
      privateStoragePasswordProvider: () => privateStatePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

// ─── Public state rendering ────────────────────────────────────────────────────

async function showPulse(providers: any, address: string) {
  const contractState = await providers.publicDataProvider.queryContractState(address);
  if (!contractState) {
    console.log('\n  No contract state found.\n');
    return;
  }
  const l = Canary.ledger(contractState.data);
  const responses = Number(l.responses);
  const alerts = Number(l.alerts);
  const pct = responses === 0 ? 0 : Math.round((alerts / responses) * 100);

  console.log('\n  ── Public pulse ────────────────────────────');
  console.log(`  Round:            ${l.round}`);
  console.log(`  Responses:        ${responses}`);
  console.log(`  Alerts:           ${alerts}${responses ? `  (${pct}%)` : ''}`);
  console.log(`  Alert threshold:  score <= ${l.alertThreshold}`);
  console.log(`  Nullifiers:       ${l.checkedIn.size()}`);
  console.log('  ────────────────────────────────────────────');
  console.log('  Note: no individual score is recoverable from any of the above.\n');
}

// ─── Main CLI ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                        Canary CLI                            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const rl = createInterface({ input: stdin, output: stdout });

  const deployment = getDeployment(network);
  if (!deployment) {
    console.error(`No deploy on file for network ${network}. Run \`npm run deploy -- --network ${network}\` first.`);
    process.exit(1);
  }
  console.log(`  Contract: ${deployment.address}`);
  console.log(`  Network: ${network}\n`);

  try {
    const seed = SEED;

    console.log('  Connecting to wallet...');
    const walletCtx = await createWallet({ network, networkConfig, seed });
    const restoredCount = Object.values(walletCtx.restored).filter(Boolean).length;
    if (restoredCount > 0) {
      console.log(`  Restored ${restoredCount}/3 child wallets from .midnight-wallet-state — sync will resume from saved point.`);
    }

    console.log('  Syncing with network...');
    console.log('  ℹ  This may take several minutes depending on network size.');
    console.log('     RPC disconnection messages during sync are normal and can be safely ignored.\n');
    const syncStart = Date.now();
    const syncInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - syncStart) / 1000);
      process.stdout.write(`\r  ⏳ Still syncing... (${elapsed}s elapsed)   `);
    }, 5000);
    const state = await walletCtx.wallet.waitForSyncedState();
    clearInterval(syncInterval);
    process.stdout.write('\r  ✓ Synced with network.                                      \n');

    await persistWalletState(network, walletCtx);
    const balance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
    console.log(`  Balance: ${balance.toLocaleString()} tNight\n`);

    // Reads work without funds, but writes need DUST generated from registered
    // NIGHT — without this hint the next failure is a confusing
    // "Insufficient Funds" deep inside the tx builder.
    if (balance === 0n && network !== 'undeployed' && networkConfig.faucet) {
      const address = walletCtx.unshieldedKeystore.getBech32Address();
      console.log('  ⚠ Wallet has no tNight. Fund it from the faucet to send transactions:');
      console.log(`     ${networkConfig.faucet}`);
      console.log(`     Wallet address: ${address}\n`);
    }

    console.log('  Connecting to contract...');
    const providers = await createProviders(walletCtx);

    const deployed: any = await findDeployedContract(providers, {
      compiledContract: compiledContract as any,
      contractAddress: deployment.address,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: createCanaryPrivateState(deriveAdminSecret(seed), 3),
    });

    console.log('  ✅ Connected!\n');

    /** Swap the local private state before a circuit call reads its witnesses. */
    const setPrivateState = async (ps: CanaryPrivateState) => {
      await providers.privateStateProvider.set(PRIVATE_STATE_ID, ps);
    };

    let running = true;
    while (running) {
      console.log('─── Menu ───────────────────────────────────────────────────────');
      console.log('  1. Check in (private score)');
      console.log('  2. Read the public pulse');
      console.log('  3. Close the round (admin only)');
      console.log('  4. Check wallet balance');
      console.log('  5. Exit\n');

      const choice = await rl.question('  Your choice: ');

      switch (choice.trim()) {
        case '1': {
          const passphrase = (await rl.question('  Identity passphrase (stays local): ')).trim();
          if (!passphrase) {
            console.log('\n  ❌ An identity passphrase is required.\n');
            break;
          }
          const raw = (await rl.question('  Your wellbeing score (1-5, stays private): ')).trim();
          const score = Number(raw);
          if (!Number.isInteger(score) || score < 1 || score > 5) {
            console.log('\n  ❌ Score must be a whole number from 1 to 5.\n');
            break;
          }

          console.log('\n  Submitting (proof generation may take 30-60 seconds)...');
          try {
            await setPrivateState(createCanaryPrivateState(deriveIdentitySecret(passphrase), score));
            const tx = await deployed.callTx.checkIn();
            console.log('\n  ✅ Checked in.');
            console.log(`  Transaction ID: ${tx.public.txId}`);
            console.log(`  Block height: ${tx.public.blockHeight}`);
            console.log('\n  Your score was NOT sent. The chain learned only that one more');
            console.log('  person responded, and whether that response was an alert.\n');
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error('\n  ❌ Failed:', msg);
            if (/already checked in/i.test(msg)) {
              console.error('  That identity has already checked in this round.\n');
            }
          }
          break;
        }

        case '2': {
          console.log('\n  Reading public state from the indexer...');
          try {
            await showPulse(providers, deployment.address);
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '3': {
          console.log('\n  Closing the round (admin)...');
          try {
            await setPrivateState(createCanaryPrivateState(deriveAdminSecret(seed), 3));
            const tx = await deployed.callTx.closeRound();
            console.log('\n  ✅ Round closed. Counters and nullifiers reset.');
            console.log(`  Transaction ID: ${tx.public.txId}\n`);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error('\n  ❌ Failed:', msg);
            if (/only the admin/i.test(msg)) {
              console.error('  This wallet is not the deployer, so it cannot close rounds.\n');
            }
          }
          break;
        }

        case '4': {
          console.log('\n  Checking balance...');
          const currentState = await walletCtx.wallet.waitForSyncedState();
          const currentBalance = currentState.unshielded.balances[unshieldedToken().raw] ?? 0n;
          const dustBalance = currentState.dust.balance(new Date());
          console.log(`\n  tNight: ${currentBalance.toLocaleString()}`);
          console.log(`  DUST: ${dustBalance.toLocaleString()}\n`);
          break;
        }

        case '5':
          running = false;
          console.log('\n  👋 Goodbye!\n');
          break;

        default:
          console.log('\n  ❌ Invalid choice. Please enter 1-5.\n');
      }
    }

    await persistWalletState(network, walletCtx);
    await walletCtx.wallet.stop();
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
  } finally {
    rl.close();
  }
}

main().catch(console.error);

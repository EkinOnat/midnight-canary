/**
 * Proves the contract is deployed and live, by reading its public state back
 * off the indexer. No wallet and no funds needed — public state is public.
 *
 *   npm run verify -- --network preview
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';

import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import {
  resolveNetwork,
  getDeployment,
  parseAddressFlag,
  PUBLIC_DEPLOYMENTS,
} from './network';
import type * as CanaryModule from '../managed/canary/contract/index.js';

// @ts-expect-error Required for the indexer's GraphQL subscriptions
globalThis.WebSocket = WebSocket;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contractPath = path.resolve(__dirname, '..', 'managed', 'canary', 'contract', 'index.js');

if (!fs.existsSync(contractPath)) {
  console.error('\n❌ Contract not compiled! Run: npm run compile\n');
  process.exit(1);
}

const Canary = (await import(pathToFileURL(contractPath).href)) as typeof CanaryModule;

async function main() {
  const { network, config } = resolveNetwork();

  // Explicit flag, then the local deployment record, then the address this
  // project published. The record is gitignored — it holds the wallet seed —
  // so without the last fallback this command only ever ran for whoever did
  // the deploying, which defeats the point of a verification tool.
  const override = parseAddressFlag(process.argv);
  const deployment = getDeployment(network);
  const address = override ?? deployment?.address ?? PUBLIC_DEPLOYMENTS[network];

  if (!address) {
    console.error(`\n❌ No deployment on record for "${network}", and none published.`);
    console.error(`   Run: npm run deploy -- --network ${network}`);
    console.error(`   Or verify a specific contract: npm run verify -- --address <hex>\n`);
    process.exit(1);
  }

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                  Canary — deployment check                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  console.log(`  Network:      ${network}`);
  console.log(`  Contract:     ${address}`);
  if (deployment && !override) {
    console.log(`  Deployed at:  ${deployment.deployedAt}`);
    console.log(`  Deployer:     ${deployment.deployer}`);
  } else if (!override) {
    // Say so rather than implying a local record exists.
    console.log(`  Source:       published address for ${network} (no local deployment record)`);
  }
  console.log(`  Indexer:      ${config.indexer}\n`);

  console.log('  Querying on-chain state...');
  const provider = indexerPublicDataProvider(config.indexer, config.indexerWS);
  const contractState = await provider.queryContractState(address);

  if (!contractState) {
    console.error('\n  ❌ Indexer returned no state for that address.\n');
    process.exit(1);
  }

  const l = Canary.ledger(contractState.data);
  const responses = Number(l.responses);
  const alerts = Number(l.alerts);

  console.log('  ✅ Contract found on-chain.\n');
  console.log('  ── Public ledger state ─────────────────────');
  console.log(`  round             ${l.round}`);
  console.log(`  responses         ${responses}`);
  console.log(`  alerts            ${alerts}`);
  console.log(`  alertThreshold    score <= ${l.alertThreshold}`);
  console.log(`  checkedIn         ${l.checkedIn.size()} nullifier(s)`);
  console.log(`  admin             ${Buffer.from(l.admin).toString('hex').slice(0, 24)}...`);
  console.log('  ────────────────────────────────────────────\n');
  console.log('  Everything above is the ENTIRE public footprint of this contract.');
  console.log('  No wellbeing score and no responder identity appears anywhere in it.\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌', err instanceof Error ? err.message : err, '\n');
  process.exit(1);
});

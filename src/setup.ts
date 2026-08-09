// Orchestrator for `npm run setup`. Replaces the prior package.json chain
// `docker compose up -d --wait && npm run compile && npm run deploy` so
// we can branch on --network and forward it to deploy.
import { spawnSync } from 'node:child_process';
import { resolveNetwork, setActiveNetwork, parseNetworkFlag } from './network';

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  if (r.status !== 0) {
    process.stderr.write(`\nCommand failed: ${cmd} ${args.join(' ')}\n`);
    process.exit(r.status ?? 1);
  }
}

async function main(): Promise<void> {
  const argv = process.argv;
  const flag = parseNetworkFlag(argv);
  if (flag) setActiveNetwork(flag);
  const { network, config } = resolveNetwork({ argv });

  process.stdout.write(`\n→ Setting up canary on network: ${network}\n\n`);

  // 1. Bring up only the services this network needs.
  run('docker', ['compose', 'up', '-d', '--wait', ...config.composeServices]);

  // 2. Compile the contract (network-agnostic).
  run('npm', ['run', 'compile']);

  // 3. Deploy, naming the network rather than letting deploy.ts resolve its
  //    own. It is forwarded as a positional because npm on Windows claims
  //    `--network` as one of its own config options and drops it, and it is
  //    always forwarded — the `undeployed` case used to pass nothing and lean
  //    on the default, which is exactly the kind of coupling that broke when
  //    the default changed.
  run('npm', ['run', 'deploy', '--', network]);
}

main().catch((e) => {
  process.stderr.write(`\nSetup failed: ${(e as Error).message}\n`);
  process.exit(1);
});

# Canary

> An anonymous early-warning pulse for teams: members submit a private wellbeing score, and the chain learns only how many people are struggling — never who, and never their score.

## Contract Address

| Network  | Address                                                            |
|----------|--------------------------------------------------------------------|
| Preview  | `713e14035854aee952c8f2c56f2b871f14f1ce8a8b59d2fa96e51f9d2204bbc8` |
| Preprod  | _not deployed_                                                     |

Deployer wallet (Preview): `mn_addr_preview19d33qe75jerz3awkld4r6fw6ghnmfpp83mna23w55my9jvkpvu5q33pat6`

<sub>A `hello-world` contract was also deployed to Preview at
`3ae77641aa1122229570d8a813b7e65058253d900c780753e0d29e7e9d0e16b5` to validate the
deployment pipeline before building Canary.</sub>

## What This Does

Every organisation that has ever run an anonymous wellbeing survey has the same
problem: nobody believes it's actually anonymous. The survey tool can see your
answer. HR can see your answer. So people answer strategically, and the signal
the organisation gets back is worthless precisely when it matters most.

Canary fixes that at the cryptographic level rather than the policy level.

A team runs a **pulse round**. Each member privately submits a wellbeing score
from 1 to 5. What lands on-chain is:

- how many people checked in, and
- how many of them were at or below the alert threshold.

That's it. Not the scores. Not who submitted. Not even *whether a specific person*
submitted. The organisation gets an honest aggregate — "9 responses, 4 alerts" —
and no one, including whoever deployed the contract, can decompose it back into
individuals.

Each person can only check in once per round, enforced by a **nullifier**: a
one-way hash of their secret key and the round number. It proves "an eligible
person who hasn't already checked in is checking in now" without identifying
them. Because the round number is mixed into the hash, the same person's
nullifiers across different rounds are unlinkable — you can't follow someone's
trajectory over time.

## Privacy Model

**PUBLIC** — on-chain, visible to anyone:

| Field | Meaning |
|---|---|
| `round` | Which pulse round is currently open |
| `responses` | How many people checked in this round |
| `alerts` | How many of those were at or below the threshold |
| `checkedIn` | Set of opaque 32-byte nullifiers |
| `alertThreshold` | The cutoff (default 2), public so the aggregate is interpretable |
| `admin` | A hash of the deployer's secret, used to gate `closeRound()` |

**PRIVATE** — witnesses that never leave the responder's machine:

| Witness | Meaning |
|---|---|
| `localSecretKey()` | The responder's 32-byte identity secret |
| `wellbeingScore()` | The actual 1–5 score |

Neither is ever written to the ledger, passed as a public circuit argument, or
included in a transaction. They exist only as inputs to the zero-knowledge proof.

**What the user PROVES without revealing:**

> "I hold a secret key, I have not already checked in this round, and my score is
> a valid value between 1 and 5."

...while revealing exactly two things:

1. **A round-scoped nullifier.** A one-way hash — it identifies nobody, and is
   unlinkable across rounds.
2. **One bit** — whether the score was at or below `alertThreshold`.

That single bit is the entire deliberate disclosure of this contract, and it is
the whole reason `disclose()` appears in the source:

```compact
// Disclosure #2 — and the last: exactly one bit about a private score.
if (disclose(isAlert(score, alertThreshold))) {
  alerts.increment(1);
}
```

A score of 1 and a score of 2 are **indistinguishable on-chain** (both alert), as
are 3, 4 and 5 (none alert). This isn't a claim in a comment — it's asserted in
the test suite, which runs two check-ins differing only in the private score and
requires the resulting public state to be byte-identical. See
`tests/canary.test.ts`, block 5.

### A note on identity

Identity is derived from a hash of a private secret, **not** from
`ownPublicKey()`. `ownPublicKey()` returns a prover-claimed value with no
cryptographic binding to the transaction signer, so any access check built on it
is bypassable. The admin role is `persistentHash("canary:admin:v1", secret)`,
frozen into the ledger at construction.

### Known limits

Honest about what this does *not* do:

- **Aggregate leakage.** With one responder, `alerts` trivially reveals that
  person's bracket. The privacy guarantee is meaningful at team scale, not n=1.
- **Eligibility is open.** Anyone holding any secret key can check in once; the
  contract does not yet verify membership in an allowlist. Adding a Merkle-tree
  membership proof is the natural next step.
- **Timing metadata.** The chain sees *when* each check-in transaction arrives.
  A determined observer correlating submission times with other signals could
  narrow down who submitted, even though the contract itself reveals nothing.

## Tech Stack

- **Midnight Network** — Preview testnet
- **Compact** — language version 0.23.0 (compiler 0.31.1, `compact` CLI 0.5.1)
- **Node.js** v22.23.2
- **Docker** — `midnightntwrk/proof-server` on port 6300
- `@midnight-ntwrk/compact-runtime` 0.16.0, `midnight-js` 4.1.1, `wallet-sdk` 1.2.0
- **Vitest** 4.1 for the contract test suite

## Prerequisites

- **Linux or macOS.** Midnight does not support Windows natively — see the
  Windows note below.
- Node.js v22+
- Docker (for the proof server)
- The Compact toolchain:
  ```bash
  curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
  ```
  Then `compact update`, and confirm both:
  ```bash
  compact --version && compact compile --version
  ```

### If you are on Windows — read this

Two traps cost real time here, so they're documented for the next person:

1. **Windows has its own `compact.exe`.** It's the built-in NTFS file-compression
   tool. Running `compact --version` in PowerShell or Git Bash silently runs
   *that*, prints something that isn't a version number, and looks like a broken
   install. Build inside WSL2, where the name doesn't collide.
2. **WSL inherits the Windows PATH.** A fresh Ubuntu shell can resolve `npm` to
   `/mnt/c/Program Files/nodejs/npm` while `node` isn't found at all. Install
   Node *inside* WSL (nvm) and verify with `which node npm` — both paths must be
   under your Linux home.

Also note that some tutorials reference an
`npm install -g @midnight-ntwrk/compact-compiler` package and a
`midnightnetwork/proof-server` Docker image. Neither exists — the npm package
404s, and the Docker org is `midnightntwrk`.

## Setup

```bash
git clone <your-repo-url> canary
cd canary
npm install
```

Start the proof server:

```bash
docker run -d --name midnight-proof-server -p 6300:6300 midnightntwrk/proof-server:latest midnight-proof-server -v
```

Compile the contract:

```bash
npm run compile
```

This writes circuits, proving/verifying keys and ZKIR to `managed/canary/`, then
prints what was built:

```
✓ Compiled contracts/canary.compact
  language 0.23.0  |  compiler 0.31.1  |  runtime 0.16.0

  CIRCUIT      KIND    PROOF     KEYS  ZKIR
  -----------  ------  --------  ----  ----
  deriveAdmin  pure    —
  nullifier    pure    —
  isAlert      pure    —
  checkIn      impure  ZK proof  ✓     ✓
  closeRound   impure  ZK proof  ✓     ✓

  5 circuits (2 generating ZK proofs)
```

Deploy to Preview (prints a wallet address, then waits for you to fund it at
https://midnight-tmnight-preview.nethermind.dev — it polls and continues by
itself once the tNIGHT lands):

```bash
npm run deploy -- --network preview
```

Switch the active network at any time:

```bash
npm run network preview
```

## Verify the Deployment

Reads the contract's public state straight back off the indexer. Needs no wallet
and no funds — public state is public:

```bash
npm run verify -- --network preview
```

```
  Contract:     713e14035854aee952c8f2c56f2b871f14f1ce8a8b59d2fa96e51f9d2204bbc8
  ✅ Contract found on-chain.

  ── Public ledger state ─────────────────────
  round             1
  responses         0
  alerts            0
  alertThreshold    score <= 2
  checkedIn         0 nullifier(s)
  admin             1b0b3de87b0445af770d7f10...
  ────────────────────────────────────────────
```

That output is the *entire* public footprint of the contract. No score and no
responder identity appears anywhere in it.

## Interact With It

```bash
npm run cli
```

Private check-in, a public-pulse view, and an admin close-round action. Your
responder identity is derived locally from a passphrase you type, so a single
operator can exercise a multi-person round.

## Run Tests

```bash
npm test
```

24 tests across five areas, run against the real compiled contract in-process —
no node, proof server or funded wallet needed:

1. **Circuit logic** — the nullifier is deterministic, round-scoped, unlinkable
   across rounds, and domain-separated from the admin commitment.
2. **State transitions** — check-ins increment `responses`; only scores at or
   below the threshold also increment `alerts`; out-of-range scores are rejected.
3. **Double check-in** — a second check-in in the same round is refused and the
   tally is left untouched.
4. **Round rollover and access control** — the admin can close a round (clearing
   counters and nullifiers); a non-admin cannot.
5. **Private inputs are never exposed** — scores 4 and 5 produce byte-identical
   public state; scores 1 and 4 differ in the `alerts` counter and *nothing else*;
   no raw secret key ever appears in public state.

## Project Structure

```
.
├── contracts/canary.compact     the Compact contract
├── managed/canary/              compiler output: circuits, keys, ZKIR
├── src/
│   ├── witnesses.ts             private state + witness implementations
│   ├── deploy.ts                deployment script
│   └── network.ts               network config, seeds, deployment records
├── tests/
│   ├── canary-simulator.ts      in-process test harness
│   └── canary.test.ts           the test suite
├── .github/workflows/           CI/CD (Level 3)
└── README.md
```

## Initial Idea

Most organisations run some version of an anonymous wellbeing survey, and almost
nobody believes the "anonymous" part. The tool can see your answer; whoever
administers it can too. So people answer strategically — a 3 instead of a 1 — and
the organisation gets back a number that looks reassuring at exactly the moment it
shouldn't. It's a trust problem, and no privacy policy fixes it, because the raw
answers genuinely are sitting on a server somewhere.

That's what made me want to build this on Midnight. Zero-knowledge proofs let you
flip the default: instead of collecting answers and promising not to look, you
never collect them at all. The responder proves a statement *about* their score —
that it's a valid value, that they haven't already answered this round, and
whether it crosses the alert threshold — and the score itself never leaves their
machine.

The constraint I set myself was to find the smallest thing the chain could learn
that would still be useful. A team lead doesn't need individual scores; they need
to know whether the number of people struggling is going up. That turns out to be
one bit per person. Canary is what falls out when you take that seriously: two
public counters, a set of one-way nullifiers so nobody can answer twice, and
nothing else. The hard part wasn't making it private — it was resisting the urge
to put anything more on-chain than that.

## Screenshots

_[PLACEHOLDER — compile output and contract address screenshots to be added]_

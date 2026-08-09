# Product Proposal

## What is the product, and who uses it?

Canary is an anonymous wellbeing pulse for teams. Each member privately submits
a score from 1 to 5. The organisation receives an honest aggregate — how many
people responded, and how many of them are struggling — and nobody, including
whoever deployed the contract, can learn any individual's score or link a
submission back to a person.

The users are two groups with opposed interests, which is the whole design
problem:

- **Responders** — employees, students, members of any group where saying "I am
  not coping" carries a cost. They are the ones who have to believe the
  anonymity claim, and they are the ones with the most reason not to.
- **The organisation** — a team lead, an HR function, a university welfare
  office. They need a trustworthy signal that something is going wrong, early
  enough to act, and they do not need individual answers to get it.

Every organisation that has run an anonymous wellbeing survey has the same
problem: nobody believes the anonymous part. The survey tool can see your
answer. Whoever administers it can see your answer. So people answer
strategically — a 3 instead of a 1 — and the organisation gets back a number
that looks reassuring at exactly the moment it should not. It is a trust
problem, and no privacy policy fixes it, because the raw answers genuinely are
sitting on a server somewhere.

Canary fixes it at the cryptographic level instead of the policy level. The
responder proves a statement *about* their score rather than submitting the
score, so there is no server holding the answers, and no administrator with a
database to be subpoenaed, breached, or simply curious about.

## Why Midnight specifically?

The product needs two properties at the same time, and a transparent chain can
only give one of them.

**It needs a public, tamper-evident aggregate.** The organisation's number has
to be one nobody can quietly edit — including the organisation itself. That is
what a chain is for. A count that management can adjust is worth no more than
the survey tool it replaces.

**It needs the inputs to that aggregate to stay private.** Not encrypted at
rest, not access-controlled, not held by a trusted party — absent. On a
transparent chain every input to a public computation is itself public, so the
only way to hide the scores is to compute the aggregate off-chain and post the
result, which puts the trusted party straight back in.

Midnight's zero-knowledge circuits let both hold at once. The responder proves,
on their own machine:

> "I hold a secret key, I have not already checked in this round, and my score
> is a valid value between 1 and 5."

...and reveals exactly two things: a round-scoped nullifier, and one bit saying
whether the score crossed the alert threshold. The score itself never enters
the transaction in any form — not encrypted, not committed, not at all.

Three things specifically would not work elsewhere:

1. **Sybil resistance without identity.** The nullifier is a one-way hash of a
   private secret and the round number. It proves "an eligible person who has
   not already answered is answering now" without saying who. A transparent
   chain enforcing one-vote-per-person has to know who the person is.
2. **Unlinkability across time.** Because the round number is mixed into the
   hash, the same person's nullifiers in different rounds cannot be connected.
   Nobody can follow an individual's trajectory — which is exactly the analysis
   an anxious responder fears most.
3. **A disclosure budget you can actually count.** Compact makes every crossing
   of the privacy boundary an explicit `disclose()`, so the budget is a thing
   you audit rather than trust. In `checkIn` — the circuit a responder runs —
   there are exactly two: the nullifier and the one bit. The other two in the
   contract are the admin commitment, the same domain-separated hash of the
   deployer's secret written at construction and re-derived to gate
   `closeRound()`. That is the complete list, in under 140 lines of Compact,
   and it is asserted in the test suite — two check-ins differing only in the
   private score must produce byte-identical public state.

## Data Model

| Data Point | Type | Disclosed To |
|---|---|---|
| `round` — which pulse round is open | Public ledger | Everyone |
| `responses` — how many people checked in | Public ledger | Everyone |
| `alerts` — how many were at or below the threshold | Public ledger | Everyone |
| `checkedIn` — set of one-way nullifiers | Public ledger | Everyone |
| `alertThreshold` — the cutoff, default 2 | Public ledger | Everyone |
| `admin` — hash of the deployer's secret | Public ledger | Everyone |
| `wellbeingScore()` — the actual 1–5 score | Private witness | No one |
| `localSecretKey()` — the responder's 32-byte identity secret | Private witness | No one |
| `nullifier(sk, round)` — derived from both private values | Deliberate disclosure | Everyone, but identifies nobody |
| `isAlert(score, threshold)` — one bit about the score | Deliberate disclosure | Everyone, as an increment only |

The last two rows are the entire privacy boundary of this product. Everything
above them is either public by design or never leaves the responder's device;
those two are the only values derived from private data that cross into public
state, and both are constructed to carry nothing else. The nullifier is a
one-way hash, so it identifies nobody. The bit is a single boolean, so a 1 and
a 2 are indistinguishable on-chain, as are a 3, a 4 and a 5.

The witnesses are also kept out of reach structurally, not only
cryptographically. In the browser the score lives in a React ref rather than
component state, and is cleared before proving begins — so it is absent from
the DOM, from devtools snapshots, and from the profiler. The identity secret is
generated locally with `crypto.getRandomValues`, stored encrypted in the
browser's private-state store, and only ever displayed as a six-character
fingerprint.

## Mainnet Feasibility

Realistic, with one substantial piece of work outstanding and one open question
that is not technical.

**What is already done.** The contract is small, complete and deployed — five
circuits, two of them generating proofs. It is live on Preview at
`713e14035854aee952c8f2c56f2b871f14f1ce8a8b59d2fa96e51f9d2204bbc8`, with a
real check-in recorded on-chain, a browser dApp doing local proof generation
through Lace, 60 passing tests, and CI that compiles the contract from source
on every push. Nothing about the core mechanism is speculative.

**The one real gap: eligibility.** Today anyone holding any secret key can check
in once. That is fine for a demonstration and wrong for an organisation, which
needs "one check-in per member of *this team*". The fix is a Merkle-tree
membership proof — the organisation publishes a root over its members'
commitments, and a responder proves membership without revealing which leaf they
are. This is a well-understood pattern and the natural next milestone. It is the
main thing standing between this and something a real team could adopt.

**Known limits that do not go away with more engineering.** These are inherent
and should be stated rather than designed around:

- **Aggregate leakage at small n.** With one responder, `alerts` trivially
  reveals that person's bracket. The guarantee is meaningful at team scale, not
  at n=1. A minimum-responses threshold before results are readable would help,
  and is worth adding.
- **Timing metadata.** The chain sees when each transaction arrives and which
  wallet paid the fee. An observer correlating submission times with other
  signals could narrow down who submitted, even though the contract itself
  reveals nothing. Mitigations exist — batching, relayers, delayed submission —
  but none is free.

**The non-technical blocker, which I think is the real one.** Fees are paid in
DUST, which is generated by delegated NIGHT and accrues over time. Building this
project I hit that myself: a wallet funded from the faucet held tNIGHT and zero
tDUST, and every check-in failed at submission for a reason nothing surfaced.
That is a bad first five minutes for a developer. It is a disqualifying first
five minutes for a stressed employee being asked to answer a wellbeing survey.
No organisation is going to ask its staff to install a wallet, acquire a token,
delegate it and wait for a fee resource to accrue before they can say they are
struggling.

So the honest answer is that the *contract* is Mainnet-feasible well before
Level 6, and the *product* is not, until someone else pays the fee. The
plausible path is organisation-sponsored submission — the organisation covers
fees so the responder needs no tokens and ideally no wallet — while the proof
still runs on the responder's device so the privacy guarantee is untouched.
Whether that can be built without reintroducing a trusted party is the question
I would want to answer next, and I would rather flag it now than discover it at
Level 6.

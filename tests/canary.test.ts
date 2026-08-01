import { describe, it, expect } from 'vitest';
import { CanarySimulator, key } from './canary-simulator.js';
import { pureCircuits } from '../managed/canary/contract/index.js';

const ADMIN = key(1);
const ALICE = key(2);
const BOB = key(3);

const ROUND_1 = Uint8Array.from({ length: 32 }, (_, i) => (i === 31 ? 1 : 0));
const ROUND_2 = Uint8Array.from({ length: 32 }, (_, i) => (i === 31 ? 2 : 0));

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('1. circuit logic — the nullifier is one-way and round-scoped', () => {
  it('is deterministic for the same key and round', () => {
    expect(hex(pureCircuits.nullifier(ALICE, ROUND_1))).toBe(
      hex(pureCircuits.nullifier(ALICE, ROUND_1)),
    );
  });

  it('is unlinkable across rounds for the same person', () => {
    expect(hex(pureCircuits.nullifier(ALICE, ROUND_1))).not.toBe(
      hex(pureCircuits.nullifier(ALICE, ROUND_2)),
    );
  });

  it('differs between people in the same round', () => {
    expect(hex(pureCircuits.nullifier(ALICE, ROUND_1))).not.toBe(
      hex(pureCircuits.nullifier(BOB, ROUND_1)),
    );
  });

  it('is domain-separated from the admin commitment', () => {
    // Same secret, different domain tag => different hash. Guards against a
    // nullifier ever doubling as proof of admin rights.
    expect(hex(pureCircuits.nullifier(ADMIN, ROUND_1))).not.toBe(
      hex(pureCircuits.deriveAdmin(ADMIN)),
    );
  });

  it('classifies scores against the threshold', () => {
    expect(pureCircuits.isAlert(1n, 2n)).toBe(true);
    expect(pureCircuits.isAlert(2n, 2n)).toBe(true);
    expect(pureCircuits.isAlert(3n, 2n)).toBe(false);
    expect(pureCircuits.isAlert(5n, 2n)).toBe(false);
  });
});

describe('2. state transitions — check-ins move public state correctly', () => {
  it('starts at round 1 with an empty tally', () => {
    const sim = new CanarySimulator(ADMIN, 4);
    const l = sim.getLedger();
    expect(l.round).toBe(1n);
    expect(l.responses).toBe(0n);
    expect(l.alerts).toBe(0n);
    expect(l.alertThreshold).toBe(2n);
    expect(l.checkedIn.isEmpty()).toBe(true);
  });

  it('commits the deployer as admin at construction', () => {
    const sim = new CanarySimulator(ADMIN, 4);
    expect(hex(sim.getLedger().admin)).toBe(hex(pureCircuits.deriveAdmin(ADMIN)));
  });

  it('counts a healthy check-in as a response but not an alert', () => {
    const sim = new CanarySimulator(ADMIN, 4);
    sim.switchUser(ALICE, 4);
    const l = sim.checkIn();
    expect(l.responses).toBe(1n);
    expect(l.alerts).toBe(0n);
    expect(l.checkedIn.size()).toBe(1n);
  });

  it('counts a struggling check-in as both a response and an alert', () => {
    const sim = new CanarySimulator(ADMIN, 4);
    sim.switchUser(ALICE, 1);
    const l = sim.checkIn();
    expect(l.responses).toBe(1n);
    expect(l.alerts).toBe(1n);
  });

  it('aggregates several responders', () => {
    const sim = new CanarySimulator(ADMIN, 4);
    sim.switchUser(ALICE, 2); // alert
    sim.checkIn();
    sim.switchUser(BOB, 5); // healthy
    sim.checkIn();
    sim.switchUser(key(4), 1); // alert
    const l = sim.checkIn();

    expect(l.responses).toBe(3n);
    expect(l.alerts).toBe(2n);
    expect(l.checkedIn.size()).toBe(3n);
  });

  it('rejects an out-of-range score', () => {
    const sim = new CanarySimulator(ADMIN, 4);
    sim.switchUser(ALICE, 9);
    expect(() => sim.checkIn()).toThrow();

    sim.switchUser(ALICE, 0);
    expect(() => sim.checkIn()).toThrow();
  });
});

describe('3. double check-in is blocked by the nullifier set', () => {
  it('refuses a second check-in from the same person in one round', () => {
    const sim = new CanarySimulator(ADMIN, 4);
    sim.switchUser(ALICE, 3);
    sim.checkIn();

    expect(() => sim.checkIn()).toThrow();
  });

  it('leaves the tally untouched after the rejected attempt', () => {
    const sim = new CanarySimulator(ADMIN, 4);
    sim.switchUser(ALICE, 3);
    sim.checkIn();
    try {
      sim.checkIn();
    } catch {
      /* expected */
    }

    const l = sim.getLedger();
    expect(l.responses).toBe(1n);
    expect(l.checkedIn.size()).toBe(1n);
  });

  it('still lets a different person check in', () => {
    const sim = new CanarySimulator(ADMIN, 4);
    sim.switchUser(ALICE, 3);
    sim.checkIn();
    sim.switchUser(BOB, 3);
    const l = sim.checkIn();

    expect(l.responses).toBe(2n);
    expect(l.checkedIn.size()).toBe(2n);
  });
});

describe('4. round rollover and admin access control', () => {
  it('lets the admin close a round, clearing the tally and nullifiers', () => {
    const sim = new CanarySimulator(ADMIN, 4);
    sim.switchUser(ALICE, 1);
    sim.checkIn();

    sim.switchUser(ADMIN, 4);
    const l = sim.closeRound();

    expect(l.round).toBe(2n);
    expect(l.responses).toBe(0n);
    expect(l.alerts).toBe(0n);
    expect(l.checkedIn.isEmpty()).toBe(true);
  });

  it('lets the same person check in again in the new round', () => {
    const sim = new CanarySimulator(ADMIN, 4);
    sim.switchUser(ALICE, 1);
    sim.checkIn();
    sim.switchUser(ADMIN, 4);
    sim.closeRound();

    sim.switchUser(ALICE, 1);
    const l = sim.checkIn();
    expect(l.responses).toBe(1n);
  });

  it("produces an unlinkable nullifier for that person's second round", () => {
    const sim = new CanarySimulator(ADMIN, 4);
    sim.switchUser(ALICE, 1);
    sim.checkIn();
    const round1Nullifier = sim.nullifiers()[0];

    sim.switchUser(ADMIN, 4);
    sim.closeRound();
    sim.switchUser(ALICE, 1);
    sim.checkIn();

    expect(sim.nullifiers()[0]).not.toBe(round1Nullifier);
  });

  it('refuses to close a round for a non-admin', () => {
    const sim = new CanarySimulator(ADMIN, 4);
    sim.switchUser(ALICE, 3);
    expect(() => sim.closeRound()).toThrow();
    expect(sim.getLedger().round).toBe(1n);
  });
});

describe('5. private inputs are never exposed', () => {
  it('keeps the score and secret key out of the public ledger shape', () => {
    const sim = new CanarySimulator(ADMIN, 4);
    sim.switchUser(ALICE, 1);
    sim.checkIn();

    const fields = Object.keys(sim.getLedger());
    expect(fields).not.toContain('score');
    expect(fields).not.toContain('wellbeingScore');
    expect(fields).not.toContain('secretKey');
    expect(fields.sort()).toEqual(
      ['admin', 'alertThreshold', 'alerts', 'checkedIn', 'responses', 'round'].sort(),
    );
  });

  it('never writes a raw secret key into public state', () => {
    const sim = new CanarySimulator(ADMIN, 4);
    sim.switchUser(ALICE, 1);
    sim.checkIn();

    const blob = sim.publicStateBlob();
    // 64 hex chars will not collide by chance — if a key ever leaked, this fires.
    expect(blob).not.toContain(hex(ALICE));
    expect(blob).not.toContain(hex(ADMIN));
  });

  it('makes two different private scores indistinguishable on-chain', () => {
    // Same responder, same round, two scores that both sit above the alert
    // threshold. If any part of the score leaked into public state, these two
    // blobs would differ.
    const a = new CanarySimulator(ADMIN, 4);
    a.switchUser(ALICE, 4);
    a.checkIn();

    const b = new CanarySimulator(ADMIN, 4);
    b.switchUser(ALICE, 5);
    b.checkIn();

    expect(a.publicStateBlob()).toBe(b.publicStateBlob());
  });

  it('makes two struggling scores indistinguishable from each other', () => {
    const a = new CanarySimulator(ADMIN, 4);
    a.switchUser(ALICE, 1);
    a.checkIn();

    const b = new CanarySimulator(ADMIN, 4);
    b.switchUser(ALICE, 2);
    b.checkIn();

    expect(a.publicStateBlob()).toBe(b.publicStateBlob());
  });

  it('discloses exactly one bit: alert or not, and nothing more', () => {
    // Score 1 (alert) vs score 4 (healthy) for the same responder. The public
    // state must differ in the `alerts` counter and in absolutely nothing else.
    const alerting = new CanarySimulator(ADMIN, 4);
    alerting.switchUser(ALICE, 1);
    alerting.checkIn();

    const healthy = new CanarySimulator(ADMIN, 4);
    healthy.switchUser(ALICE, 4);
    healthy.checkIn();

    const a = JSON.parse(alerting.publicStateBlob());
    const h = JSON.parse(healthy.publicStateBlob());

    expect(a.alerts).toBe('1');
    expect(h.alerts).toBe('0');

    // Everything else — including the nullifier — is identical.
    delete a.alerts;
    delete h.alerts;
    expect(a).toEqual(h);
  });

  it('keeps the private state local and unmodified by the circuit', () => {
    const sim = new CanarySimulator(ADMIN, 4);
    sim.switchUser(ALICE, 3);
    sim.checkIn();

    const ps = sim.getPrivateState();
    expect(ps.score).toBe(3);
    expect(hex(ps.secretKey)).toBe(hex(ALICE));
  });
});

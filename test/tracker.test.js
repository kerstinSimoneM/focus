const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BACKOFF_DURATION_MS,
  DEFAULT_THRESHOLD_MS,
  EMPOWERMENT_MESSAGES,
  WorkSessionTracker
} = require("../src/tracker.js");

function harness() {
  let now = 0;
  return {
    advance: (ms) => { now += ms; },
    tracker: new WorkSessionTracker({ clock: () => now, random: () => 0 })
  };
}

test("starts with a 15-minute threshold and records canvas activity", () => {
  const { tracker } = harness();
  const session = tracker.startSession("u1");
  assert.equal(session.originalThresholdMs, DEFAULT_THRESHOLD_MS);
  const updated = tracker.recordActivity(session.id);
  assert.equal(updated.lastActivityAt, 0);
});

test("checks in at the threshold and avoids duplicate pending check-ins", () => {
  const { tracker, advance } = harness();
  const session = tracker.startSession("u1");
  advance(DEFAULT_THRESHOLD_MS);
  const first = tracker.checkInactivity(session.id);
  const second = tracker.checkInactivity(session.id);
  assert.equal(first.id, second.id);
  assert.equal(first.companion.id, session.companion.id);
});

test("doubles after the first dismissal and suppresses checks after the second", () => {
  const { tracker, advance } = harness();
  const session = tracker.startSession("u1");
  advance(DEFAULT_THRESHOLD_MS);
  const first = tracker.checkInactivity(session.id);
  const afterFirst = tracker.respondToCheckIn(first.id, "false-alarm");
  assert.equal(afterFirst.effectiveThresholdMs, DEFAULT_THRESHOLD_MS * 2);
  advance(DEFAULT_THRESHOLD_MS * 2);
  const second = tracker.checkInactivity(session.id);
  tracker.respondToCheckIn(second.id, "false-alarm");
  advance(BACKOFF_DURATION_MS - 1);
  assert.equal(tracker.checkInactivity(session.id), null);
  advance(1);
  assert.ok(tracker.checkInactivity(session.id));
});

test("restores the original threshold after exactly one hour", () => {
  const { tracker, advance } = harness();
  const session = tracker.startSession("u1");
  advance(DEFAULT_THRESHOLD_MS);
  tracker.respondToCheckIn(tracker.checkInactivity(session.id).id, "false-alarm");
  advance(DEFAULT_THRESHOLD_MS * 2);
  tracker.respondToCheckIn(tracker.checkInactivity(session.id).id, "false-alarm");
  advance(BACKOFF_DURATION_MS - 1);
  assert.equal(tracker.checkInactivity(session.id), null);
  advance(1);
  tracker.checkInactivity(session.id);
  assert.equal(tracker.viewSession(tracker.sessions.get(session.id)).effectiveThresholdMs, DEFAULT_THRESHOLD_MS);
  assert.equal(tracker.viewSession(tracker.sessions.get(session.id)).falseAlarmCount, 0);
});

test("creates a new check-in when the one-hour backoff expires", () => {
  const { tracker, advance } = harness();
  const session = tracker.startSession("u1");

  advance(DEFAULT_THRESHOLD_MS);
  tracker.respondToCheckIn(tracker.checkInactivity(session.id).id, "false-alarm");
  advance(DEFAULT_THRESHOLD_MS * 2);
  tracker.respondToCheckIn(tracker.checkInactivity(session.id).id, "false-alarm");

  advance(BACKOFF_DURATION_MS);
  const resumedCheckIn = tracker.checkInactivity(session.id);

  assert.ok(resumedCheckIn, "a new check-in should be created when the one-hour backoff expires");
  assert.equal(resumedCheckIn.response, "pending");
});

test("direct stuck ends suppression and produces unique messages with the same companion", () => {
  const { tracker, advance } = harness();
  const session = tracker.startSession("u1");
  advance(DEFAULT_THRESHOLD_MS);
  tracker.respondToCheckIn(tracker.checkInactivity(session.id).id, "false-alarm");
  advance(DEFAULT_THRESHOLD_MS * 2);
  tracker.respondToCheckIn(tracker.checkInactivity(session.id).id, "false-alarm");
  const first = tracker.signalStuck(session.id);
  const second = tracker.signalStuck(session.id);
  assert.notEqual(first.messageId, second.messageId);
  assert.equal(first.companion.id, second.companion.id);
  assert.equal(tracker.sessions.get(session.id).falseAlarmCount, 0);
});

test("creates another check-in after the original threshold has elapsed again after a stuck response", () => {
  const { tracker, advance } = harness();
  const session = tracker.startSession("u1");

  advance(DEFAULT_THRESHOLD_MS);
  const firstCheckIn = tracker.checkInactivity(session.id);
  tracker.respondToCheckIn(firstCheckIn.id, "stuck");

  advance(DEFAULT_THRESHOLD_MS);
  const nextCheckIn = tracker.checkInactivity(session.id);
  assert.ok(nextCheckIn, "another check-in should be created after the original threshold has elapsed again");
});

test("resets the threshold after a stuck response and keeps a fresh check-in cycle based on the original threshold", () => {
  const { tracker, advance } = harness();
  const session = tracker.startSession("u1");

  advance(DEFAULT_THRESHOLD_MS);
  const firstCheckIn = tracker.checkInactivity(session.id);
  tracker.respondToCheckIn(firstCheckIn.id, "false-alarm");
  assert.equal(tracker.viewSession(tracker.sessions.get(session.id)).effectiveThresholdMs, DEFAULT_THRESHOLD_MS * 2);

  advance(DEFAULT_THRESHOLD_MS * 2);
  const secondCheckIn = tracker.checkInactivity(session.id);
  assert.ok(secondCheckIn);
  tracker.respondToCheckIn(secondCheckIn.id, "stuck");

  assert.equal(tracker.viewSession(tracker.sessions.get(session.id)).effectiveThresholdMs, DEFAULT_THRESHOLD_MS);
  assert.equal(tracker.viewSession(tracker.sessions.get(session.id)).falseAlarmCount, 0);
  assert.equal(tracker.viewSession(tracker.sessions.get(session.id)).lastActivityAt, DEFAULT_THRESHOLD_MS * 3, "lastActivityAt should reset at the stuck response time");

  advance(DEFAULT_THRESHOLD_MS / 2);
  const afterStuck = tracker.checkInactivity(session.id);
  assert.equal(afterStuck, null, "after a stuck response the next check-in should not trigger early");

  advance(DEFAULT_THRESHOLD_MS / 2);
  const nextCheckIn = tracker.checkInactivity(session.id);
  assert.ok(nextCheckIn, "the next check-in should come only after the original threshold has elapsed again");
});

test("resets the inactivity clock when the user answers a check-in, not just the threshold value", () => {
  const { tracker, advance } = harness();
  const session = tracker.startSession("u1");

  advance(DEFAULT_THRESHOLD_MS);
  const pending = tracker.checkInactivity(session.id);
  tracker.respondToCheckIn(pending.id, "active");

  assert.equal(tracker.viewSession(tracker.sessions.get(session.id)).lastActivityAt, DEFAULT_THRESHOLD_MS, "activity should be refreshed when the user responds active");

  advance(DEFAULT_THRESHOLD_MS / 2);
  assert.equal(tracker.checkInactivity(session.id), null, "half the threshold should not trigger after a fresh active response");

  advance(DEFAULT_THRESHOLD_MS / 2);
  assert.ok(tracker.checkInactivity(session.id), "the original threshold should be respected after a fresh active response");
});

test("doubles the threshold on the first false alarm and keeps that value until suppression ends", () => {
  const { tracker, advance } = harness();
  const session = tracker.startSession("u1");

  advance(DEFAULT_THRESHOLD_MS);
  const firstCheckIn = tracker.checkInactivity(session.id);
  const afterFalseAlarm = tracker.respondToCheckIn(firstCheckIn.id, "false-alarm");

  assert.equal(afterFalseAlarm.effectiveThresholdMs, DEFAULT_THRESHOLD_MS * 2);
  assert.equal(tracker.viewSession(tracker.sessions.get(session.id)).effectiveThresholdMs, DEFAULT_THRESHOLD_MS * 2);

  advance((DEFAULT_THRESHOLD_MS * 2) - 1);
  assert.equal(tracker.checkInactivity(session.id), null);

  advance(1);
  assert.ok(tracker.checkInactivity(session.id));
});

test("refreshes the large message pool after exhaustion", () => {
  const { tracker } = harness();
  const session = tracker.startSession("u1");
  const seen = new Set();
  for (let i = 0; i < EMPOWERMENT_MESSAGES.length; i += 1) {
    seen.add(tracker.signalStuck(session.id).messageId);
  }
  assert.equal(seen.size, EMPOWERMENT_MESSAGES.length);
  const reused = tracker.signalStuck(session.id);
  assert.ok(seen.has(reused.messageId));
});

test("stops sessions and rejects later activity", () => {
  const { tracker } = harness();
  const session = tracker.startSession("u1");
  tracker.stopSession(session.id);
  assert.throws(() => tracker.recordActivity(session.id), /not active/);
});

test("uses an assigned preview companion when starting a session", () => {
  const { tracker } = harness();
  const preview = { id: "robin", name: "Rowan the robin", image: "assets/robin.png" };
  const session = tracker.startSession("u1", preview);
  assert.equal(session.companion.id, "robin");
});

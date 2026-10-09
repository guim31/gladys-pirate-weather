import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_INTERVAL_MINUTES,
  PLAN_REASONS,
  RESERVE_CALLS,
  automaticInterval,
  monthlyCalls,
  planNextRefresh,
} from '../src/budget.js';

const DAY = 86400 * 1000;

test('the documented budget table', () => {
  // README.md and docs: locations → interval → calls in a 31-day month.
  const free = [
    [1, 15, 2976],
    [2, 20, 4464],
    [3, 30, 4464],
    [4, 45, 3968],
  ];
  for (const [locations, interval, calls] of free) {
    assert.equal(automaticInterval(locations, 10000), interval, `${locations} on free`);
    assert.equal(monthlyCalls(locations, interval), calls);
    assert.ok(calls <= 5000, 'under half of the free quota');
  }
  const supporter = [
    [1, 15, 2976],
    [2, 15, 5952],
    [3, 15, 8928],
    [4, 20, 8928],
  ];
  for (const [locations, interval, calls] of supporter) {
    assert.equal(automaticInterval(locations, 20000), interval, `${locations} on supporter`);
    assert.equal(monthlyCalls(locations, interval), calls);
  }
});

test('never faster than every 15 minutes, whatever the quota', () => {
  assert.equal(automaticInterval(1, 1000000), MIN_INTERVAL_MINUTES);
  assert.equal(planNextRefresh({ locations: 1, manualMinutes: 5 }).intervalMinutes, 15);
});

test('an unknown limit is the free one', () => {
  assert.equal(automaticInterval(2), 20);
  assert.equal(automaticInterval(2, 0), 20);
  assert.equal(planNextRefresh({ locations: 2 }).intervalMinutes, 20);
});

test('a manual interval is kept while the quota allows it', () => {
  const plan = planNextRefresh({
    locations: 1,
    manualMinutes: 60,
    usage: { limit: 10000, remaining: 9000, resetAt: 20 * DAY },
    now: 0,
  });
  assert.deepEqual(plan, { delayMs: 60 * 60000, intervalMinutes: 60, reason: PLAN_REASONS.MANUAL });
});

test('the cadence stretches when the calls left cannot carry it to the reset', () => {
  // 300 calls left for 20 days and 2 houses: 140 cycles → one every ~3.4 h.
  const plan = planNextRefresh({
    locations: 2,
    usage: { limit: 10000, remaining: 300, resetAt: 20 * DAY },
    now: 0,
  });
  assert.equal(plan.reason, PLAN_REASONS.STRETCHED);
  assert.equal(plan.intervalMinutes, 240);
  const cycles = (20 * DAY) / plan.delayMs;
  assert.ok(cycles * 2 <= 300 - RESERVE_CALLS, 'the calls left are enough until the reset');
});

test('a manual interval is stretched too: the quota wins', () => {
  const plan = planNextRefresh({
    locations: 1,
    manualMinutes: 15,
    usage: { limit: 10000, remaining: 120, resetAt: 10 * DAY },
    now: 0,
  });
  assert.equal(plan.reason, PLAN_REASONS.STRETCHED);
  assert.ok(plan.intervalMinutes >= 144);
});

test('below the reserve, refreshes pause until the reset', () => {
  const plan = planNextRefresh({
    locations: 1,
    usage: { limit: 10000, remaining: RESERVE_CALLS, resetAt: 3 * DAY },
    now: 0,
  });
  assert.equal(plan.reason, PLAN_REASONS.PAUSED);
  assert.equal(plan.delayMs, 3 * DAY + 60000);
  // No reset time known: look again in 6 hours.
  const unknown = planNextRefresh({ locations: 1, usage: { remaining: 0 }, now: 0 });
  assert.equal(unknown.reason, PLAN_REASONS.PAUSED);
  assert.equal(unknown.delayMs, 6 * 3600 * 1000);
});

test('plenty of calls left: the automatic cadence is untouched', () => {
  const plan = planNextRefresh({
    locations: 1,
    usage: { limit: 10000, remaining: 9000, resetAt: 30 * DAY },
    now: 0,
  });
  assert.deepEqual(plan, { delayMs: 15 * 60000, intervalMinutes: 15, reason: PLAN_REASONS.AUTO });
});

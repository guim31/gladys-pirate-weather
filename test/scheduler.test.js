import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createForecastStore } from '../src/forecast-store.js';
import { createHouseRegistry } from '../src/houses.js';
import { RETRY_AFTER_FAILURE_MS, createScheduler } from '../src/scheduler.js';
import { HOUSES, fakeFetch, fixtureForUrl, quotaHeaders } from './helpers/fixtures.js';

const silent = { info() {}, warn() {}, debug() {}, error() {} };

/**
 * @param {object} options - Options.
 * @returns {object} The scheduler and its fakes.
 */
function setup({ houses, route, manual = null }) {
  const clock = { now: 0 };
  const timers = [];
  const fetchImpl = fakeFetch(route);
  const store = createForecastStore({
    getApiKey: () => 'key',
    fetchImpl,
    now: () => clock.now,
    logger: silent,
  });
  const registry = createHouseRegistry({ fetchHouses: async () => houses, logger: silent });
  const refreshed = [];
  const cycles = [];
  const scheduler = createScheduler({
    houses: registry,
    store,
    getManualMinutes: () => (typeof manual === 'function' ? manual() : manual),
    onRefreshed: (house) => refreshed.push(house.name),
    onCycle: (summary) => cycles.push(summary),
    logger: silent,
    now: () => clock.now,
    setTimer: (fn, delay) => {
      const timer = { fn, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      timer.cleared = true;
    },
  });
  const armed = () => timers.filter((timer) => !timer.cleared && !timer.fired);
  const fire = (timer) => {
    timer.fired = true;
    return timer.fn();
  };
  return { scheduler, store, fetchImpl, refreshed, cycles, timers, armed, fire, clock };
}

const ok = (url) => ({ body: fixtureForUrl(url), headers: quotaHeaders({ remaining: 9000 }) });

test('a cycle refreshes every located house once, then arms the next one on the budget', async () => {
  const { scheduler, fetchImpl, refreshed, cycles, armed } = setup({
    houses: [HOUSES.okc, HOUSES.paris, { id: 'x', name: 'Nowhere', latitude: null }],
    route: ok,
  });
  await scheduler.start();
  assert.equal(fetchImpl.calls.length, 2);
  assert.deepEqual(refreshed.sort(), ['Home', 'Maison']);
  assert.equal(cycles[0].houses, 2);
  assert.equal(cycles[0].refreshed, 2);
  assert.equal(cycles[0].error, null);
  // Two locations on the free plan: every 20 minutes.
  assert.equal(armed().length, 1);
  assert.equal(armed()[0].delay, 20 * 60000);
});

test('two houses at the same place cost one call', async () => {
  const twin = { ...HOUSES.okc, id: 'twin', name: 'Garage', latitude: 35.46762 };
  const { scheduler, fetchImpl, refreshed, armed } = setup({
    houses: [HOUSES.okc, twin],
    route: ok,
  });
  await scheduler.start();
  assert.equal(fetchImpl.calls.length, 1);
  assert.deepEqual(refreshed.sort(), ['Garage', 'Home']);
  assert.equal(armed()[0].delay, 15 * 60000, 'one location: every 15 minutes');
});

test('an invalid key stops the cycle and arms no timer', async () => {
  const { scheduler, fetchImpl, cycles, armed } = setup({
    houses: [HOUSES.okc, HOUSES.paris],
    route: () => ({ status: 401 }),
  });
  await scheduler.start();
  assert.equal(fetchImpl.calls.length, 1, 'the second house is not tried');
  assert.equal(cycles[0].error.kind, 'auth');
  assert.equal(armed().length, 0);
});

test('a passing failure retries in 5 minutes, not a full interval', async () => {
  const { scheduler, cycles, armed } = setup({
    houses: [HOUSES.paris],
    route: () => ({ status: 502 }),
    manual: 120,
  });
  await scheduler.start();
  assert.equal(cycles[0].refreshed, 0);
  assert.equal(armed()[0].delay, RETRY_AFTER_FAILURE_MS);
});

test('the timer runs the next cycle; stop disarms it', async () => {
  const { scheduler, fetchImpl, armed, fire } = setup({ houses: [HOUSES.paris], route: ok });
  await scheduler.start();
  await fire(armed()[0]);
  assert.equal(armed().length, 1, 'the next one is armed');
  assert.equal(fetchImpl.calls.length, 2);
  scheduler.stop();
  assert.equal(armed().length, 0);
});

test('a cycle asked for during another runs after it, never alongside', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { scheduler, fetchImpl } = setup({
    houses: [HOUSES.paris],
    route: async (url) => {
      await gate;
      return ok(url);
    },
  });
  const first = scheduler.start();
  scheduler.requestCycle();
  scheduler.requestCycle();
  release();
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  await scheduler.requestCycle();
  // The first cycle, ONE queued cycle, then the last request.
  assert.equal(fetchImpl.calls.length, 3);
});

test('reschedule applies a new interval from the last cycle, without a call', async () => {
  const settings = { manual: null };
  const { scheduler, fetchImpl, armed, clock } = setup({
    houses: [HOUSES.paris],
    route: ok,
    manual: () => settings.manual,
  });
  await scheduler.start();
  assert.equal(armed()[0].delay, 15 * 60000);
  clock.now += 10 * 60000;
  settings.manual = 60;
  scheduler.reschedule();
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(armed().length, 1);
  assert.equal(armed()[0].delay, 50 * 60000, 'every hour, 10 minutes already elapsed');
  assert.equal(scheduler.lastPlan.reason, 'manual');
});

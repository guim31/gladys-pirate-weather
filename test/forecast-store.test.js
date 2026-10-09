import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS } from '../src/api.js';
import { STALE_MAX_MS, createForecastStore, locationKey } from '../src/forecast-store.js';
import { fakeFetch, loadFixture, quotaHeaders } from './helpers/fixtures.js';

const silent = { info() {}, warn() {}, debug() {}, error() {} };
const PARIS = [48.8566, 2.3522];

/**
 * @param {Function} route - The fake fetch router.
 * @param {object} [options] - Store options.
 * @returns {object} `{ store, fetchImpl, clock }`.
 */
function setup(route, { apiKey = 'key' } = {}) {
  const clock = { now: 1_000_000 };
  const fetchImpl = fakeFetch(route);
  const config = { apiKey };
  const store = createForecastStore({
    getApiKey: () => config.apiKey,
    fetchImpl,
    now: () => clock.now,
    logger: silent,
  });
  return { store, fetchImpl, clock, config };
}

const ok = () => ({
  body: loadFixture('synthetic-paris-wmo-alerts.json'),
  headers: quotaHeaders({ remaining: 9000, reset: 3600 }),
});

test('locations closer than ~110 m share a key', () => {
  assert.equal(locationKey(48.85661, 2.35222), locationKey(48.8568, 2.3524));
  assert.notEqual(locationKey(48.8566, 2.3522), locationKey(48.8606, 2.3522));
});

test('a recent forecast is served from memory, without a call', async () => {
  const { store, fetchImpl, clock } = setup(ok);
  await store.load(...PARIS, { maxAgeMs: 60000 });
  clock.now += 30000;
  const { forecast, stale } = await store.load(...PARIS, { maxAgeMs: 60000 });
  assert.equal(forecast.timezone, 'Europe/Paris');
  assert.equal(stale, false);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(store.usage.remaining, 9000);
  clock.now += 60000;
  await store.load(...PARIS, { maxAgeMs: 60000 });
  assert.equal(fetchImpl.calls.length, 2, 'older than maxAge: a new call');
});

test('concurrent requests for one location share one call', async () => {
  const { store, fetchImpl } = setup(ok);
  await Promise.all([
    store.load(...PARIS, { maxAgeMs: 0 }),
    store.load(...PARIS, { maxAgeMs: 0 }),
    store.refresh(...PARIS),
  ]);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(store.calls, 1);
});

test('when the API fails, a forecast up to 3 hours old is still served', async () => {
  let fail = false;
  const { store, clock } = setup(() => (fail ? { status: 503 } : ok()));
  await store.refresh(...PARIS);
  fail = true;
  clock.now += 2 * 3600 * 1000;
  const served = await store.load(...PARIS, { maxAgeMs: 60000 });
  assert.equal(served.stale, true);
  clock.now += STALE_MAX_MS;
  await assert.rejects(store.load(...PARIS, { maxAgeMs: 60000 }), {
    kind: ERROR_KINDS.UPSTREAM,
  });
});

test('a 429 blocks every call until the reset the headers announce', async () => {
  let quota = true;
  const { store, fetchImpl, clock } = setup(() =>
    quota ? { status: 429, headers: quotaHeaders({ remaining: 0, reset: 7200 }) } : ok(),
  );
  await assert.rejects(store.refresh(...PARIS), { kind: ERROR_KINDS.QUOTA });
  quota = false;
  await assert.rejects(store.refresh(...PARIS), { kind: ERROR_KINDS.QUOTA });
  assert.equal(fetchImpl.calls.length, 1, 'blocked: no call');
  assert.equal(store.blockedError().kind, ERROR_KINDS.QUOTA);
  clock.now += 7200 * 1000 + 1;
  await store.refresh(...PARIS);
  assert.equal(fetchImpl.calls.length, 2);
});

test('a refused key blocks the calls until it changes — the test button may retry it', async () => {
  let refused = true;
  const { store, fetchImpl, config } = setup(() => (refused ? { status: 401 } : ok()));
  await assert.rejects(store.refresh(...PARIS), { kind: ERROR_KINDS.AUTH });
  await assert.rejects(store.refresh(...PARIS), { kind: ERROR_KINDS.AUTH });
  assert.equal(fetchImpl.calls.length, 1);
  refused = false;
  await store.refresh(...PARIS, { retryRefusedKey: true });
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(store.lastError, null);
  // No key at all: never a call, even from the button.
  config.apiKey = '';
  await assert.rejects(store.refresh(...PARIS, { retryRefusedKey: true }), {
    kind: ERROR_KINDS.AUTH,
  });
  assert.equal(fetchImpl.calls.length, 2);
});

test('an answer that is not a forecast is an "invalid" error and stays out of the cache', async () => {
  const { store } = setup(() => ({ body: { error: 'nope' } }));
  await assert.rejects(store.refresh(...PARIS), { kind: ERROR_KINDS.INVALID });
  assert.equal(store.size, 0);
});

test('prune drops old locations nobody refreshes, reset forgets everything', async () => {
  const { store, clock } = setup(ok);
  await store.refresh(...PARIS);
  store.prune(new Set());
  assert.equal(store.size, 1, 'still servable: kept');
  clock.now += STALE_MAX_MS + 1;
  store.prune(new Set([locationKey(...PARIS)]));
  assert.equal(store.size, 1, 'refreshed location: kept');
  store.prune(new Set());
  assert.equal(store.size, 0);
  await store.refresh(...PARIS);
  store.reset();
  assert.equal(store.size, 0);
  assert.equal(store.usage, null);
});

test('while refreshes are paused, readers get the cache but never a call', async () => {
  const { store, fetchImpl, clock } = setup(ok);
  await store.refresh(...PARIS);
  clock.now += 3600 * 1000;
  const served = await store.load(...PARIS, { maxAgeMs: 60000, allowCall: false });
  assert.equal(served.stale, true);
  assert.equal(fetchImpl.calls.length, 1);
  clock.now += STALE_MAX_MS;
  await assert.rejects(store.load(...PARIS, { maxAgeMs: 60000, allowCall: false }), {
    kind: ERROR_KINDS.QUOTA,
  });
  assert.equal(fetchImpl.calls.length, 1);
});

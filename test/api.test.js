import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, buildUrl, fetchForecast, readUsage } from '../src/api.js';
import { fakeFetch, loadFixture, quotaHeaders } from './helpers/fixtures.js';

const KEY = 'secret-key-123';

test('the request asks for SI units, version 2 fields and the expanded icon set', () => {
  const url = new URL(buildUrl(KEY, 35.46761, -97.51642));
  assert.equal(url.origin, 'https://api.pirateweather.net');
  assert.equal(url.pathname, `/forecast/${KEY}/35.4676,-97.5164`);
  assert.equal(url.searchParams.get('units'), 'si');
  assert.equal(url.searchParams.get('version'), '2');
  assert.equal(url.searchParams.get('icon'), 'pirate');
  // Nothing is excluded: one call serves every need.
  assert.equal(url.searchParams.get('exclude'), null);
});

test('fetchForecast returns the body and the quota of the headers', async () => {
  const fetchImpl = fakeFetch(() => ({
    body: loadFixture('synthetic-paris-wmo-alerts.json'),
    headers: quotaHeaders({ limit: 10000, remaining: 9412, reset: 3600 }),
  }));
  const { data, usage } = await fetchForecast({
    apiKey: KEY,
    latitude: 48.8566,
    longitude: 2.3522,
    fetchImpl,
    now: () => 1000,
  });
  assert.equal(data.timezone, 'Europe/Paris');
  assert.deepEqual(usage, {
    limit: 10000,
    remaining: 9412,
    resetAt: 1000 + 3600 * 1000,
    calls: 588,
    readAt: 1000,
  });
  assert.equal(fetchImpl.calls.length, 1);
});

test('readUsage tolerates missing headers', () => {
  assert.equal(readUsage(new Headers(), 0), null);
  assert.deepEqual(readUsage(new Headers({ 'ratelimit-remaining': '12' }), 0), {
    limit: null,
    remaining: 12,
    resetAt: null,
    calls: null,
    readAt: 0,
  });
});

for (const [status, kind] of [
  [401, ERROR_KINDS.AUTH],
  [403, ERROR_KINDS.AUTH],
  [429, ERROR_KINDS.QUOTA],
  [400, ERROR_KINDS.REQUEST],
  [404, ERROR_KINDS.REQUEST],
  [500, ERROR_KINDS.UPSTREAM],
  [502, ERROR_KINDS.UPSTREAM],
]) {
  test(`HTTP ${status} is a "${kind}" error that never shows the key`, async () => {
    const fetchImpl = fakeFetch(() => ({
      status,
      body: { detail: `echo of ${KEY}` },
      headers: quotaHeaders({ remaining: 0 }),
    }));
    await assert.rejects(
      fetchForecast({ apiKey: KEY, latitude: 1, longitude: 2, fetchImpl }),
      (err) => {
        assert.equal(err.kind, kind);
        assert.equal(err.status, status);
        assert.equal(err.usage.remaining, 0);
        assert.ok(!err.message.includes(KEY), 'the key must never reach a message');
        return true;
      },
    );
  });
}

test('a network failure is a "network" error without the URL', async () => {
  const fetchImpl = async (url) => {
    throw new TypeError(`fetch failed for ${url}`, { cause: { code: 'ECONNRESET' } });
  };
  await assert.rejects(
    fetchForecast({ apiKey: KEY, latitude: 1, longitude: 2, fetchImpl }),
    (err) => {
      assert.equal(err.kind, ERROR_KINDS.NETWORK);
      assert.match(err.message, /ECONNRESET/);
      assert.ok(!err.message.includes(KEY));
      return true;
    },
  );
});

test('an unreadable 200 body is an "invalid" error', async () => {
  const fetchImpl = fakeFetch(() => ({ body: '<html>gateway</html>' }));
  await assert.rejects(fetchForecast({ apiKey: KEY, latitude: 1, longitude: 2, fetchImpl }), {
    kind: ERROR_KINDS.INVALID,
  });
});

test('no key or no coordinates: no call at all', async () => {
  const fetchImpl = fakeFetch(() => ({ body: {} }));
  await assert.rejects(fetchForecast({ apiKey: '  ', latitude: 1, longitude: 2, fetchImpl }), {
    kind: ERROR_KINDS.AUTH,
  });
  await assert.rejects(fetchForecast({ apiKey: KEY, latitude: NaN, longitude: 2, fetchImpl }), {
    kind: ERROR_KINDS.REQUEST,
  });
  assert.equal(fetchImpl.calls.length, 0);
});

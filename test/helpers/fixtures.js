// -----------------------------------------------------------------------------
// Fixture loading and a fake fetch answering like the Pirate Weather API.
// See test/fixtures/README.md for where each fixture comes from.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

// The instants the synthetic fixtures were generated for.
const OKC_NOW = 1781550000 * 1000; // 2026-06-15T19:00:00Z, 2 PM in Oklahoma City
const PARIS_NOW = OKC_NOW; // 9 PM in Paris
const TROMSO_NOW = 1797332400 * 1000; // 2026-12-15T11:00:00Z, polar night
const SF_NOW = 1759697220 * 1000; // the real San Francisco response
const ONTARIO_NOW = 1762718100 * 1000; // the real Ontario response

const HOUSES = Object.freeze({
  okc: { id: 'h-okc', name: 'Home', selector: 'home', latitude: 35.4676, longitude: -97.5164 },
  paris: {
    id: 'h-paris',
    name: 'Maison',
    selector: 'maison',
    latitude: 48.8566,
    longitude: 2.3522,
  },
  tromso: {
    id: 'h-tromso',
    name: 'Hytte',
    selector: 'hytte',
    latitude: 69.6492,
    longitude: 18.9553,
  },
});

/**
 * @description Load a fixture (a fresh copy on every call).
 * @param {string} name - The file name in test/fixtures.
 * @returns {object} The parsed JSON.
 * @example
 * loadFixture('synthetic-paris-wmo-alerts.json');
 */
function loadFixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}

/**
 * @description A fake fetch. `route(url)` returns `{ status, body, headers }`
 * (or throws to simulate a network error); every call is recorded.
 * @param {Function} route - The router.
 * @returns {Function} The fetch, with `.calls` (the requested URLs).
 * @example
 * const fetchImpl = fakeFetch(() => ({ body: loadFixture('...') }));
 */
function fakeFetch(route) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const { status = 200, body = {}, headers = {} } = await route(String(url));
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/**
 * @description Quota headers as Pirate Weather sends them.
 * @param {object} usage - `{ limit, remaining, reset }` (reset in seconds).
 * @returns {object} The headers.
 * @example
 * quotaHeaders({ limit: 10000, remaining: 9000, reset: 86400 });
 */
function quotaHeaders({ limit = 10000, remaining = 9000, reset = 15 * 86400 } = {}) {
  return {
    'ratelimit-limit': String(limit),
    'ratelimit-remaining': String(remaining),
    'ratelimit-reset': String(reset),
    'x-forecast-api-calls': String(limit - remaining),
  };
}

/**
 * @description The fixture of a request URL, by its coordinates.
 * @param {string} url - The request URL.
 * @returns {object} The fixture body.
 * @example
 * fixtureForUrl('https://api.pirateweather.net/forecast/k/35.4676,-97.5164?units=si');
 */
function fixtureForUrl(url) {
  if (url.includes('/35.4676,-97.5164')) {
    return loadFixture('synthetic-oklahoma-city-nws-alerts.json');
  }
  if (url.includes('/48.8566,2.3522')) {
    return loadFixture('synthetic-paris-wmo-alerts.json');
  }
  if (url.includes('/69.6492,18.9553')) {
    return loadFixture('synthetic-tromso-no-minutely.json');
  }
  throw new Error(`No fixture for ${url}`);
}

export {
  HOUSES,
  OKC_NOW,
  ONTARIO_NOW,
  PARIS_NOW,
  SF_NOW,
  TROMSO_NOW,
  fakeFetch,
  fixtureForUrl,
  loadFixture,
  quotaHeaders,
};

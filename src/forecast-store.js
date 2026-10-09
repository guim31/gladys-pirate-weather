// -----------------------------------------------------------------------------
// The forecast store: the last Pirate Weather forecast of each location, the
// only thing that ever calls the API.
//
// Every reader goes through it — the core's weather requests (dashboard,
// chat, the 30-minute alert check), the scene action, the widget — and is
// served from memory: the scheduler (scheduler.js) refreshes the houses on
// the quota cadence, so a weather request costs no call at all. A call is
// only made for a location nobody refreshed recently (a house added since the
// last cycle), and concurrent requests for one location share one call.
//
// When Pirate Weather fails, a forecast up to 3 hours old is still served
// rather than nothing: an hour-old forecast beats the core falling back to
// another provider, or an empty dashboard. Older than that, the request fails
// and the core moves on to the next provider.
//
// The quota headers of every answer (success or failure) are kept: they drive
// the cadence and the status shown to the user. A 429 blocks every call until
// the monthly reset, an invalid key until the key changes — retrying either
// would only spend calls, or be refused again.
// -----------------------------------------------------------------------------

import { ERROR_KINDS, PirateWeatherError, fetchForecast } from './api.js';
import { parseForecast } from './forecast.js';

// Two requests closer than this (~110 m) are the same location.
const COORDINATE_DECIMALS = 3;

// Beyond this, a cached forecast is no longer served when a refresh fails.
const STALE_MAX_MS = 3 * 60 * 60 * 1000;

// After a 429 without a reset time, try again after this long.
const QUOTA_RETRY_MS = 60 * 60 * 1000;

/**
 * @description The cache key of a location.
 * @param {number} latitude - The latitude.
 * @param {number} longitude - The longitude.
 * @returns {string} The key.
 * @example
 * locationKey(40.71278, -74.00594); // -> '40.713,-74.006'
 */
function locationKey(latitude, longitude) {
  return `${latitude.toFixed(COORDINATE_DECIMALS)},${longitude.toFixed(COORDINATE_DECIMALS)}`;
}

/**
 * @description Create the forecast store.
 * @param {object} options - Options.
 * @param {Function} options.getApiKey - `() => string`, the configured key.
 * @param {Function} [options.fetchImpl] - fetch, injectable for the tests.
 * @param {Function} [options.now] - `() => ms`, injectable for the tests.
 * @param {object} [options.logger] - Logger with info/warn/debug.
 * @returns {object} The store.
 * @example
 * const store = createForecastStore({ getApiKey: () => config.api_key });
 */
function createForecastStore({
  getApiKey,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  logger = console,
}) {
  // key -> { forecast, fetchedAt }
  const entries = new Map();
  // key -> Promise of the call under way
  const inflight = new Map();
  let usage = null;
  // { kind, message, at } of the last failed call, null after a success.
  let lastError = null;
  let blockedUntil = 0;
  let calls = 0;

  /**
   * @description Why calls are refused right now, if they are.
   * @returns {PirateWeatherError|null} The error to throw, or null.
   * @example
   * blockedError();
   */
  function blockedError() {
    if (getApiKey().trim() === '') {
      return new PirateWeatherError(ERROR_KINDS.AUTH, 'No Pirate Weather API key configured');
    }
    if (lastError?.kind === ERROR_KINDS.AUTH) {
      return new PirateWeatherError(ERROR_KINDS.AUTH, lastError.message);
    }
    if (blockedUntil > now()) {
      return new PirateWeatherError(
        ERROR_KINDS.QUOTA,
        'The monthly Pirate Weather quota is spent until its reset',
      );
    }
    return null;
  }

  /**
   * @description Record the quota of an answer.
   * @param {object|null} read - The usage read from the headers.
   * @example
   * keepUsage(result.usage);
   */
  function keepUsage(read) {
    if (read !== null && read !== undefined) {
      usage = read;
    }
  }

  /**
   * @description Call the API for a location, sharing a call under way.
   * @param {number} latitude - The latitude.
   * @param {number} longitude - The longitude.
   * @param {object} [options] - Options.
   * @param {boolean} [options.retryRefusedKey] - Call even though the key was
   * refused: the user's "test" button (a new subscription takes up to 20
   * minutes to reach the API, the same key may work now).
   * @returns {Promise<object>} The new entry `{ forecast, fetchedAt }`.
   * @throws {PirateWeatherError} When the call fails or is blocked.
   * @example
   * await store.refresh(40.71, -74.0);
   */
  function refresh(latitude, longitude, { retryRefusedKey = false } = {}) {
    const key = locationKey(latitude, longitude);
    const pending = inflight.get(key);
    if (pending !== undefined) {
      return pending;
    }
    const blocked =
      retryRefusedKey && lastError?.kind === ERROR_KINDS.AUTH && getApiKey().trim() !== ''
        ? null
        : blockedError();
    if (blocked !== null) {
      return Promise.reject(blocked);
    }
    const call = (async () => {
      calls += 1;
      try {
        const { data, usage: read } = await fetchForecast({
          apiKey: getApiKey(),
          latitude,
          longitude,
          fetchImpl,
          now,
        });
        keepUsage(read);
        const fetchedAt = now();
        let forecast;
        try {
          forecast = parseForecast(data, { fetchedAt });
        } catch (err) {
          throw new PirateWeatherError(ERROR_KINDS.INVALID, err.message);
        }
        const entry = { forecast, fetchedAt };
        entries.set(key, entry);
        lastError = null;
        return entry;
      } catch (err) {
        keepUsage(err.usage ?? null);
        const kind = err.kind ?? ERROR_KINDS.NETWORK;
        lastError = { kind, message: err.message, at: now() };
        if (kind === ERROR_KINDS.QUOTA) {
          const resetAt = err.usage?.resetAt ?? null;
          blockedUntil = resetAt !== null && resetAt > now() ? resetAt : now() + QUOTA_RETRY_MS;
        }
        throw err;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, call);
    return call;
  }

  /**
   * @description The cached entry of a location, whatever its age.
   * @param {number} latitude - The latitude.
   * @param {number} longitude - The longitude.
   * @returns {object|null} `{ forecast, fetchedAt }`, or null.
   * @example
   * store.peek(40.71, -74.0);
   */
  function peek(latitude, longitude) {
    return entries.get(locationKey(latitude, longitude)) ?? null;
  }

  /**
   * @description The forecast of a location for a reader: the cached one when
   * younger than `maxAgeMs`, else a fresh call — falling back to a cached one
   * up to 3 hours old when the call fails.
   * @param {number} latitude - The latitude.
   * @param {number} longitude - The longitude.
   * @param {object} options - Options.
   * @param {number} options.maxAgeMs - The age under which the cache is used.
   * @param {boolean} [options.allowCall] - false while the refreshes are
   * paused for the quota: the calls left are kept for the test button.
   * @returns {Promise<object>} `{ forecast, fetchedAt, stale }`.
   * @throws {PirateWeatherError} When there is nothing to serve.
   * @example
   * const { forecast } = await store.load(40.71, -74.0, { maxAgeMs: 30 * 60000 });
   */
  async function load(latitude, longitude, { maxAgeMs, allowCall = true }) {
    const cached = peek(latitude, longitude);
    if (cached !== null && now() - cached.fetchedAt <= maxAgeMs) {
      return { ...cached, stale: false };
    }
    try {
      if (!allowCall) {
        throw new PirateWeatherError(
          ERROR_KINDS.QUOTA,
          'Refreshes paused: the monthly quota is almost spent',
        );
      }
      return { ...(await refresh(latitude, longitude)), stale: false };
    } catch (err) {
      if (cached !== null && now() - cached.fetchedAt <= STALE_MAX_MS) {
        logger.warn(`Serving a forecast cached ${ageMinutes(cached)} min ago: ${err.message}`);
        return { ...cached, stale: true };
      }
      throw err;
    }
  }

  /**
   * @description The age of an entry, in whole minutes.
   * @param {object} entry - A cache entry.
   * @returns {number} Minutes.
   * @example
   * ageMinutes(entry);
   */
  function ageMinutes(entry) {
    return Math.round((now() - entry.fetchedAt) / 60000);
  }

  /**
   * @description Drop the entries of locations no longer refreshed, once they
   * are too old to be served: memory stays bounded by the houses.
   * @param {Set<string>} keep - The keys of the refreshed locations.
   * @example
   * store.prune(new Set(['40.713,-74.006']));
   */
  function prune(keep) {
    for (const [key, entry] of entries) {
      if (!keep.has(key) && now() - entry.fetchedAt > STALE_MAX_MS) {
        entries.delete(key);
      }
    }
  }

  /**
   * @description Forget everything tied to the key: a new key starts clean.
   * @example
   * store.reset();
   */
  function reset() {
    entries.clear();
    usage = null;
    lastError = null;
    blockedUntil = 0;
  }

  return {
    refresh,
    peek,
    load,
    prune,
    reset,
    blockedError,
    get usage() {
      return usage;
    },
    get lastError() {
      return lastError;
    },
    get calls() {
      return calls;
    },
    get size() {
      return entries.size;
    },
  };
}

export { COORDINATE_DECIMALS, QUOTA_RETRY_MS, STALE_MAX_MS, createForecastStore, locationKey };

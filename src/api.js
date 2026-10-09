// -----------------------------------------------------------------------------
// Pirate Weather API client: ONE call returns everything the integration uses
// (current conditions, the next 60 minutes, 48 hours, 8 days and the official
// alerts), so a refresh cycle costs exactly one call per location.
//
//   GET https://api.pirateweather.net/forecast/<key>/<lat>,<lon>
//       ?units=si&version=2&icon=pirate
//
//   - units=si      one unit system for everything we cache; the conversion
//                   to the unit system of each Gladys request happens locally
//                   (units.js), so a °F user and a °C user share one call;
//   - version=2     the fields that were not in Dark Sky (precipType `ice`,
//                   per-type intensities, `nearestCity`...);
//   - icon=pirate   the expanded icon set (drizzle, heavy rain, haze...), a
//                   finer mapping to the Gladys conditions (conditions.js).
//
// Every response carries the quota of the key in its headers
// (`Ratelimit-Limit`, `Ratelimit-Remaining`, `Ratelimit-Reset` in seconds,
// `X-Forecast-API-Calls`): they are returned next to the data and drive the
// cadence (budget.js).
//
// The API key travels in the URL path (the documented form). It is a secret:
// the URL is never logged, and no error message built here contains it.
// -----------------------------------------------------------------------------

const API_BASE_URL = 'https://api.pirateweather.net/forecast';

// Under the 15 s the core waits for a weather answer, with room to build it.
const REQUEST_TIMEOUT_MS = 10000;

// What went wrong, as the rest of the integration needs to react to it.
const ERROR_KINDS = Object.freeze({
  AUTH: 'auth', // 401/403: missing, wrong or unsubscribed key — stop polling
  QUOTA: 'quota', // 429: the monthly quota is spent — wait for the reset
  REQUEST: 'request', // 400/404: bad coordinates — skip this location
  UPSTREAM: 'upstream', // 5xx: retry on the next cycle
  NETWORK: 'network', // DNS, timeout, reset: retry on the next cycle
  INVALID: 'invalid', // 200 with an unusable body
});

class PirateWeatherError extends Error {
  /**
   * @param {string} kind - One of ERROR_KINDS.
   * @param {string} message - A message safe to log (never the key or URL).
   * @param {object} [details] - { status, usage }.
   */
  constructor(kind, message, { status = null, usage = null } = {}) {
    super(message);
    this.name = 'PirateWeatherError';
    this.kind = kind;
    this.status = status;
    this.usage = usage;
  }
}

/**
 * @description Read an integer header, tolerating its absence.
 * @param {Headers} headers - The response headers.
 * @param {string} name - The header name.
 * @returns {number|null} The value, or null when absent or not a number.
 * @example
 * readIntHeader(response.headers, 'ratelimit-remaining');
 */
function readIntHeader(headers, name) {
  const raw = headers?.get?.(name);
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * @description Read the quota headers of a response.
 * @param {Headers} headers - The response headers.
 * @param {number} now - The current time in ms.
 * @returns {object|null} `{ limit, remaining, resetAt, calls, readAt }`, or
 * null when the response carries none of them.
 * @example
 * readUsage(response.headers, Date.now());
 */
function readUsage(headers, now) {
  const limit = readIntHeader(headers, 'ratelimit-limit');
  const remaining = readIntHeader(headers, 'ratelimit-remaining');
  const reset = readIntHeader(headers, 'ratelimit-reset');
  const calls = readIntHeader(headers, 'x-forecast-api-calls');
  if (limit === null && remaining === null && reset === null && calls === null) {
    return null;
  }
  return {
    limit,
    remaining,
    resetAt: reset === null ? null : now + reset * 1000,
    calls,
    readAt: now,
  };
}

/**
 * @description Build the request URL. Coordinates are rounded to 4 decimals:
 * the API resolves to its ~13 km model grid, more digits add nothing.
 * @param {string} apiKey - The API key.
 * @param {number} latitude - The latitude.
 * @param {number} longitude - The longitude.
 * @returns {string} The URL (contains the key: never log it).
 * @example
 * buildUrl('key', 40.7128, -74.006);
 */
function buildUrl(apiKey, latitude, longitude) {
  const location = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  return `${API_BASE_URL}/${encodeURIComponent(apiKey)}/${location}?units=si&version=2&icon=pirate`;
}

/**
 * @description Classify a non-200 status.
 * @param {number} status - The HTTP status.
 * @returns {string} One of ERROR_KINDS.
 * @example
 * kindOfStatus(429); // -> 'quota'
 */
function kindOfStatus(status) {
  if (status === 401 || status === 403) {
    return ERROR_KINDS.AUTH;
  }
  if (status === 429) {
    return ERROR_KINDS.QUOTA;
  }
  if (status >= 400 && status < 500) {
    return ERROR_KINDS.REQUEST;
  }
  return ERROR_KINDS.UPSTREAM;
}

/**
 * @description Fetch the forecast of a location.
 * @param {object} options - Options.
 * @param {string} options.apiKey - The Pirate Weather API key.
 * @param {number} options.latitude - The latitude.
 * @param {number} options.longitude - The longitude.
 * @param {Function} [options.fetchImpl] - fetch, injectable for the tests.
 * @param {Function} [options.now] - `() => ms`, injectable for the tests.
 * @param {number} [options.timeoutMs] - The request timeout.
 * @returns {Promise<{data: object, usage: object|null}>} The raw JSON body and
 * the quota read from the headers.
 * @throws {PirateWeatherError} On any failure, classified by `kind`.
 * @example
 * const { data, usage } = await fetchForecast({ apiKey, latitude: 40.71, longitude: -74.0 });
 */
async function fetchForecast({
  apiKey,
  latitude,
  longitude,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new PirateWeatherError(ERROR_KINDS.AUTH, 'No Pirate Weather API key configured');
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new PirateWeatherError(ERROR_KINDS.REQUEST, 'Invalid coordinates');
  }

  let response;
  try {
    response = await fetchImpl(buildUrl(apiKey.trim(), latitude, longitude), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // The error of fetch never carries the URL, but its cause might: keep the
    // name only.
    const reason = err?.name === 'TimeoutError' ? 'timeout' : err?.cause?.code || err?.name;
    throw new PirateWeatherError(ERROR_KINDS.NETWORK, `Pirate Weather unreachable (${reason})`);
  }

  const usage = readUsage(response.headers, now());
  if (response.status !== 200) {
    const kind = kindOfStatus(response.status);
    // Drain the body so the connection is released; its text is not logged.
    await response.text().catch(() => '');
    throw new PirateWeatherError(kind, `Pirate Weather answered HTTP ${response.status}`, {
      status: response.status,
      usage,
    });
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new PirateWeatherError(ERROR_KINDS.INVALID, 'Pirate Weather sent an unreadable body', {
      status: 200,
      usage,
    });
  }
  return { data, usage };
}

export {
  API_BASE_URL,
  ERROR_KINDS,
  PirateWeatherError,
  REQUEST_TIMEOUT_MS,
  buildUrl,
  fetchForecast,
  readUsage,
};

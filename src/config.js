// -----------------------------------------------------------------------------
// Configuration of the integration.
//
// DEFAULT_CONFIG mirrors the `default` values of the manifest `config_schema`
// (test/manifest.test.js keeps both sides in sync). The supervisor sends the
// values as the form stored them: normalizeConfig() trims, validates and falls
// back to the defaults, so the rest of the code never sees a malformed value.
// -----------------------------------------------------------------------------

// Refresh interval choices of the manifest `refresh_interval` select, in
// minutes. 'auto' sizes the cadence on the quota (see budget.js).
const REFRESH_INTERVAL_CHOICES = ['auto', '15', '30', '60', '120'];

// Language of the texts the integration writes itself (scene variables, the
// widget when the core sends no language). 'auto' follows the language of
// the last weather request of the core.
const LANGUAGE_CHOICES = ['auto', 'en', 'fr'];

const DEFAULT_CONFIG = Object.freeze({
  api_key: '',
  refresh_interval: 'auto',
  language: 'auto',
});

/**
 * @description Normalize the raw configuration sent by Gladys.
 * @param {object} [raw] - The configuration values, as stored by the form.
 * @returns {{api_key: string, refresh_interval: string, language: string}} The
 * normalized configuration.
 * @example
 * normalizeConfig({ api_key: ' abc ', refresh_interval: '30' });
 */
function normalizeConfig(raw = {}) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  const apiKey = typeof source.api_key === 'string' ? source.api_key.trim() : '';
  const interval = String(source.refresh_interval ?? DEFAULT_CONFIG.refresh_interval);
  const language = String(source.language ?? DEFAULT_CONFIG.language);
  return {
    api_key: apiKey,
    refresh_interval: REFRESH_INTERVAL_CHOICES.includes(interval)
      ? interval
      : DEFAULT_CONFIG.refresh_interval,
    language: LANGUAGE_CHOICES.includes(language) ? language : DEFAULT_CONFIG.language,
  };
}

/**
 * @description The manual refresh interval chosen by the user, in minutes.
 * @param {object} config - The normalized configuration.
 * @returns {number|null} The interval, or null for the automatic cadence.
 * @example
 * manualIntervalMinutes({ refresh_interval: '30' }); // -> 30
 */
function manualIntervalMinutes(config) {
  return config.refresh_interval === 'auto' ? null : Number(config.refresh_interval);
}

export {
  DEFAULT_CONFIG,
  LANGUAGE_CHOICES,
  REFRESH_INTERVAL_CHOICES,
  manualIntervalMinutes,
  normalizeConfig,
};

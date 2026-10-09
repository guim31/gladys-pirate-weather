// -----------------------------------------------------------------------------
// The integration, wired to a Gladys client.
//
// Pirate Weather is a WEATHER integration (manifest `type: "weather"`,
// contract B.18): no devices, no discovery — a provider API. Gladys asks for
// the weather of a house, the integration answers in the pivot format, and the
// core feeds its weather widget, the chat assistant and its generic
// weather-alert scene trigger with it.
//
//   onWeatherGet          the pivot payload, from the forecast in memory;
//   requestWeatherRefresh the nudge, when the alerts of a house change: the
//                         core re-pulls at once and its weather-alert scenes
//                         fire within seconds, not within its 30-minute check;
//   onSceneAction         "precipitation of the next hour" (scene-actions.js);
//   publishSceneEvent     "precipitation expected within the hour"
//                         (scene-triggers.js);
//   onWidgetGet           the next-hour precipitation chart (widget.js);
//   onAction              "Test the API key", with the quota left.
//
// One timer refreshes every located house on the quota cadence (scheduler.js,
// budget.js); everything else reads the forecast store (forecast-store.js).
// The SDK client is injected, so the tests drive this module with a fake one.
// -----------------------------------------------------------------------------

import { alertsFingerprint, buildAlerts } from './alerts.js';
import { ERROR_KINDS } from './api.js';
import { PLAN_REASONS } from './budget.js';
import { manualIntervalMinutes, normalizeConfig } from './config.js';
import { createForecastStore, locationKey } from './forecast-store.js';
import { createHouseRegistry } from './houses.js';
import { buildWeather } from './pivot.js';
import { SCENE_ACTIONS, precipitationNextHour } from './scene-actions.js';
import { createPrecipitationWatcher } from './scene-triggers.js';
import { createScheduler } from './scheduler.js';
import { formatCount, resolveLanguage } from './texts.js';
import { fromSI } from './units.js';
import { WIDGETS, buildUnavailableContent, buildWidgetContent } from './widget.js';

// A forecast younger than the refresh interval plus this margin is served as
// is; older, a reader triggers a call (the timer may be late, a house new).
const FRESHNESS_GRACE_MS = 5 * 60 * 1000;
const MIN_FRESHNESS_MS = 20 * 60 * 1000;
const MAX_FRESHNESS_MS = 3 * 60 * 60 * 1000;

/**
 * @description The connection status matching the last refresh cycle.
 * @param {object} options - Options.
 * @param {object} options.config - The normalized configuration.
 * @param {object|null} options.summary - The last cycle summary.
 * @param {object|null} options.usage - The last quota read.
 * @returns {{connected: boolean, message?: object}} The status.
 * @example
 * connectionStatus({ config, summary, usage });
 */
function connectionStatus({ config, summary, usage }) {
  if (config.api_key === '') {
    return {
      connected: false,
      message: {
        en: 'Enter your free Pirate Weather API key in the configuration.',
        fr: 'Saisissez votre clé d’API Pirate Weather gratuite dans la configuration.',
      },
    };
  }
  const error = summary?.error ?? null;
  if (error?.kind === ERROR_KINDS.AUTH) {
    return {
      connected: false,
      message: {
        en: 'Pirate Weather refused the API key. Check it, and that the forecast API is subscribed (allow 20 minutes after signing up).',
        fr: 'Pirate Weather refuse la clé d’API. Vérifiez-la, et que l’API forecast est souscrite (comptez 20 minutes après l’inscription).',
      },
    };
  }
  if (error?.kind === ERROR_KINDS.QUOTA || summary?.plan?.reason === PLAN_REASONS.PAUSED) {
    const reset = usage?.resetAt ? new Date(usage.resetAt).toISOString().slice(0, 10) : null;
    return {
      connected: false,
      message: {
        en: `Monthly Pirate Weather quota spent: refreshes resume after its reset${reset ? ` (${reset})` : ''}.`,
        fr: `Quota mensuel Pirate Weather épuisé : les mises à jour reprennent après sa remise à zéro${reset ? ` (${reset})` : ''}.`,
      },
    };
  }
  if (summary !== null && summary.houses === 0) {
    return {
      connected: false,
      message: {
        en: 'No house of Gladys has a location: set it in Settings → Houses.',
        fr: 'Aucune maison de Gladys n’a de position : renseignez-la dans Paramètres → Maisons.',
      },
    };
  }
  if (error !== null && summary.refreshed === 0) {
    return {
      connected: false,
      message: {
        en: 'Pirate Weather is unreachable for now: retrying in a few minutes.',
        fr: 'Pirate Weather est injoignable pour le moment : nouvel essai dans quelques minutes.',
      },
    };
  }
  return { connected: true };
}

/**
 * @description Create the integration on a Gladys client.
 * @param {object} gladys - The SDK client (GladysIntegration, or a fake).
 * @param {object} [options] - Options, for the tests.
 * @param {Function} [options.fetchImpl] - fetch.
 * @param {Function} [options.now] - `() => ms`.
 * @param {object} [options.logger] - Logger with info/warn/debug/error.
 * @param {Function} [options.setTimer] - setTimeout.
 * @param {Function} [options.clearTimer] - clearTimeout.
 * @returns {object} The running parts ({ store, scheduler, houses, watcher, config }).
 * @example
 * createApp(new GladysIntegration());
 */
function createApp(
  gladys,
  { fetchImpl = globalThis.fetch, now = Date.now, logger = console, setTimer, clearTimer } = {},
) {
  let config = normalizeConfig(gladys.config ?? {});
  // Language of the last request of the core, for the texts of the scenes.
  let lastLanguage = null;
  let lastSummary = null;
  let lastStatus = null;

  const language = () => resolveLanguage(config.language, lastLanguage);

  const houses = createHouseRegistry({ fetchHouses: () => gladys.getHouses(), logger });
  const store = createForecastStore({ getApiKey: () => config.api_key, fetchImpl, now, logger });
  const watcher = createPrecipitationWatcher({
    publish: (key, data) => gladys.publishSceneEvent(key, data),
    getLanguage: language,
    logger,
    now,
  });

  // Alerts fingerprint per location, to nudge the core when they change.
  const alertFingerprints = new Map();
  let alertsChanged = false;

  /**
   * @description Publish the connection status, only when it changed.
   * @returns {Promise<void>} Resolves once published (or refused).
   * @example
   * await publishStatus();
   */
  async function publishStatus() {
    const status = connectionStatus({ config, summary: lastSummary, usage: store.usage });
    const serialized = JSON.stringify(status);
    if (serialized === lastStatus) {
      return;
    }
    try {
      await gladys.setConnectionStatus(status.connected, status.message);
      lastStatus = serialized;
    } catch (err) {
      logger.warn(`Unable to publish the connection status: ${err.message}`);
    }
  }

  const scheduler = createScheduler({
    houses,
    store,
    getManualMinutes: () => manualIntervalMinutes(config),
    logger,
    now,
    ...(setTimer ? { setTimer } : {}),
    ...(clearTimer ? { clearTimer } : {}),
    onRefreshed: async (house, entry) => {
      await watcher.observe(house, entry.forecast);
      const key = locationKey(house.latitude, house.longitude);
      const fingerprint = alertsFingerprint(
        buildAlerts(entry.forecast.alerts, Math.floor(now() / 1000)),
      );
      const previous = alertFingerprints.get(key);
      alertFingerprints.set(key, fingerprint);
      // The first forecast after a start is a baseline, like the core's.
      if (previous !== undefined && previous !== fingerprint) {
        alertsChanged = true;
      }
    },
    onCycle: async (summary) => {
      lastSummary = summary;
      watcher.forget(new Set(houses.list().map((house) => house.id)));
      const { plan } = summary;
      logger.info(
        `Refreshed ${summary.refreshed} location(s) of ${summary.houses} house(s); next refresh in ${Math.round(plan.delayMs / 60000)} min (${plan.reason})`,
      );
      if (alertsChanged) {
        alertsChanged = false;
        logger.info('Weather alerts changed: asking Gladys to re-read the weather');
        gladys.requestWeatherRefresh();
      }
      if (summary.refreshed > 0) {
        try {
          await gladys.requestWidgetRefresh(WIDGETS.PRECIPITATION_NEXT_HOUR);
        } catch (err) {
          logger.debug(`Widget refresh not requested: ${err.message}`);
        }
      }
      await publishStatus();
    },
  });

  /**
   * @description How a reader may use the store: how old a forecast may be
   * and still be served, and whether a call may be made for it.
   * @returns {{maxAgeMs: number, allowCall: boolean}} The load options.
   * @example
   * store.load(latitude, longitude, loadOptions());
   */
  function loadOptions() {
    const plan = scheduler.lastPlan;
    const intervalMs = (plan?.intervalMinutes ?? 15) * 60 * 1000;
    return {
      maxAgeMs: Math.min(
        MAX_FRESHNESS_MS,
        Math.max(MIN_FRESHNESS_MS, intervalMs + FRESHNESS_GRACE_MS),
      ),
      allowCall: plan?.reason !== PLAN_REASONS.PAUSED,
    };
  }

  /**
   * @description Forget everything tied to the API key.
   * @example
   * forgetKey();
   */
  function forgetKey() {
    store.reset();
    watcher.reset();
    alertFingerprints.clear();
    lastSummary = null;
  }

  /**
   * @description The house a scene action or a widget targets, reading the
   * houses once more when none is known yet.
   * @param {any} name - The "House" field.
   * @returns {Promise<object>} The house.
   * @example
   * await resolveHouse('');
   */
  async function resolveHouse(name) {
    if (houses.list().length === 0) {
      await houses.refresh();
    }
    return houses.resolve(name);
  }

  // --- Weather request: the dashboard, the chat, the alert scenes -------------
  gladys.onWeatherGet(async ({ latitude, longitude, language: requested, units }) => {
    if (typeof requested === 'string' && requested !== '') {
      lastLanguage = requested;
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error('The house has no location');
    }
    const { forecast } = await store.load(latitude, longitude, loadOptions());
    return buildWeather(forecast, { units: units === 'us' ? 'us' : 'metric', now: now() });
  });

  // --- Scene action: precipitation of the next hour -------------------------
  gladys.onSceneAction(SCENE_ACTIONS.GET_PRECIPITATION_NEXT_HOUR, async (fields = {}) => {
    const house = await resolveHouse(fields.house);
    const { forecast } = await store.load(house.latitude, house.longitude, loadOptions());
    return precipitationNextHour(forecast, language(), now());
  });

  // --- Dashboard widget: the next-hour chart ---------------------------------
  gladys.onWidgetGet(
    WIDGETS.PRECIPITATION_NEXT_HOUR,
    async ({ settings = {}, language: requested, units } = {}) => {
      const lang = resolveLanguage(
        'auto',
        typeof requested === 'string' && requested !== '' ? requested : language(),
      );
      try {
        const house = await resolveHouse(settings?.house);
        const entry = await store.load(house.latitude, house.longitude, loadOptions());
        return buildWidgetContent({
          house,
          entry,
          units: units === 'us' ? 'us' : 'metric',
          language: lang,
          now: now(),
        });
      } catch (err) {
        logger.warn(`Widget content unavailable: ${err.message}`);
        return buildUnavailableContent(
          lang === 'fr'
            ? `Prévision indisponible : ${err.message}`
            : `Forecast unavailable: ${err.message}`,
        );
      }
    },
  );

  // --- Configuration action: test the API key --------------------------------
  gladys.onAction('test_connection', async () => {
    if (config.api_key === '') {
      throw new Error('Enter your Pirate Weather API key first, then save.');
    }
    const house = await resolveHouse('');
    const entry = await store.refresh(house.latitude, house.longitude, { retryRefusedKey: true });
    // The key works: if it was refused before, the refreshes start again.
    if (lastSummary?.error?.kind === ERROR_KINDS.AUTH) {
      scheduler.requestCycle();
    }
    const metric = fromSI('metric').temperature(entry.forecast.currently.temperature);
    const us = fromSI('us').temperature(entry.forecast.currently.temperature);
    const place = entry.forecast.nearestCity
      ? `${house.name} (${entry.forecast.nearestCity})`
      : house.name;
    const usage = store.usage;
    const quota = (lang) =>
      usage?.remaining !== null && usage?.remaining !== undefined && usage?.limit
        ? lang === 'fr'
          ? ` Appels restants ce mois-ci : ${formatCount(usage.remaining, 'fr')} sur ${formatCount(usage.limit, 'fr')}.`
          : ` Calls left this month: ${formatCount(usage.remaining, 'en')} of ${formatCount(usage.limit, 'en')}.`
        : '';
    const interval = scheduler.lastPlan?.intervalMinutes;
    const cadence = (lang) =>
      interval
        ? lang === 'fr'
          ? ` Mise à jour toutes les ${interval} min.`
          : ` Refreshing every ${interval} min.`
        : '';
    return {
      en: `It works: ${us} °F (${metric} °C) now at ${place}.${quota('en')}${cadence('en')}`,
      fr: `Ça fonctionne : ${metric} °C en ce moment à ${place}.${quota('fr')}${cadence('fr')}`,
    };
  });

  // --- Configuration ---------------------------------------------------------
  gladys.onConfigUpdated(async (raw) => {
    const previousKey = config.api_key;
    config = normalizeConfig(raw);
    if (config.api_key !== previousKey) {
      // A new key: new quota, new account — start clean and refresh now.
      forgetKey();
      logger.info('API key changed: refreshing now');
      if (scheduler.started) {
        await scheduler.requestCycle();
      }
      await publishStatus();
      return;
    }
    scheduler.reschedule();
  });

  // --- Connection lifecycle --------------------------------------------------
  gladys.on('connected', async () => {
    try {
      const previousKey = config.api_key;
      config = normalizeConfig(await gladys.getConfig());
      // Gladys may have restarted: publish the status again.
      lastStatus = null;
      if (scheduler.started && config.api_key !== previousKey) {
        // The key changed while we were disconnected.
        forgetKey();
        await scheduler.requestCycle();
      } else if (!scheduler.started) {
        // The first cycle runs in the background: the connection must not
        // wait for Pirate Weather.
        scheduler.start();
      } else {
        await houses.refresh();
        await publishStatus();
      }
    } catch (err) {
      logger.error(`Post-connection initialization failed: ${err.message}`);
    }
  });

  return {
    store,
    scheduler,
    houses,
    watcher,
    get config() {
      return config;
    },
  };
}

export { connectionStatus, createApp };

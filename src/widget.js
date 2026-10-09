// -----------------------------------------------------------------------------
// Dashboard widget "Precipitation, next hour": the minute-by-minute chart
// Dark Sky made famous, which the core weather widget does not draw (the
// pivot format stops at the hour).
//
//   - a sentence ("Light rain expected in 12 minutes (80% chance).");
//   - a bar chart of the intensity of the next 60 minutes, in mm/h or in/h
//     after the unit system of the user;
//   - a status line: the house and the time of the forecast.
//
// The content is pulled by the core and cached per settings, language and
// units; the integration nudges it after each refresh (requestWidgetRefresh),
// so the chart follows the forecast without a short TTL.
// -----------------------------------------------------------------------------

import { WIDGET_CHART_TYPES, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { readNowcast } from './nowcast.js';
import { nowcastSentence } from './texts.js';
import { fromSI, intensityUnit } from './units.js';

const WIDGETS = Object.freeze({ PRECIPITATION_NEXT_HOUR: 'precipitation_next_hour' });

// The core re-pulls on expiry; the nudge after each refresh comes first.
const TTL_SECONDS = 600;

/**
 * @description Format a time in the time zone of the forecast.
 * @param {number} ms - The time, in ms.
 * @param {string|null} timeZone - The IANA time zone of the location.
 * @param {string} language - 'en' or 'fr'.
 * @returns {string} "2:05 PM" or "14:05".
 * @example
 * formatTime(Date.now(), 'America/Chicago', 'en');
 */
function formatTime(ms, timeZone, language) {
  const options = { hour: 'numeric', minute: '2-digit' };
  try {
    return new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-US', {
      ...options,
      timeZone: timeZone ?? undefined,
    }).format(ms);
  } catch {
    // An unknown time zone name: the container's (Gladys injects TZ).
    return new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-US', options).format(ms);
  }
}

/**
 * @description Build the widget content.
 * @param {object} options - Options.
 * @param {object} options.house - The house shown.
 * @param {object} options.entry - Its store entry `{ forecast, fetchedAt }`.
 * @param {string} options.units - 'metric' or 'us'.
 * @param {string} options.language - 'en' or 'fr'.
 * @param {number} [options.now] - The current time in ms.
 * @returns {object} The widget content.
 * @example
 * buildWidgetContent({ house, entry, units: 'us', language: 'en' });
 */
function buildWidgetContent({ house, entry, units, language, now = Date.now() }) {
  const fr = language === 'fr';
  const nowcast = readNowcast(entry.forecast, Math.floor(now / 1000));
  const components = [{ type: 'text', variant: 'body', text: nowcastSentence(nowcast, language) }];

  if (nowcast.available) {
    const convert = fromSI(units);
    components.push({
      type: 'chart',
      chart_type: WIDGET_CHART_TYPES.BAR,
      title: fr ? 'Précipitations, 60 prochaines minutes' : 'Precipitation, next 60 minutes',
      unit: intensityUnit(units),
      series: [
        {
          name: fr ? 'Intensité' : 'Intensity',
          points: nowcast.points.map((point) => ({
            t: new Date(point.time * 1000).toISOString(),
            v: convert.intensity(point.intensity) ?? 0,
          })),
        },
      ],
    });
  }

  components.push({
    type: 'status',
    items: [
      {
        label: fr ? 'Maison' : 'House',
        value: house.name,
        color: WIDGET_COLORS.NEUTRAL,
      },
      {
        label: fr ? 'Prévision de' : 'Forecast from',
        value: formatTime(entry.fetchedAt, entry.forecast.timezone, language),
        color: WIDGET_COLORS.NEUTRAL,
      },
    ],
  });

  return { ttl_seconds: TTL_SECONDS, components };
}

/**
 * @description The content shown when no forecast can be served.
 * @param {string} message - What went wrong, in the user's language.
 * @returns {object} The widget content.
 * @example
 * buildUnavailableContent('Set the location of your house in Gladys.');
 */
function buildUnavailableContent(message) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: message }],
  };
}

export { TTL_SECONDS, WIDGETS, buildUnavailableContent, buildWidgetContent, formatTime };

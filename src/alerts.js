// -----------------------------------------------------------------------------
// Pirate Weather alerts → Gladys alerts (the CAP-based pivot model).
//
// Pirate Weather relays two families of official alerts:
//   - the US National Weather Service: `title` is the CAP event name
//     ("Tornado Warning", "Heat Advisory"...), in English;
//   - the WMO register (Environment Canada, MeteoAlarm in Europe, and other
//     national services): `title` is the CAP headline or event, in the FIRST
//     language of the bulletin — French in Québec, German in Germany...
//
// `severity` is the CAP severity (Extreme, Severe, Moderate, Minor) — the
// scale Gladys uses — or Unknown; an NWS alert without a CAP message carries
// its VTEC significance instead (W, A, Y, S). Both are mapped, and a still
// unknown severity is read from the title (warning, watch, advisory).
//
// The phenomenon `type` lets Gladys translate, iconify and filter the alert:
// it is classified from the title by keywords, in English and in the main
// languages of the WMO feeds. An alert no keyword matches (Red Flag Warning,
// Air Quality Alert, Special Weather Statement) is sent without a type: Gladys
// keeps it and shows its title.
//
// Gladys keeps at most 10 alerts, in the order received: they are sorted by
// severity first so a flood of advisories never hides a tornado warning.
// -----------------------------------------------------------------------------

import {
  WEATHER_ALERT_SEVERITIES as S,
  WEATHER_ALERT_TYPES as T,
} from '@gladysassistant/integration-sdk';

const MAX_ALERTS = 10;
const MAX_EVENT_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 5000;

const SEVERITY_RANK = Object.freeze({
  [S.MINOR]: 1,
  [S.MODERATE]: 2,
  [S.SEVERE]: 3,
  [S.EXTREME]: 4,
});

const CAP_SEVERITIES = Object.freeze({
  extreme: S.EXTREME,
  severe: S.SEVERE,
  moderate: S.MODERATE,
  minor: S.MINOR,
  // NWS VTEC significance, used by Pirate Weather when the CAP message is
  // missing: Warning, wAtch, advisorY, Statement.
  w: S.SEVERE,
  a: S.MODERATE,
  y: S.MINOR,
  s: S.MINOR,
});

// Severity read from the title when the feed says Unknown, first match wins.
// The MeteoAlarm colours follow the CAP mapping (yellow → moderate, orange →
// severe, red → extreme); English colours only as Met Office phrases, so a
// "Red Flag Warning" (fire weather) is not read as extreme.
const TITLE_SEVERITIES = [
  [S.EXTREME, /\b(rouge|rot|rojo|rosso|red warning)\b/],
  [S.SEVERE, /\b(orange|naranja|arancione|amber warning)\b/],
  [S.MODERATE, /\b(jaune|gelb|amarillo|giallo|yellow warning)\b/],
  [S.SEVERE, /\b(warning|avertissement|alerte|unwetterwarnung)\b/],
  [S.MODERATE, /\b(watch|veille)\b/],
  [S.MINOR, /\b(advisory|statement|bulletin|vorabinformation)\b/],
];

// Phenomenon of an alert, first match wins: the specific phrases come before
// the words they contain — "pluie-inondation" is rain (the Météo-France
// phenomenon) before "inondation" is flood, "storm surge" is coastal before
// "storm" is wind, "freezing rain" is snow/ice before "rain" is rain, "wind
// chill" is cold before "wind" is wind. Matched on the lower-cased title
// stripped of accents, at the start of a word (so "flooding" and "orages"
// match, "event" never matches "vent"); "regen" anywhere, the German
// compounds put it last (Starkregen, Dauerregen).
const TYPE_PATTERNS = [
  [T.RAIN, /\bpluies?[- ]inondation/],
  [T.AVALANCHE, /\b(avalanche|lawine|valanga|avalancha)/],
  [
    T.COASTAL,
    /\b(coastal|storm surge|surge|high surf|rip current|beach hazard|lakeshore|tsunami|vagues|submersion|cotier|cotiere|sturmflut|kusten|costero|costera|oleaje|marejada)/,
  ],
  [T.FLOOD, /\b(flood|inondation|crue|hochwasser|uberschwemmung|inundacion|alluvion|overstroming)/],
  [
    T.THUNDERSTORM,
    /\b(thunderstorm|tornado|waterspout|orage|gewitter|tormenta|temporale|onweer|trombe)/,
  ],
  [
    T.SNOW,
    /\b(blizzard|snow|winter storm|winter weather|ice storm|freezing (rain|drizzle|spray)|sleet|neige|verglas|pluie verglacante|schnee|glatte|glatteis|nieve|nevicat|neve\b|sneeuw|gladheid|lake effect)/,
  ],
  [
    T.COLD,
    /\b(wind chill|extreme cold|cold|freeze|frost|froid|gel\b|gelee|kalte|frio|freddo|koude|low temperature|temperaturas minimas)/,
  ],
  [
    T.HEAT,
    /\b(heat|canicule|chaleur|hitze|calor|caldo|hitte|high temperature|temperaturas maximas)/,
  ],
  [
    T.WIND,
    /\b(hurricane|tropical storm|typhoon|cyclone|wind|gale|dust storm|vents?\b|tempete|ouragan|mistral|rafales|bourrasque|sturm|orkan|viento|vento|storm)/,
  ],
  [T.RAIN, /\b(rain|pluie|lluvia|pioggia|precipitation|downpour)|regen/],
  [T.FOG, /\b(fog|brouillard|brume|nebel|niebla|nebbia|mist)/],
];

/**
 * @description Lower-case a text and strip its accents, for keyword matching.
 * @param {string} text - The text.
 * @returns {string} The folded text.
 * @example
 * fold('Avis de Gelée'); // -> 'avis de gelee'
 */
function fold(text) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * @description Classify the phenomenon of an alert from its title.
 * @param {string} title - The alert title.
 * @returns {string|null} A Gladys alert type, or null when none applies.
 * @example
 * alertType('Excessive Heat Warning'); // -> 'heat'
 */
function alertType(title) {
  const folded = fold(title);
  const match = TYPE_PATTERNS.find(([, pattern]) => pattern.test(folded));
  return match ? match[0] : null;
}

/**
 * @description Map the severity of an alert to the Gladys scale.
 * @param {string|null} severity - The CAP severity (or NWS significance).
 * @param {string} title - The alert title, read when the severity is unknown.
 * @returns {string} A Gladys severity; `moderate` when nothing says more — an
 * official alert stays visible.
 * @example
 * alertSeverity('Unknown', 'Flood Watch'); // -> 'moderate'
 */
function alertSeverity(severity, title) {
  const key = typeof severity === 'string' ? severity.trim().toLowerCase() : '';
  if (Object.hasOwn(CAP_SEVERITIES, key)) {
    return CAP_SEVERITIES[key];
  }
  const folded = fold(title);
  const match = TITLE_SEVERITIES.find(([, pattern]) => pattern.test(folded));
  return match ? match[0] : S.MODERATE;
}

/**
 * @description Cut a text to a length, with an ellipsis when cut.
 * @param {string} text - The text.
 * @param {number} length - The maximum length.
 * @returns {string} The text.
 * @example
 * truncate('abcdef', 4); // -> 'abc…'
 */
function truncate(text, length) {
  return text.length <= length ? text : `${text.slice(0, length - 1).trimEnd()}…`;
}

/**
 * @description Convert the alerts of a slim forecast to Gladys alerts.
 * @param {Array<object>} alerts - The slim alerts (forecast.js).
 * @param {number} nowSeconds - The current UNIX time: expired alerts of a
 * cached forecast are dropped.
 * @returns {Array<object>} At most 10 Gladys alerts, most severe first.
 * @example
 * buildAlerts(forecast.alerts, Math.floor(Date.now() / 1000));
 */
function buildAlerts(alerts, nowSeconds) {
  const seen = new Set();
  const built = [];
  for (const alert of alerts || []) {
    if (alert.expires !== null && alert.expires <= nowSeconds) {
      continue;
    }
    // Pirate Weather can list one bulletin once per matching zone.
    const identity = `${alert.title}|${alert.time}|${alert.expires}`;
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);

    const pivot = {
      severity: alertSeverity(alert.severity, alert.title),
      event: truncate(alert.title, MAX_EVENT_LENGTH),
    };
    const type = alertType(alert.title);
    if (type !== null) {
      pivot.type = type;
    }
    if (alert.description !== null) {
      pivot.description = truncate(alert.description, MAX_DESCRIPTION_LENGTH);
    }
    if (alert.time !== null) {
      pivot.start = new Date(alert.time * 1000).toISOString();
    }
    if (alert.expires !== null) {
      pivot.end = new Date(alert.expires * 1000).toISOString();
    }
    built.push(pivot);
  }
  return built
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        (a.start ?? '').localeCompare(b.start ?? ''),
    )
    .slice(0, MAX_ALERTS);
}

/**
 * @description A stable fingerprint of a set of alerts, to tell whether they
 * changed between two refreshes.
 * @param {Array<object>} pivotAlerts - Gladys alerts (buildAlerts).
 * @returns {string} The fingerprint.
 * @example
 * alertsFingerprint(buildAlerts(forecast.alerts, now));
 */
function alertsFingerprint(pivotAlerts) {
  return pivotAlerts
    .map((alert) => `${alert.type ?? ''}|${alert.event}|${alert.severity}`)
    .sort()
    .join('\n');
}

export { MAX_ALERTS, SEVERITY_RANK, alertSeverity, alertType, alertsFingerprint, buildAlerts };

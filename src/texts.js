// -----------------------------------------------------------------------------
// Texts the integration writes itself, in English, French, German and Spanish
// (the four languages of the Gladys interface).
//
// The core gives the language of the user in a weather request and in a
// widget request, but a scene trigger or a scene action receives none: those
// texts follow the `language` setting, whose default ('auto') is the language
// of the last request of the core.
//
// Every text lives in MESSAGES, TYPE_NOUNS or INTENSITY_WORDS, with exactly
// one entry per language: test/i18n.test.js reads these tables.
// -----------------------------------------------------------------------------

const LANGUAGES = Object.freeze({ EN: 'en', FR: 'fr', DE: 'de', ES: 'es' });
const SUPPORTED_LANGUAGES = Object.freeze(Object.values(LANGUAGES));

// Locales of the number and time formats.
const LOCALES = Object.freeze({ en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' });

// `{name}` placeholders are filled by format().
const MESSAGES = Object.freeze({
  statusNoKey: {
    en: 'Enter your free Pirate Weather API key in the configuration.',
    fr: 'Saisissez votre clé d’API Pirate Weather gratuite dans la configuration.',
    de: 'Gib deinen kostenlosen Pirate Weather API-Schlüssel in der Konfiguration ein.',
    es: 'Introduzca su clave de API gratuita de Pirate Weather en la configuración.',
  },
  statusKeyRefused: {
    en: 'Pirate Weather refused the API key. Check it, and that the forecast API is subscribed (allow 20 minutes after signing up).',
    fr: 'Pirate Weather refuse la clé d’API. Vérifiez-la, et que l’API forecast est souscrite (comptez 20 minutes après l’inscription).',
    de: 'Pirate Weather lehnt den API-Schlüssel ab. Prüfe ihn und ob die Forecast-API abonniert ist (nach der Anmeldung bis zu 20 Minuten warten).',
    es: 'Pirate Weather rechaza la clave de API. Compruébela, y que la API forecast esté suscrita (cuente 20 minutos tras el registro).',
  },
  statusQuotaSpent: {
    en: 'Monthly Pirate Weather quota spent: refreshes resume after its reset{reset}.',
    fr: 'Quota mensuel Pirate Weather épuisé : les mises à jour reprennent après sa remise à zéro{reset}.',
    de: 'Monatliches Pirate Weather-Kontingent aufgebraucht: Die Aktualisierungen laufen nach dem Zurücksetzen weiter{reset}.',
    es: 'Cuota mensual de Pirate Weather agotada: las actualizaciones se reanudan tras su reinicio{reset}.',
  },
  statusNoLocatedHouse: {
    en: 'No house of Gladys has a location: set it in Settings → Houses.',
    fr: 'Aucune maison de Gladys n’a de position : renseignez-la dans Paramètres → Maisons.',
    de: 'Kein Zuhause in Gladys hat einen Standort: Lege ihn unter Einstellungen → Zuhause fest.',
    es: 'Ninguna casa de Gladys tiene ubicación: defínala en Configuración → Viviendas.',
  },
  statusUnreachable: {
    en: 'Pirate Weather is unreachable for now: retrying in a few minutes.',
    fr: 'Pirate Weather est injoignable pour le moment : nouvel essai dans quelques minutes.',
    de: 'Pirate Weather ist gerade nicht erreichbar: neuer Versuch in ein paar Minuten.',
    es: 'Pirate Weather no está disponible por ahora: nuevo intento en unos minutos.',
  },
  testWorks: {
    en: 'It works: {us} °F ({metric} °C) now at {place}.{quota}{cadence}',
    fr: 'Ça fonctionne : {metric} °C en ce moment à {place}.{quota}{cadence}',
    de: 'Es funktioniert: gerade {metric} °C in {place}.{quota}{cadence}',
    es: 'Funciona: {metric} °C en este momento en {place}.{quota}{cadence}',
  },
  testQuota: {
    en: ' Calls left this month: {remaining} of {limit}.',
    fr: ' Appels restants ce mois-ci : {remaining} sur {limit}.',
    de: ' Verbleibende Aufrufe in diesem Monat: {remaining} von {limit}.',
    es: ' Llamadas restantes este mes: {remaining} de {limit}.',
  },
  testCadence: {
    en: ' Refreshing every {minutes} min.',
    fr: ' Mise à jour toutes les {minutes} min.',
    de: ' Aktualisierung alle {minutes} Min.',
    es: ' Actualización cada {minutes} min.',
  },
  widgetUnavailable: {
    en: 'Forecast unavailable: {reason}',
    fr: 'Prévision indisponible : {reason}',
    de: 'Vorhersage nicht verfügbar: {reason}',
    es: 'Pronóstico no disponible: {reason}',
  },
  widgetChartTitle: {
    en: 'Precipitation, next 60 minutes',
    fr: 'Précipitations, 60 prochaines minutes',
    de: 'Niederschlag, nächste 60 Minuten',
    es: 'Precipitaciones, próximos 60 minutos',
  },
  widgetIntensity: { en: 'Intensity', fr: 'Intensité', de: 'Intensität', es: 'Intensidad' },
  widgetHouse: { en: 'House', fr: 'Maison', de: 'Zuhause', es: 'Casa' },
  widgetForecastFrom: {
    en: 'Forecast from',
    fr: 'Prévision de',
    de: 'Vorhersage von',
    es: 'Pronóstico de',
  },
  nowcastUnavailable: {
    en: 'No minute-by-minute forecast for this location.',
    fr: 'Pas de prévision minute par minute pour ce lieu.',
    de: 'Keine minutengenaue Vorhersage für diesen Ort.',
    es: 'No hay pronóstico minuto a minuto para esta ubicación.',
  },
  nowcastDry: {
    en: 'No precipitation expected within the hour.',
    fr: 'Pas de précipitations prévues dans l’heure.',
    de: 'Kein Niederschlag in der nächsten Stunde erwartet.',
    es: 'No se esperan precipitaciones en la próxima hora.',
  },
  // {label} starts a sentence ("Light rain"), {inner} sits inside one
  // ("leichter Regen": German writes the adjective in lower case there).
  nowcastNow: {
    en: '{label} now{chance}.',
    fr: '{label} en ce moment{chance}.',
    de: 'Gerade {inner}{chance}.',
    es: '{label} en este momento{chance}.',
  },
  nowcastSoon: {
    en: '{label} expected in {minutes}{chance}.',
    fr: '{label} {expected} dans {minutes}{chance}.',
    de: '{label} in {minutes} erwartet{chance}.',
    es: '{label} {expected} en {minutes}{chance}.',
  },
  // French and Spanish agree "expected" with the noun: [masculine, feminine].
  expected: {
    en: ['expected', 'expected'],
    fr: ['attendu', 'attendue'],
    de: ['erwartet', 'erwartet'],
    es: ['previsto', 'prevista'],
  },
  chance: {
    en: ' ({probability}% chance)',
    fr: ' (probabilité {probability} %)',
    de: ' (Wahrscheinlichkeit {probability} %)',
    es: ' (probabilidad del {probability} %)',
  },
  minute: { en: 'minute', fr: 'minute', de: 'Minute', es: 'minuto' },
  minutes: { en: 'minutes', fr: 'minutes', de: 'Minuten', es: 'minutos' },
});

// The noun of each precipitation type, and whether it is feminine (adjectives
// agree with it in French, German and Spanish).
const TYPE_NOUNS = Object.freeze({
  rain: {
    en: { noun: 'rain' },
    fr: { noun: 'pluie', feminine: true },
    de: { noun: 'Regen', feminine: false },
    es: { noun: 'lluvia', feminine: true },
  },
  snow: {
    en: { noun: 'snow' },
    fr: { noun: 'neige', feminine: true },
    de: { noun: 'Schneefall', feminine: false },
    es: { noun: 'nieve', feminine: true },
  },
  sleet: {
    en: { noun: 'sleet' },
    fr: { noun: 'grésil', feminine: false },
    de: { noun: 'Schneeregen', feminine: false },
    es: { noun: 'aguanieve', feminine: true },
  },
  freezing_rain: {
    en: { noun: 'freezing rain' },
    fr: { noun: 'pluie verglaçante', feminine: true },
    de: { noun: 'gefrierender Regen', feminine: false },
    es: { noun: 'lluvia engelante', feminine: true },
  },
});

// Intensity adjectives: [masculine, feminine]. German declines them without
// an article ("leichter Regen").
const INTENSITY_WORDS = Object.freeze({
  light: {
    en: ['light', 'light'],
    fr: ['faible', 'faible'],
    de: ['leichter', 'leichte'],
    es: ['débil', 'débil'],
  },
  moderate: {
    en: ['moderate', 'moderate'],
    fr: ['modéré', 'modérée'],
    de: ['mäßiger', 'mäßige'],
    es: ['moderado', 'moderada'],
  },
  heavy: {
    en: ['heavy', 'heavy'],
    fr: ['fort', 'forte'],
    de: ['starker', 'starke'],
    es: ['fuerte', 'fuerte'],
  },
});

// French and Spanish put the adjective after the noun.
const NOUN_FIRST = new Set([LANGUAGES.FR, LANGUAGES.ES]);

/**
 * @description Pick the language of a text: the setting, or with 'auto' the
 * language of the last request of the core. An unsupported language is English.
 * @param {string} setting - The `language` setting ('auto', 'en', 'fr', 'de', 'es').
 * @param {string|null} [lastSeen] - The language of the last core request.
 * @returns {string} 'en', 'fr', 'de' or 'es'.
 * @example
 * resolveLanguage('auto', 'fr-FR'); // -> 'fr'
 */
function resolveLanguage(setting, lastSeen = null) {
  const wanted = setting === 'auto' ? lastSeen : setting;
  const prefix = typeof wanted === 'string' ? wanted.slice(0, 2).toLowerCase() : '';
  return SUPPORTED_LANGUAGES.includes(prefix) ? prefix : LANGUAGES.EN;
}

/**
 * @description The text of a message in a language, its placeholders filled.
 * @param {string} key - A MESSAGES key.
 * @param {string} language - 'en', 'fr', 'de' or 'es'.
 * @param {object} [values] - The placeholder values.
 * @returns {string} The text.
 * @example
 * t('testCadence', 'de', { minutes: 15 }); // -> ' Aktualisierung alle 15 Min.'
 */
function t(key, language, values = {}) {
  const texts = MESSAGES[key];
  const template = texts[language] ?? texts.en;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    name in values ? String(values[name]) : match,
  );
}

/**
 * @description A message in every language, as the core takes it.
 * @param {string} key - A MESSAGES key.
 * @param {object|Function} [values] - The placeholder values, or
 * `(language) => values`.
 * @returns {{en: string, fr: string, de: string, es: string}} The texts.
 * @example
 * localized('statusNoKey');
 */
function localized(key, values = {}) {
  return Object.fromEntries(
    SUPPORTED_LANGUAGES.map((language) => [
      language,
      t(key, language, typeof values === 'function' ? values(language) : values),
    ]),
  );
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * @description Name a precipitation as it sits inside a sentence: "light
 * rain", "neige forte", "leichter Regen".
 * @param {string} type - A PRECIPITATION_TYPES value.
 * @param {string} intensity - An INTENSITIES value.
 * @param {string} language - 'en', 'fr', 'de' or 'es'.
 * @returns {string} The name.
 * @example
 * precipitationWords('rain', 'heavy', 'de'); // -> 'starker Regen'
 */
function precipitationWords(type, intensity, language) {
  const lang = SUPPORTED_LANGUAGES.includes(language) ? language : LANGUAGES.EN;
  const { noun, feminine } = (TYPE_NOUNS[type] ?? TYPE_NOUNS.rain)[lang];
  const adjective = (INTENSITY_WORDS[intensity] ?? INTENSITY_WORDS.light)[lang][feminine ? 1 : 0];
  return NOUN_FIRST.has(lang) ? `${noun} ${adjective}` : `${adjective} ${noun}`;
}

/**
 * @description Name a precipitation: "Light rain", "Neige forte".
 * @param {string} type - A PRECIPITATION_TYPES value.
 * @param {string} intensity - An INTENSITIES value.
 * @param {string} language - 'en', 'fr', 'de' or 'es'.
 * @returns {string} The capitalized name.
 * @example
 * precipitationLabel('sleet', 'heavy', 'fr'); // -> 'Grésil fort'
 */
function precipitationLabel(type, intensity, language) {
  return capitalize(precipitationWords(type, intensity, language));
}

/**
 * @description The sentence of a nowcast, ready to put in a message.
 * @param {object} nowcast - A readNowcast() result.
 * @param {string} language - 'en', 'fr', 'de' or 'es'.
 * @returns {string} The sentence.
 * @example
 * nowcastSentence(nowcast, 'en'); // -> 'Light rain expected in 12 minutes (80% chance).'
 */
function nowcastSentence(nowcast, language) {
  const lang = SUPPORTED_LANGUAGES.includes(language) ? language : LANGUAGES.EN;
  if (!nowcast.available) {
    return t('nowcastUnavailable', lang);
  }
  if (nowcast.minutesUntil === null) {
    return t('nowcastDry', lang);
  }
  const inner = precipitationWords(nowcast.type, nowcast.intensity, lang);
  const label = capitalize(inner);
  const chance =
    nowcast.probability === null ? '' : t('chance', lang, { probability: nowcast.probability });
  if (nowcast.minutesUntil === 0) {
    return t('nowcastNow', lang, { label, inner, chance });
  }
  const count = nowcast.minutesUntil;
  const minutes = `${count} ${t(count > 1 ? 'minutes' : 'minute', lang)}`;
  const { feminine } = (TYPE_NOUNS[nowcast.type] ?? TYPE_NOUNS.rain)[lang];
  const expected = MESSAGES.expected[lang][feminine ? 1 : 0];
  return t('nowcastSoon', lang, { label, minutes, expected, chance });
}

/**
 * @description Format an integer with the thousands separator of a language.
 * @param {number} value - The number.
 * @param {string} language - 'en', 'fr', 'de' or 'es'.
 * @returns {string} "9,412", "9 412" or "9.412".
 * @example
 * formatCount(9412, 'fr'); // -> '9 412'
 */
function formatCount(value, language) {
  return new Intl.NumberFormat(LOCALES[language] ?? LOCALES.en).format(value);
}

export {
  INTENSITY_WORDS,
  LANGUAGES,
  LOCALES,
  MESSAGES,
  SUPPORTED_LANGUAGES,
  TYPE_NOUNS,
  formatCount,
  localized,
  nowcastSentence,
  precipitationLabel,
  resolveLanguage,
  t,
};

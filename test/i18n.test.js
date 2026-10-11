// -----------------------------------------------------------------------------
// Every text the user reads exists in the four languages of the Gladys
// interface: English, French, German and Spanish. Gladys shows the language of
// the user when the text has it, English otherwise — a missing key silently
// falls back, so this test is the only thing that catches it.
//
// Covered: every multi-language object of the manifest, and the text tables of
// the code (MESSAGES, TYPE_NOUNS, INTENSITY_WORDS in src/texts.js). German
// says "du" and Spanish "usted" across all integrations of the author: a
// polite German "Sie" fails the test.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { connectionStatus } from '../src/app.js';
import { ERROR_KINDS } from '../src/api.js';
import {
  INTENSITY_WORDS,
  MESSAGES,
  SUPPORTED_LANGUAGES,
  TYPE_NOUNS,
  localized,
  nowcastSentence,
} from '../src/texts.js';

const LANGUAGES = ['de', 'en', 'es', 'fr'];
const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

// The polite German forms, capitalized; "sie"/"ihr" in lower case are fine.
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?!\p{L})/u;
const TEXT_KEYS = ['label', 'description', 'placeholder'];

/**
 * @description Every multi-language object of the manifest, with its path:
 * the value of any label/description/placeholder, and any object holding a
 * language key.
 * @param {any} node - A manifest node.
 * @param {string} path - Its path.
 * @param {Array} found - The accumulator.
 * @returns {Array<{path: string, key: string, text: any}>} The objects.
 * @example
 * collect(manifest, '', []);
 */
function collect(node, path, found) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => collect(item, `${path}[${index}]`, found));
  } else if (node !== null && typeof node === 'object') {
    if (Object.keys(node).some((key) => LANGUAGES.includes(key))) {
      found.push({ path, key: path.split('.').pop(), text: node });
      return found;
    }
    for (const [key, value] of Object.entries(node)) {
      if (TEXT_KEYS.includes(key)) {
        found.push({ path: `${path}.${key}`, key, text: value });
      } else {
        collect(value, `${path}.${key}`, found);
      }
    }
  }
  return found;
}

const manifestTexts = collect(manifest, '', []);

/**
 * @description The longest text a manifest entry may hold.
 * @param {string} path - The path of the text.
 * @param {string} key - label, description or placeholder.
 * @returns {number} The limit, in characters.
 * @example
 * manifestLimit('.description', 'description'); // -> 100
 */
function manifestLimit(path, key) {
  if (path === '.description') return 100; // the store catalog
  if (/^\.widgets\[\d+\]\.label$/.test(path)) return 30;
  if (/\.options\[\d+\]\.label$/.test(path)) return 40;
  if (key === 'placeholder') return 40;
  if (key === 'label') return 60;
  return 400;
}

// Labels of the widget tiles stay short; a status message is a toast,
// truncated by the core at 200 characters.
const MESSAGE_LIMITS = {
  widgetHouse: 20,
  widgetIntensity: 20,
  widgetForecastFrom: 20,
  widgetChartTitle: 40,
  minute: 20,
  minutes: 20,
};

/**
 * @description The problems of one multi-language object.
 * @param {any} text - The object.
 * @param {number} limit - The longest text allowed.
 * @returns {string[]} What is wrong, empty when nothing.
 * @example
 * problems({ en: 'House', fr: 'Maison' }, 40); // -> ['languages de,en,es,fr expected, got en,fr']
 */
function problems(text, limit) {
  if (text === null || typeof text !== 'object' || Array.isArray(text)) {
    return [`a multi-language object expected, got ${JSON.stringify(text)}`];
  }
  const found = [];
  const keys = Object.keys(text).sort();
  if (keys.join(',') !== LANGUAGES.join(',')) {
    found.push(`languages ${LANGUAGES.join(',')} expected, got ${keys.join(',')}`);
  }
  for (const [language, value] of Object.entries(text)) {
    for (const string of [value].flat()) {
      if (typeof string !== 'string' || string.trim() === '') {
        found.push(`${language}: empty or not a text`);
      } else if (string.length > limit) {
        found.push(`${language}: ${string.length} characters, at most ${limit}`);
      } else if (language === 'de' && POLITE_GERMAN.test(string)) {
        found.push(`de: polite form in "${string}" (German says "du")`);
      }
    }
  }
  return found;
}

/**
 * @description The `{name}` placeholders of a template, sorted.
 * @param {string} template - The template.
 * @returns {string} The names, comma-separated.
 * @example
 * placeholders('{a} and {b}'); // -> 'a,b'
 */
const placeholders = (template) =>
  [...template.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .sort()
    .join(',');

test('the code supports exactly the four languages of Gladys', () => {
  assert.deepEqual([...SUPPORTED_LANGUAGES].sort(), LANGUAGES);
});

test('every manifest text exists in English, French, German and Spanish', () => {
  // About sixty objects today: an empty list would mean a broken walk.
  assert.ok(manifestTexts.length > 50, `${manifestTexts.length} texts found`);
  const failures = manifestTexts.flatMap(({ path, key, text }) =>
    problems(text, manifestLimit(path, key)).map((problem) => `${path}: ${problem}`),
  );
  assert.deepEqual(failures, []);
});

test('every message of the code exists in the four languages', () => {
  const failures = Object.entries(MESSAGES).flatMap(([key, text]) =>
    problems(text, MESSAGE_LIMITS[key] ?? 200).map((problem) => `MESSAGES.${key}: ${problem}`),
  );
  assert.deepEqual(failures, []);
});

// Where a translation fills other placeholders than English, on purpose: the
// test button gives °F and °C in English only; French and Spanish agree
// "expected" with the noun; German writes "Gerade leichter Regen".
const PLACEHOLDER_EXCEPTIONS = {
  'testWorks.fr': 'cadence,metric,place,quota',
  'testWorks.de': 'cadence,metric,place,quota',
  'testWorks.es': 'cadence,metric,place,quota',
  'nowcastSoon.fr': 'chance,expected,label,minutes',
  'nowcastSoon.es': 'chance,expected,label,minutes',
  'nowcastNow.de': 'chance,inner',
};

test('every translation fills the placeholders of the English text', () => {
  for (const [key, text] of Object.entries(MESSAGES)) {
    if (typeof text.en !== 'string') continue;
    for (const language of LANGUAGES) {
      const expected = PLACEHOLDER_EXCEPTIONS[`${key}.${language}`] ?? placeholders(text.en);
      assert.equal(placeholders(text[language]), expected, `${key}.${language}`);
    }
  }
});

test('every precipitation noun and intensity word exists in the four languages', () => {
  const failures = [];
  for (const [type, nouns] of Object.entries(TYPE_NOUNS)) {
    const flat = Object.fromEntries(Object.entries(nouns).map(([lang, { noun }]) => [lang, noun]));
    failures.push(...problems(flat, 40).map((problem) => `TYPE_NOUNS.${type}: ${problem}`));
  }
  for (const [intensity, words] of Object.entries(INTENSITY_WORDS)) {
    failures.push(
      ...problems(words, 20).map((problem) => `INTENSITY_WORDS.${intensity}: ${problem}`),
    );
  }
  assert.deepEqual(failures, []);
});

test('the status messages sent to Gladys carry the four languages', () => {
  const config = { api_key: 'key' };
  const summaries = [
    { error: { kind: ERROR_KINDS.AUTH } },
    { error: { kind: ERROR_KINDS.QUOTA } },
    { error: null, houses: 0 },
    { error: { kind: ERROR_KINDS.NETWORK }, houses: 1, refreshed: 0 },
  ];
  const statuses = [
    connectionStatus({ config: { api_key: '' }, summary: null, usage: null }),
    ...summaries.map((summary) => connectionStatus({ config, summary, usage: null })),
  ];
  for (const status of statuses) {
    assert.equal(status.connected, false);
    assert.deepEqual(problems(status.message, 200), [], JSON.stringify(status.message));
  }
  assert.deepEqual(Object.keys(localized('statusNoKey')).sort(), LANGUAGES);
});

test('the nowcast sentences read naturally in German and Spanish', () => {
  const soon = {
    available: true,
    minutesUntil: 12,
    type: 'rain',
    intensity: 'heavy',
    probability: 80,
  };
  assert.equal(
    nowcastSentence(soon, 'de'),
    'Starker Regen in 12 Minuten erwartet (Wahrscheinlichkeit 80 %).',
  );
  assert.equal(
    nowcastSentence(soon, 'es'),
    'Lluvia fuerte prevista en 12 minutos (probabilidad del 80 %).',
  );
  const now = { ...soon, minutesUntil: 0, type: 'freezing_rain', intensity: 'light' };
  assert.equal(
    nowcastSentence(now, 'de'),
    'Gerade leichter gefrierender Regen (Wahrscheinlichkeit 80 %).',
  );
  assert.equal(
    nowcastSentence(now, 'es'),
    'Lluvia engelante débil en este momento (probabilidad del 80 %).',
  );
  const sleet = {
    ...soon,
    minutesUntil: 1,
    type: 'sleet',
    intensity: 'moderate',
    probability: null,
  };
  assert.equal(nowcastSentence(sleet, 'de'), 'Mäßiger Schneeregen in 1 Minute erwartet.');
  assert.equal(nowcastSentence(sleet, 'es'), 'Aguanieve moderada prevista en 1 minuto.');
  assert.equal(nowcastSentence(sleet, 'fr'), 'Grésil modéré attendu dans 1 minute.');
});

test('no text of the code is picked by a language test outside src/texts.js', async () => {
  const dir = new URL('../src/', import.meta.url);
  for (const file of await readdir(dir)) {
    if (file === 'texts.js') continue;
    const source = await readFile(new URL(file, dir), 'utf8');
    assert.doesNotMatch(source, /===\s*'(fr|en|de|es)'|LANGUAGES\.(FR|EN|DE|ES)/, file);
    assert.doesNotMatch(source, /\bfr:\s*['`]/, `${file}: a French text outside the tables`);
  }
});

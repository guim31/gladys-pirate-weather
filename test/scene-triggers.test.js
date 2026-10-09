import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseForecast } from '../src/forecast.js';
import { COOLDOWN_MS, SCENE_TRIGGERS, createPrecipitationWatcher } from '../src/scene-triggers.js';
import { HOUSES, OKC_NOW, loadFixture } from './helpers/fixtures.js';

const silent = { info() {}, warn() {}, debug() {}, error() {} };
const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

/**
 * @param {number} rainFrom - The first wet minute, or -1 for a dry hour.
 * @param {number} time - The time of the first minute (s).
 * @returns {object} A slim forecast.
 */
function hour(rainFrom, time) {
  return {
    minutely: Array.from({ length: 61 }, (_, i) => ({
      time: time + 60 * i,
      precipIntensity: rainFrom >= 0 && i >= rainFrom ? 1.5 : 0,
      precipProbability: 0.7,
      precipType: 'rain',
    })),
  };
}

/**
 * @returns {object} The watcher and what it published.
 */
function setup() {
  const clock = { now: 1_000_000 * 1000 };
  const published = [];
  const watcher = createPrecipitationWatcher({
    publish: async (key, data) => published.push({ key, data }),
    getLanguage: () => 'en',
    logger: silent,
    now: () => clock.now,
  });
  return { watcher, published, clock };
}

test('dry, then rain within the hour: the trigger fires once, with its variables', async () => {
  const { watcher, published, clock } = setup();
  const t = () => Math.floor(clock.now / 1000);
  await watcher.observe(HOUSES.okc, hour(-1, t()));
  assert.equal(published.length, 0, 'baseline');
  clock.now += 15 * 60000;
  await watcher.observe(HOUSES.okc, hour(12, t()));
  assert.equal(published.length, 1);
  assert.equal(published[0].key, SCENE_TRIGGERS.PRECIPITATION_EXPECTED);
  assert.deepEqual(published[0].data, {
    house: 'Home',
    precipitation_type: 'rain',
    intensity: 'light',
    minutes_until: 12,
    probability: 70,
    summary: 'Light rain expected in 12 minutes (70% chance).',
  });
  clock.now += 15 * 60000;
  await watcher.observe(HOUSES.okc, hour(0, t()));
  assert.equal(published.length, 1, 'still the same rain: no new event');
});

test('the first forecast after a start never fires, even when it rains', async () => {
  const { watcher, published, clock } = setup();
  await watcher.observe(HOUSES.okc, hour(5, Math.floor(clock.now / 1000)));
  assert.equal(published.length, 0);
});

test('a shower that comes back within 45 minutes does not fire twice', async () => {
  const { watcher, published, clock } = setup();
  const t = () => Math.floor(clock.now / 1000);
  await watcher.observe(HOUSES.okc, hour(-1, t()));
  clock.now += 15 * 60000;
  await watcher.observe(HOUSES.okc, hour(10, t()));
  clock.now += 15 * 60000;
  await watcher.observe(HOUSES.okc, hour(-1, t()));
  clock.now += 15 * 60000;
  await watcher.observe(HOUSES.okc, hour(10, t()));
  assert.equal(published.length, 1, 'cooldown');
  clock.now += COOLDOWN_MS;
  await watcher.observe(HOUSES.okc, hour(-1, t()));
  clock.now += 15 * 60000;
  await watcher.observe(HOUSES.okc, hour(10, t()));
  assert.equal(published.length, 2);
});

test('each house has its own state; forget and reset start new baselines', async () => {
  const { watcher, published, clock } = setup();
  const t = () => Math.floor(clock.now / 1000);
  await watcher.observe(HOUSES.okc, hour(-1, t()));
  await watcher.observe(HOUSES.paris, hour(-1, t()));
  watcher.forget(new Set([HOUSES.paris.id]));
  clock.now += 15 * 60000;
  await watcher.observe(HOUSES.okc, hour(3, t()));
  await watcher.observe(HOUSES.paris, hour(3, t()));
  assert.deepEqual(
    published.map((event) => event.data.house),
    ['Maison'],
  );
  watcher.reset();
  clock.now += COOLDOWN_MS;
  await watcher.observe(HOUSES.paris, hour(-1, t()));
  assert.equal(published.length, 1);
});

test('a refused event is logged, never thrown into the refresh cycle', async () => {
  const watcher = createPrecipitationWatcher({
    publish: async () => {
      throw new Error('429');
    },
    getLanguage: () => 'fr',
    logger: silent,
    now: () => 0,
  });
  await watcher.observe(HOUSES.okc, hour(-1, 0));
  const data = await watcher.observe(HOUSES.okc, hour(2, 0));
  assert.equal(data.summary, 'Pluie faible attendue dans 2 minutes (probabilité 70 %).');
});

test('the event data matches the manifest declaration', async () => {
  const declaration = manifest.scene_triggers.find(
    (trigger) => trigger.key === SCENE_TRIGGERS.PRECIPITATION_EXPECTED,
  );
  const { watcher, published, clock } = setup();
  const forecast = parseForecast(loadFixture('synthetic-oklahoma-city-nws-alerts.json'));
  clock.now = OKC_NOW - 15 * 60000;
  await watcher.observe(HOUSES.okc, hour(-1, Math.floor(clock.now / 1000)));
  clock.now = OKC_NOW;
  await watcher.observe(HOUSES.okc, forecast);
  const { data } = published[0];
  const declared = new Set([
    ...declaration.fields.map((field) => field.key),
    ...declaration.variables.map((variable) => variable.key),
  ]);
  assert.deepEqual(Object.keys(data).sort(), [...declared].sort());
  for (const field of declaration.fields.filter((f) => f.options)) {
    const values = field.options.map((option) => option.value);
    assert.ok(values.includes(data[field.key]), `${field.key} = ${data[field.key]}`);
  }
  for (const variable of declaration.variables) {
    assert.equal(typeof data[variable.key], variable.type, variable.key);
  }
  assert.equal(data.intensity, 'heavy');
  assert.equal(data.minutes_until, 18);
});

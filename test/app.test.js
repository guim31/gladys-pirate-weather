// The integration end to end: a fake Gladys client, a fake Pirate Weather API
// answering with the fixtures, and fake timers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createFakeGladys } from './helpers/fake-gladys.js';
import {
  HOUSES,
  OKC_NOW,
  fakeFetch,
  fixtureForUrl,
  loadFixture,
  quotaHeaders,
} from './helpers/fixtures.js';

const silent = { info() {}, warn() {}, debug() {}, error() {} };

/**
 * @param {object} [options] - Options.
 * @returns {object} The app, the fake client, the fake API and the clock.
 */
async function start({
  config = { api_key: 'key' },
  houses = [HOUSES.okc],
  route = (url) => ({ body: fixtureForUrl(url), headers: quotaHeaders({ remaining: 9412 }) }),
  connect = true,
} = {}) {
  const clock = { now: OKC_NOW };
  const timers = [];
  const gladys = createFakeGladys({ config, houses });
  const fetchImpl = fakeFetch(route);
  const app = createApp(gladys, {
    fetchImpl,
    now: () => clock.now,
    logger: silent,
    setTimer: (fn, delay) => {
      const timer = { fn, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      timer.cleared = true;
    },
  });
  if (connect) {
    await gladys.fake.connect();
    await app.scheduler.settled();
  }
  return { app, gladys, fake: gladys.fake, fetchImpl, clock, timers };
}

test('connected: one call per house, then every weather request is served from memory', async () => {
  const { fake, fetchImpl } = await start();
  assert.equal(fetchImpl.calls.length, 1);
  assert.deepEqual(fake.lastStatus(), { connected: true });
  const metric = await fake.weatherGet({ ...HOUSES.okc, language: 'en', units: 'metric' });
  const us = await fake.weatherGet({ ...HOUSES.okc, language: 'en', units: 'us' });
  assert.equal(metric.temperature, 33.2);
  assert.equal(us.temperature, 91.8);
  assert.equal(us.alerts[0].event, 'Tornado Warning');
  assert.equal(fetchImpl.calls.length, 1, 'a °C user and a °F user share one call');
});

test('a house the timer does not know yet is fetched on demand', async () => {
  const { fake, fetchImpl } = await start();
  const weather = await fake.weatherGet({ ...HOUSES.paris, language: 'fr', units: 'metric' });
  assert.equal(weather.temperature, 21.6);
  assert.equal(fetchImpl.calls.length, 2);
});

test('the scene action reads the next hour from memory, in the language of Gladys', async () => {
  const { fake, fetchImpl } = await start({ config: { api_key: 'key', language: 'fr' } });
  const outputs = await fake.sceneAction('get_precipitation_next_hour', { house: 'home' });
  assert.deepEqual(outputs, {
    available: true,
    precipitation_expected: true,
    minutes_until: 18,
    precipitation_type: 'rain',
    intensity: 'heavy',
    probability: 90,
    summary: 'Pluie forte attendue dans 18 minutes (probabilité 90 %).',
  });
  assert.equal(fetchImpl.calls.length, 1);
  await assert.rejects(
    fake.sceneAction('get_precipitation_next_hour', { house: 'Cabin' }),
    /No located house named "Cabin"/,
  );
});

test('"auto" language follows the last request of the core', async () => {
  const { fake } = await start();
  await fake.weatherGet({ ...HOUSES.okc, language: 'fr', units: 'metric' });
  const outputs = await fake.sceneAction('get_precipitation_next_hour', {});
  assert.match(outputs.summary, /^Pluie forte/);
});

test('the widget shows the chart of the house in the units of the viewer', async () => {
  const { fake } = await start();
  const content = await fake.widgetGet('precipitation_next_hour', {
    settings: {},
    language: 'en',
    units: 'us',
  });
  assert.equal(content.components[1].type, 'chart');
  assert.equal(content.components[1].unit, 'in/h');
  const missing = await fake.widgetGet('precipitation_next_hour', {
    settings: { house: 'Cabin' },
    language: 'fr',
    units: 'metric',
  });
  assert.match(missing.components[0].text, /^Prévision indisponible/);
  assert.deepEqual(fake.widgetRefreshes, ['precipitation_next_hour'], 'nudged after the refresh');
});

test('the test button answers with the weather, the quota and the cadence', async () => {
  const { fake, fetchImpl } = await start();
  const message = await fake.action('test_connection');
  assert.equal(fetchImpl.calls.length, 2, 'a fresh call');
  assert.equal(
    message.en,
    'It works: 91.8 °F (33.2 °C) now at Home (Oklahoma City). Calls left this month: 9,412 of 10,000. Refreshing every 15 min.',
  );
  assert.equal(
    message.fr.replace(/\u202f/g, ' '),
    'Ça fonctionne : 33.2 °C en ce moment à Home (Oklahoma City). Appels restants ce mois-ci : 9 412 sur 10 000. Mise à jour toutes les 15 min.',
  );
});

test('no API key: no call, a clear status, the weather request fails over', async () => {
  const { fake, fetchImpl } = await start({ config: {} });
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(fake.lastStatus().connected, false);
  assert.match(fake.lastStatus().message.en, /Enter your free Pirate Weather API key/);
  await assert.rejects(
    fake.weatherGet({ ...HOUSES.okc, units: 'metric' }),
    /No Pirate Weather API key/,
  );
  await assert.rejects(fake.action('test_connection'), /Enter your Pirate Weather API key first/);
});

test('a refused key: status explains it, the refreshes stop until the key changes', async () => {
  let refused = true;
  const { fake, fetchImpl, timers } = await start({
    route: (url) => (refused ? { status: 401 } : { body: fixtureForUrl(url) }),
  });
  assert.equal(fake.lastStatus().connected, false);
  assert.match(fake.lastStatus().message.en, /refused the API key/);
  assert.equal(timers.filter((timer) => !timer.cleared).length, 0);
  refused = false;
  await fake.configUpdated({ api_key: 'new-key' });
  assert.equal(fetchImpl.calls.length, 2);
  assert.deepEqual(fake.lastStatus(), { connected: true });
});

test('no located house: the status says where to set it', async () => {
  const { fake, fetchImpl } = await start({ houses: [{ id: 1, name: 'Home', latitude: null }] });
  assert.equal(fetchImpl.calls.length, 0);
  assert.match(fake.lastStatus().message.en, /Settings → Houses/);
});

test('quota spent: status says so, the forecast in memory is still served', async () => {
  let spent = false;
  const { app, fake, clock } = await start({
    route: (url) =>
      spent
        ? { status: 429, headers: quotaHeaders({ remaining: 0, reset: 86400 }) }
        : { body: fixtureForUrl(url), headers: quotaHeaders({ remaining: 9000 }) },
  });
  spent = true;
  clock.now += 20 * 60000;
  await app.scheduler.requestCycle();
  assert.equal(fake.lastStatus().connected, false);
  assert.match(fake.lastStatus().message.en, /quota spent/);
  const weather = await fake.weatherGet({ ...HOUSES.okc, units: 'us' });
  assert.equal(weather.temperature, 91.8);
});

test('alerts that change make the core re-read the weather; the first ones do not', async () => {
  let fixture = loadFixture('synthetic-oklahoma-city-nws-alerts.json');
  const { app, fake } = await start({ route: () => ({ body: fixture }) });
  assert.equal(fake.weatherRefreshes, 0, 'baseline');
  await app.scheduler.requestCycle();
  assert.equal(fake.weatherRefreshes, 0, 'same alerts');
  fixture = loadFixture('synthetic-oklahoma-city-nws-alerts.json');
  fixture.alerts.push({
    title: 'Hurricane Warning',
    severity: 'Extreme',
    time: OKC_NOW / 1000,
    expires: OKC_NOW / 1000 + 86400,
    description: 'Leave now.',
  });
  await app.scheduler.requestCycle();
  assert.equal(fake.weatherRefreshes, 1);
});

test('rain announced between two refreshes fires the scene trigger', async () => {
  const dry = loadFixture('synthetic-oklahoma-city-nws-alerts.json');
  for (const minute of dry.minutely.data) {
    minute.precipIntensity = 0;
  }
  let fixture = dry;
  const { app, fake, clock } = await start({ route: () => ({ body: fixture }) });
  assert.equal(fake.sceneEvents.length, 0);
  fixture = loadFixture('synthetic-oklahoma-city-nws-alerts.json');
  clock.now = OKC_NOW;
  await app.scheduler.requestCycle();
  assert.equal(fake.sceneEvents.length, 1);
  assert.equal(fake.sceneEvents[0].data.summary, 'Heavy rain expected in 18 minutes (90% chance).');
});

test('changing only the interval spends no call', async () => {
  const { fake, fetchImpl, timers } = await start();
  await fake.configUpdated({ api_key: 'key', refresh_interval: '60' });
  assert.equal(fetchImpl.calls.length, 1);
  const armed = timers.filter((timer) => !timer.cleared);
  assert.equal(armed.length, 1);
  assert.equal(armed[0].delay, 60 * 60000);
});

test('a reconnection publishes the status again without spending a call', async () => {
  const { fake, fetchImpl } = await start();
  const statuses = fake.connectionStatuses.length;
  await fake.connect();
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fake.connectionStatuses.length, statuses + 1);
});

test('quota almost spent: refreshes pause, and readers spend none of the reserve', async () => {
  const { fake, fetchImpl, clock } = await start({
    route: (url) => ({ body: fixtureForUrl(url), headers: quotaHeaders({ remaining: 5 }) }),
  });
  assert.equal(fetchImpl.calls.length, 1);
  assert.match(fake.lastStatus().message.en, /quota spent/);
  clock.now += 2 * 3600 * 1000;
  await fake.weatherGet({ ...HOUSES.okc, units: 'metric' });
  await fake.weatherGet({ ...HOUSES.paris, units: 'metric' }).catch(() => {});
  assert.equal(fetchImpl.calls.length, 1, 'the cache, or a failure: no call');
  // The test button may still spend one: it is what the reserve is for.
  await fake.action('test_connection');
  assert.equal(fetchImpl.calls.length, 2);
});

test('a key changed while disconnected starts clean on reconnection', async () => {
  const { fake, fetchImpl } = await start();
  fake.config.api_key = 'another-key';
  await fake.connect();
  assert.equal(fetchImpl.calls.length, 2);
  assert.ok(fetchImpl.calls[1].includes('/another-key/'));
});

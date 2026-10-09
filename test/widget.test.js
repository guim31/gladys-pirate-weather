import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { parseForecast } from '../src/forecast.js';
import { buildUnavailableContent, buildWidgetContent, formatTime } from '../src/widget.js';
import { HOUSES, OKC_NOW, PARIS_NOW, TROMSO_NOW, loadFixture } from './helpers/fixtures.js';

/**
 * @param {string} name - The fixture.
 * @param {number} now - Its instant.
 * @returns {object} A store entry.
 */
function entry(name, now) {
  return { forecast: parseForecast(loadFixture(name), { fetchedAt: now }), fetchedAt: now };
}

test('the chart content is rendered exactly as sent, in both unit systems and languages', () => {
  for (const units of ['us', 'metric']) {
    for (const language of ['en', 'fr']) {
      const content = buildWidgetContent({
        house: HOUSES.okc,
        entry: entry('synthetic-oklahoma-city-nws-alerts.json', OKC_NOW),
        units,
        language,
        now: OKC_NOW,
      });
      assert.deepEqual(validateWidgetContent(content), [], `${units}/${language}`);
      const chart = content.components.find((component) => component.type === 'chart');
      assert.equal(chart.series[0].points.length, 61);
      assert.equal(chart.unit, units === 'us' ? 'in/h' : 'mm/h');
    }
  }
});

test('US units: the intensity is in inches per hour', () => {
  const content = buildWidgetContent({
    house: HOUSES.okc,
    entry: entry('synthetic-oklahoma-city-nws-alerts.json', OKC_NOW),
    units: 'us',
    language: 'en',
    now: OKC_NOW,
  });
  const points = content.components.find((c) => c.type === 'chart').series[0].points;
  assert.equal(points[0].v, 0);
  assert.equal(points.at(-1).v, 0.492, '12.5 mm/h');
  assert.equal(content.components[0].text, 'Heavy rain expected in 18 minutes (90% chance).');
  const status = content.components.find((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((item) => item.value),
    ['Home', '2:00 PM'],
    'the time of the forecast, in the time zone of the house',
  );
});

test('without a minutely block: a sentence and the status, no chart', () => {
  const content = buildWidgetContent({
    house: HOUSES.tromso,
    entry: entry('synthetic-tromso-no-minutely.json', TROMSO_NOW),
    units: 'metric',
    language: 'fr',
    now: TROMSO_NOW,
  });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.ok(!content.components.some((c) => c.type === 'chart'));
  assert.equal(content.components[0].text, 'Pas de prévision minute par minute pour ce lieu.');
});

test('a dry hour and the unavailable content are valid too', () => {
  const dry = buildWidgetContent({
    house: HOUSES.paris,
    entry: entry('synthetic-paris-wmo-alerts.json', PARIS_NOW),
    units: 'metric',
    language: 'fr',
    now: PARIS_NOW,
  });
  assert.deepEqual(validateWidgetContent(dry), []);
  assert.equal(dry.components[0].text, 'Pas de précipitations prévues dans l’heure.');
  assert.deepEqual(validateWidgetContent(buildUnavailableContent('Forecast unavailable')), []);
});

test('times follow the language and survive an unknown time zone', () => {
  assert.equal(formatTime(OKC_NOW, 'Europe/Paris', 'fr'), '21:00');
  assert.equal(formatTime(OKC_NOW, 'America/Chicago', 'en'), '2:00 PM');
  assert.match(formatTime(OKC_NOW, 'Not/AZone', 'en'), /\d:\d\d/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseForecast } from '../src/forecast.js';
import {
  intensityClass,
  isPrecipitationAnnounced,
  isWet,
  precipitationType,
  readNowcast,
} from '../src/nowcast.js';
import { OKC_NOW, PARIS_NOW, TROMSO_NOW, loadFixture } from './helpers/fixtures.js';

const okc = () => parseForecast(loadFixture('synthetic-oklahoma-city-nws-alerts.json'));

/**
 * @param {Array<number>} intensities - mm/h per minute.
 * @param {object} [extra] - Fields for every minute.
 * @returns {object} A slim forecast with that minutely block.
 */
function minutely(intensities, extra = {}) {
  return {
    minutely: intensities.map((intensity, i) => ({
      time: 1000 + 60 * i,
      precipIntensity: intensity,
      precipProbability: 0.8,
      precipType: 'rain',
      ...extra,
    })),
  };
}

test('rain coming in 18 minutes, heavy at its peak', () => {
  const nowcast = readNowcast(okc(), OKC_NOW / 1000);
  assert.equal(nowcast.available, true);
  assert.equal(nowcast.wetNow, false);
  assert.equal(nowcast.minutesUntil, 18);
  assert.equal(nowcast.type, 'rain');
  assert.equal(nowcast.intensity, 'heavy');
  assert.equal(nowcast.probability, 90);
  assert.equal(nowcast.points.length, 61);
});

test('traces under 0.1 mm/h or a 25% chance are not rain', () => {
  // The Paris fixture has 0.05 mm/h at 25 % for ten minutes.
  const nowcast = readNowcast(
    parseForecast(loadFixture('synthetic-paris-wmo-alerts.json')),
    PARIS_NOW / 1000,
  );
  assert.equal(nowcast.available, true);
  assert.equal(nowcast.minutesUntil, null);
  assert.equal(isWet({ precipIntensity: 1, precipProbability: 0.3 }), false);
  assert.equal(isWet({ precipIntensity: 1, precipProbability: null }), true);
  assert.equal(isWet({ precipIntensity: null, precipProbability: 1 }), false);
});

test('no minutely block, or too few minutes left: not available', () => {
  assert.deepEqual(
    readNowcast(parseForecast(loadFixture('synthetic-tromso-no-minutely.json')), TROMSO_NOW / 1000),
    {
      available: false,
    },
  );
  // The same forecast read 45 minutes later covers 16 minutes only.
  assert.equal(readNowcast(okc(), OKC_NOW / 1000 + 45 * 60).available, false);
});

test('a later read counts the minutes from now', () => {
  const nowcast = readNowcast(okc(), OKC_NOW / 1000 + 10 * 60);
  assert.equal(nowcast.minutesUntil, 8);
  const raining = readNowcast(okc(), OKC_NOW / 1000 + 20 * 60);
  assert.equal(raining.wetNow, true);
  assert.equal(raining.minutesUntil, 0);
});

test('intensity classes and types', () => {
  assert.equal(intensityClass(0.5), 'light');
  assert.equal(intensityClass(2.5), 'moderate');
  assert.equal(intensityClass(7.6), 'heavy');
  assert.equal(precipitationType('rain'), 'rain');
  assert.equal(precipitationType('snow'), 'snow');
  assert.equal(precipitationType('sleet'), 'sleet');
  assert.equal(precipitationType('mixed'), 'sleet');
  assert.equal(precipitationType('ice'), 'freezing_rain');
  assert.equal(precipitationType(null), 'rain');
  const snow = readNowcast(minutely(Array(61).fill(1.2), { precipType: 'snow' }), 1000);
  assert.equal(snow.type, 'snow');
  assert.equal(snow.durationMinutes, 61);
});

test('the trigger fires on the dry → wet transition only, never on a baseline', () => {
  const dry = readNowcast(minutely(Array(61).fill(0)), 1000);
  const wet = readNowcast(minutely([...Array(20).fill(0), ...Array(41).fill(3)]), 1000);
  const unavailable = { available: false };
  assert.equal(isPrecipitationAnnounced(null, wet), false, 'first forecast is a baseline');
  assert.equal(isPrecipitationAnnounced(unavailable, wet), false);
  assert.equal(isPrecipitationAnnounced(dry, wet), true);
  assert.equal(isPrecipitationAnnounced(wet, wet), false, 'already announced');
  assert.equal(isPrecipitationAnnounced(wet, dry), false);
  assert.equal(isPrecipitationAnnounced(dry, unavailable), false);
});

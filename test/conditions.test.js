import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEATHER_CONDITIONS } from '@gladysassistant/integration-sdk';
import { ICON_CONDITIONS, isDay, solarElevation, toCondition } from '../src/conditions.js';
import { HOUSES } from './helpers/fixtures.js';

const CONDITIONS = Object.values(WEATHER_CONDITIONS);

test('every mapped icon gives a Gladys condition, never the deprecated "night"', () => {
  for (const [icon, condition] of Object.entries(ICON_CONDITIONS)) {
    assert.ok(CONDITIONS.includes(condition), `${icon} → ${condition}`);
    assert.notEqual(condition, WEATHER_CONDITIONS.NIGHT, icon);
  }
});

test('the documented Pirate Weather icons are all handled', () => {
  // docs/API/data-blocks.md: the default set and the `icon=pirate` set.
  const documented = [
    'clear-day',
    'clear-night',
    'thunderstorm',
    'rain',
    'snow',
    'sleet',
    'wind',
    'fog',
    'cloudy',
    'partly-cloudy-day',
    'partly-cloudy-night',
    'hail',
    'mostly-clear-day',
    'mostly-clear-night',
    'mostly-cloudy-day',
    'mostly-cloudy-night',
    'precipitation',
    'drizzle',
    'light-rain',
    'heavy-rain',
    'flurries',
    'light-snow',
    'heavy-snow',
    'very-light-sleet',
    'light-sleet',
    'heavy-sleet',
    'dangerous-wind',
    'mist',
    'haze',
    'smoke',
    'mixed',
  ];
  for (const icon of documented) {
    assert.ok(Object.hasOwn(ICON_CONDITIONS, icon), icon);
  }
});

test('icon examples', () => {
  const cases = [
    [{ icon: 'clear-night' }, 'clear'],
    [{ icon: 'partly-cloudy-day' }, 'partly-cloudy'],
    [{ icon: 'cloudy' }, 'cloud'],
    [{ icon: 'drizzle' }, 'drizzle'],
    [{ icon: 'heavy-rain' }, 'pouring'],
    [{ icon: 'light-snow' }, 'snow'],
    [{ icon: 'mixed' }, 'sleet'],
    [{ icon: 'hail' }, 'hail'],
    [{ icon: 'dangerous-wind' }, 'wind'],
    [{ icon: 'haze', temperature: 20 }, 'fog'],
  ];
  for (const [point, expected] of cases) {
    assert.equal(toCondition(point), expected, point.icon);
  }
});

test('the data refines what the icon cannot say', () => {
  assert.equal(toCondition({ icon: 'rain', precipType: 'ice' }), 'freezing-rain');
  assert.equal(toCondition({ icon: 'light-rain', precipType: 'ice' }), 'freezing-rain');
  assert.equal(toCondition({ icon: 'thunderstorm', precipType: 'snow' }), 'snow-thunderstorm');
  assert.equal(toCondition({ icon: 'fog', temperature: -3 }), 'freezing-fog');
  assert.equal(toCondition({ icon: 'fog', temperature: 2 }), 'fog');
  // A day: freezing fog only when even the warmest hour freezes.
  assert.equal(toCondition({ icon: 'fog', temperatureMax: -1 }), 'freezing-fog');
});

test('low-chance and unknown icons follow the cloud cover', () => {
  assert.equal(toCondition({ icon: 'possible-rain-day', cloudCover: 0.5 }), 'partly-cloudy');
  assert.equal(toCondition({ icon: 'possible-thunderstorm-night', cloudCover: 0.9 }), 'cloud');
  assert.equal(toCondition({ icon: 'breezy', cloudCover: 0.1 }), 'clear');
  assert.equal(toCondition({ icon: 'none', cloudCover: 0.95 }), 'cloud');
  assert.equal(toCondition({ icon: 'a-future-icon', cloudCover: 0.2 }), 'clear');
  assert.equal(toCondition({ icon: 'toString', cloudCover: 0.2 }), 'clear');
  assert.equal(toCondition({ icon: null }), 'unknown');
});

test('is_day comes from the sun times of the matching day', () => {
  const forecast = {
    latitude: 0,
    longitude: 0,
    daily: [{ time: 1000, sunriseTime: 1000 + 6 * 3600, sunsetTime: 1000 + 20 * 3600 }],
  };
  assert.equal(isDay(1000 + 5 * 3600, forecast, 'clear-day'), false, 'sun times beat the icon');
  assert.equal(isDay(1000 + 12 * 3600, forecast), true);
  assert.equal(isDay(1000 + 20 * 3600, forecast), false);
});

test('is_day falls back on the icon, then on the position of the sun', () => {
  const noDays = { latitude: null, longitude: null, daily: [] };
  assert.equal(isDay(0, noDays, 'partly-cloudy-night'), false);
  assert.equal(isDay(0, noDays, 'clear-day'), true);
  assert.equal(isDay(0, noDays, 'cloudy'), null);
  // Polar night: noon in Tromsø on Dec 15 is still night.
  const tromso = { ...HOUSES.tromso, daily: [] };
  assert.equal(isDay(1797332400, tromso, 'fog'), false);
  // Midnight sun: 1 AM in Tromsø on June 21 is day.
  assert.equal(isDay(Date.UTC(2026, 5, 20, 23) / 1000, tromso, 'cloudy'), true);
});

test('solar elevation is right to within a degree or so', () => {
  // Solar noon at the equator on the March equinox: sun nearly overhead.
  assert.ok(solarElevation(Date.UTC(2026, 2, 20, 12, 7) / 1000, 0, 0) > 88);
  // Midnight there: well below.
  assert.ok(solarElevation(Date.UTC(2026, 2, 20, 0, 7) / 1000, 0, 0) < -80);
  // Oklahoma City, June 15, 2 PM CDT: about 76°.
  assert.ok(Math.abs(solarElevation(1781550000, 35.4676, -97.5164) - 76) < 1.5);
});

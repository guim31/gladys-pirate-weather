// The pivot payload checked against the rules of the core's normalizeWeather
// (GladysAssistant/Gladys server/lib/external-integration): what this module
// sends must come out of it unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEATHER_CONDITIONS } from '@gladysassistant/integration-sdk';
import { parseForecast } from '../src/forecast.js';
import { buildWeather } from '../src/pivot.js';
import {
  OKC_NOW,
  ONTARIO_NOW,
  PARIS_NOW,
  SF_NOW,
  TROMSO_NOW,
  loadFixture,
} from './helpers/fixtures.js';

const CURRENT = [
  'temperature',
  'weather',
  'datetime',
  'apparent_temperature',
  'humidity',
  'pressure',
  'dew_point',
  'wind_speed',
  'wind_direction',
  'wind_gust',
  'visibility',
  'cloud_cover',
  'uv_index',
  'sunrise',
  'sunset',
  'is_day',
  'hours',
  'days',
  'alerts',
];
const HOUR = [
  'temperature',
  'weather',
  'datetime',
  'apparent_temperature',
  'humidity',
  'pressure',
  'wind_speed',
  'wind_direction',
  'wind_gust',
  'cloud_cover',
  'precipitation',
  'precipitation_probability',
  'uv_index',
  'is_day',
];
const DAY = [
  'temperature_min',
  'temperature_max',
  'datetime',
  'weather',
  'humidity',
  'wind_speed',
  'wind_direction',
  'wind_gust',
  'precipitation',
  'precipitation_probability',
  'uv_index',
  'sunrise',
  'sunset',
];
const PERCENTS = ['humidity', 'cloud_cover', 'precipitation_probability'];
const CONDITIONS = Object.values(WEATHER_CONDITIONS);

const FIXTURES = [
  ['synthetic-oklahoma-city-nws-alerts.json', OKC_NOW],
  ['synthetic-paris-wmo-alerts.json', PARIS_NOW],
  ['synthetic-tromso-no-minutely.json', TROMSO_NOW],
  ['real-san-francisco-us-units.json', SF_NOW],
  ['real-ontario-ca-units-alert.json', ONTARIO_NOW],
];

/**
 * @param {object} entry - A pivot entry.
 * @param {Array<string>} allowed - The whitelist.
 * @param {string} where - For the messages.
 */
function checkEntry(entry, allowed, where) {
  for (const [key, value] of Object.entries(entry)) {
    assert.ok(allowed.includes(key), `${where}: "${key}" is not a pivot field`);
    assert.notEqual(value, null, `${where}: "${key}" is null (leave it out)`);
    if (typeof value === 'number') {
      assert.ok(Number.isFinite(value), `${where}: "${key}" is not finite`);
    }
    if (PERCENTS.includes(key)) {
      assert.ok(value >= 0 && value <= 100, `${where}: "${key}" = ${value} is not 0-100`);
    }
    if (['datetime', 'sunrise', 'sunset'].includes(key)) {
      assert.ok(!Number.isNaN(new Date(value).getTime()), `${where}: "${key}" is not a date`);
    }
    if (key === 'weather') {
      assert.ok(CONDITIONS.includes(value), `${where}: condition "${value}"`);
      assert.notEqual(value, 'night', `${where}: "night" is deprecated for providers`);
    }
    if (key === 'is_day') {
      assert.equal(typeof value, 'boolean');
    }
  }
}

for (const [name, now] of FIXTURES) {
  for (const units of ['metric', 'us']) {
    test(`${name} (${units}) builds a payload the core keeps whole`, () => {
      const weather = buildWeather(parseForecast(loadFixture(name), { fetchedAt: now }), {
        units,
        now,
      });
      assert.equal(typeof weather.temperature, 'number');
      assert.equal(typeof weather.weather, 'string');
      assert.equal(typeof weather.datetime, 'string');
      checkEntry(weather, CURRENT, 'current');
      assert.ok(weather.hours.length >= 1 && weather.hours.length <= 24);
      assert.ok(weather.days.length >= 1 && weather.days.length <= 8);
      weather.hours.forEach((hour, i) => {
        assert.ok(hour.temperature !== undefined && hour.datetime && hour.weather);
        checkEntry(hour, HOUR, `hours[${i}]`);
      });
      weather.days.forEach((day, i) => {
        assert.ok(day.temperature_min !== undefined && day.temperature_max !== undefined);
        assert.ok(day.temperature_min <= day.temperature_max);
        checkEntry(day, DAY, `days[${i}]`);
      });
      assert.ok((weather.alerts ?? []).length <= 10);
    });
  }
}

test('Oklahoma City in US units, as an American user sees it', () => {
  const forecast = parseForecast(loadFixture('synthetic-oklahoma-city-nws-alerts.json'));
  const weather = buildWeather(forecast, { units: 'us', now: OKC_NOW });
  assert.equal(weather.temperature, 91.8); // 33.2 °C
  assert.equal(weather.apparent_temperature, 102); // 38.9 °C
  assert.equal(weather.wind_speed, 14.1); // 6.3 m/s
  assert.equal(weather.visibility, 10); // 16.09 km
  assert.equal(weather.pressure, 1008); // hPa in both systems
  assert.equal(weather.humidity, 53);
  assert.equal(weather.is_day, true);
  assert.equal(weather.hours.length, 24);
  assert.equal(weather.hours[1].weather, 'thunderstorm');
  assert.equal(weather.hours[1].precipitation, 0.36); // 9.1 mm
  assert.equal(weather.hours[2].weather, 'pouring');
  assert.equal(weather.days[0].precipitation, 0.39); // 10 mm
  assert.deepEqual(
    weather.alerts.map((alert) => [alert.event, alert.severity, alert.type]),
    [
      ['Tornado Warning', 'extreme', 'thunderstorm'],
      ['Severe Thunderstorm Watch', 'severe', 'thunderstorm'],
      ['Flash Flood Warning', 'severe', 'flood'],
      ['Heat Advisory', 'moderate', 'heat'],
      ['Special Weather Statement', 'minor', undefined],
    ],
  );
});

test('Paris in metric units, with its sunset and WMO alerts', () => {
  const forecast = parseForecast(loadFixture('synthetic-paris-wmo-alerts.json'));
  const weather = buildWeather(forecast, { units: 'metric', now: PARIS_NOW });
  assert.equal(weather.temperature, 21.6);
  assert.equal(weather.is_day, true, '9 PM, the sun sets at 9:56 PM');
  // The hour starting at 10 PM local (20:00Z) is after sunset.
  assert.equal(weather.hours[1].is_day, false);
  assert.equal(weather.hours[3].weather, 'drizzle');
  assert.equal(weather.hours[3].precipitation, 0.3);
  assert.equal(weather.sunset, '2026-06-15T19:56:00.000Z');
  assert.deepEqual(
    weather.alerts.map((alert) => [alert.type, alert.severity, alert.start, alert.end]),
    [
      ['thunderstorm', 'moderate', undefined, '2026-06-16T05:00:00.000Z'],
      ['rain', 'moderate', '2026-06-15T18:00:00.000Z', undefined],
    ],
  );
});

test('a polar night without sunrise: night from the position of the sun, freezing fog', () => {
  const forecast = parseForecast(loadFixture('synthetic-tromso-no-minutely.json'));
  const weather = buildWeather(forecast, { units: 'metric', now: TROMSO_NOW });
  assert.equal(weather.weather, 'freezing-fog');
  assert.equal(weather.is_day, false);
  assert.equal(weather.sunrise, undefined);
  assert.equal(weather.days[0].weather, 'snow');
  assert.equal(weather.days[0].precipitation, 4.2, '4.2 cm of snow ≈ 4.2 mm of water');
  assert.equal(weather.alerts, undefined, 'no alerts: no empty array');
});

test('a forecast served from the cache drops the hours and days already past', () => {
  const forecast = parseForecast(loadFixture('synthetic-oklahoma-city-nws-alerts.json'));
  const later = OKC_NOW + 2.5 * 3600 * 1000;
  const weather = buildWeather(forecast, { units: 'metric', now: later });
  assert.equal(weather.hours[0].datetime, '2026-06-15T21:00:00.000Z');
  // The tornado warning expired at 19:45Z.
  assert.ok(!weather.alerts.some((alert) => alert.event === 'Tornado Warning'));
  // June 22, 2 AM in Oklahoma City: only the last day of the forecast is left.
  const nextWeek = buildWeather(forecast, { units: 'metric', now: OKC_NOW + 6.5 * 86400 * 1000 });
  assert.equal(nextWeek.days.length, 1);
  assert.equal(nextWeek.days[0].datetime, '2026-06-22T05:00:00.000Z');
});

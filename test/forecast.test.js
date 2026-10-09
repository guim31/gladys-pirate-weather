import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseForecast } from '../src/forecast.js';
import { loadFixture } from './helpers/fixtures.js';

test('a full SI response keeps every block, in SI', () => {
  const forecast = parseForecast(loadFixture('synthetic-oklahoma-city-nws-alerts.json'), {
    fetchedAt: 42,
  });
  assert.equal(forecast.fetchedAt, 42);
  assert.equal(forecast.timezone, 'America/Chicago');
  assert.equal(forecast.nearestCity, 'Oklahoma City');
  assert.equal(forecast.sourceUnits, 'si');
  assert.equal(forecast.currently.temperature, 33.2);
  assert.equal(forecast.currently.precipType, null, '"none" is no precipitation');
  assert.equal(forecast.minutely.length, 61);
  assert.equal(forecast.hourly.length, 48);
  assert.equal(forecast.daily.length, 8);
  assert.equal(forecast.alerts.length, 6, 'deduplication happens in alerts.js');
});

test('-999 values are missing values, never numbers', () => {
  const raw = loadFixture('synthetic-paris-wmo-alerts.json');
  raw.currently.windGust = -999;
  const forecast = parseForecast(raw);
  assert.equal(forecast.currently.windGust, null);
  const orages = forecast.alerts.find((alert) => alert.title === 'Vigilance jaune orages');
  assert.equal(orages.time, null, 'an alert without onset has time -999');
  const pluie = forecast.alerts.find((alert) => alert.title.includes('pluie'));
  assert.equal(pluie.expires, null, 'an alert without expiry has expires -999');
  const tromso = parseForecast(loadFixture('synthetic-tromso-no-minutely.json'));
  assert.equal(tromso.daily[0].sunriseTime, null);
});

test('a response without a minutely block has minutely null, not an empty hour', () => {
  const forecast = parseForecast(loadFixture('synthetic-tromso-no-minutely.json'));
  assert.equal(forecast.minutely, null);
  assert.equal(forecast.hourly.length, 48);
});

test('a response in US units (the real San Francisco one) is converted to SI', () => {
  const forecast = parseForecast(loadFixture('real-san-francisco-us-units.json'));
  assert.equal(forecast.sourceUnits, 'us');
  // 62.64 °F, 13.39 mph, 10 mi
  assert.ok(Math.abs(forecast.currently.temperature - 17.022) < 0.01);
  assert.ok(Math.abs(forecast.currently.windSpeed - 5.986) < 0.01);
  assert.ok(Math.abs(forecast.currently.visibility - 16.093) < 0.01);
  assert.equal(forecast.currently.humidity, 0.85, 'fractions are not units');
});

test('a response in CA units (the real Ontario one) is converted to SI', () => {
  const forecast = parseForecast(loadFixture('real-ontario-ca-units-alert.json'));
  assert.equal(forecast.sourceUnits, 'ca');
  assert.ok(Math.abs(forecast.currently.windSpeed - 17.73 / 3.6) < 1e-9);
  assert.equal(forecast.currently.temperature, -0.88);
  assert.equal(forecast.alerts[0].title, 'avertissement de neige en vigueur');
});

test('precipitation amounts are liquid water: snow depth is not added to rain', () => {
  const raw = loadFixture('synthetic-oklahoma-city-nws-alerts.json');
  const hour = raw.hourly.data[0];
  Object.assign(hour, {
    precipAccumulation: 5.5, // 5 mm of rain + 5 cm of snow, the documented trap
    liquidAccumulation: 0.5,
    snowAccumulation: 5,
    iceAccumulation: 0,
  });
  const forecast = parseForecast(raw);
  assert.equal(forecast.hourly[0].precipAmount, 10, '5 mm of rain + 5 mm of water as snow');
  // Version 1 fields only: mean liquid intensity × duration.
  delete hour.liquidAccumulation;
  delete hour.snowAccumulation;
  delete hour.iceAccumulation;
  hour.precipIntensity = 2.5;
  assert.equal(parseForecast(raw).hourly[0].precipAmount, 2.5);
});

test('a body without current conditions is refused', () => {
  assert.throws(() => parseForecast({}), /current conditions/);
  assert.throws(() => parseForecast({ currently: { time: 1 } }), /current conditions/);
  assert.throws(() => parseForecast(null), /not an object/);
  assert.throws(() => parseForecast([]), /not an object/);
});

test('malformed points are skipped, not fatal', () => {
  const raw = loadFixture('synthetic-paris-wmo-alerts.json');
  raw.hourly.data.splice(1, 0, null, { time: 'x' }, { time: 1, temperature: null });
  raw.daily.data.push({ time: 5 });
  raw.alerts.push(null, { severity: 'Severe' });
  const forecast = parseForecast(raw);
  assert.equal(forecast.hourly.length, 48);
  assert.equal(forecast.daily.length, 8);
  assert.equal(forecast.alerts.length, 2);
});

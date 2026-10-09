import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromSI, intensityUnit, round, toSIConverters } from '../src/units.js';

test('SI to metric keeps the values, rounded', () => {
  const metric = fromSI('metric');
  assert.equal(metric.temperature(21.649), 21.6);
  assert.equal(metric.speed(3.14159), 3.1);
  assert.equal(metric.pressure(1015.6), 1016);
  assert.equal(metric.precipitation(12.345), 12.3);
  assert.equal(metric.visibility(16.09), 16.1);
});

test('SI to US: °F, mph, inches, miles — and hPa stays hPa', () => {
  const us = fromSI('us');
  assert.equal(us.temperature(0), 32);
  assert.equal(us.temperature(100), 212);
  assert.equal(us.temperature(-40), -40);
  assert.equal(us.speed(4.4704), 10);
  assert.equal(us.precipitation(25.4), 1);
  assert.equal(us.intensity(2.54), 0.1);
  assert.equal(us.visibility(16.09344), 10);
  assert.equal(us.pressure(1013.25), 1013);
});

test('null and non-finite values stay null', () => {
  for (const units of ['metric', 'us']) {
    const convert = fromSI(units);
    for (const fn of Object.values(convert)) {
      assert.equal(fn(null), null);
      assert.equal(fn(undefined), null);
      assert.equal(fn(NaN), null);
    }
  }
});

test('no "-0" reaches Gladys', () => {
  assert.ok(Object.is(round(-0.04, 1), 0));
  assert.ok(Object.is(fromSI('metric').temperature(-0.01), 0));
});

test('the other Pirate Weather unit systems convert back to SI', () => {
  const us = toSIConverters('us');
  assert.equal(us.temperature(212), 100);
  assert.ok(Math.abs(us.speed(10) - 4.4704) < 1e-9);
  assert.ok(Math.abs(us.distance(10) - 16.09344) < 1e-9);
  assert.ok(Math.abs(us.intensity(1) - 25.4) < 1e-9);
  assert.ok(Math.abs(us.accumulation(1) - 2.54) < 1e-9); // inches → cm
  assert.ok(Math.abs(toSIConverters('ca').speed(36) - 10) < 1e-9); // km/h → m/s
  assert.ok(Math.abs(toSIConverters('uk').distance(10) - 16.09344) < 1e-9);
  assert.equal(toSIConverters('uk').temperature(20), 20);
  assert.equal(toSIConverters('si').speed(5), 5);
});

test('intensity unit follows the unit system', () => {
  assert.equal(intensityUnit('us'), 'in/h');
  assert.equal(intensityUnit('metric'), 'mm/h');
});

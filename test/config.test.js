import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, manualIntervalMinutes, normalizeConfig } from '../src/config.js';

test('normalizeConfig returns the defaults when called with nothing', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
});

test('the API key is trimmed (a paste often brings a space or a newline)', () => {
  assert.equal(normalizeConfig({ api_key: '  abc123\n' }).api_key, 'abc123');
  assert.equal(normalizeConfig({ api_key: 42 }).api_key, '');
});

test('the select values are kept when valid, defaulted otherwise', () => {
  const config = normalizeConfig({ refresh_interval: '30', language: 'fr' });
  assert.equal(config.refresh_interval, '30');
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ refresh_interval: 30 }).refresh_interval, '30');
  assert.equal(normalizeConfig({ refresh_interval: '5' }).refresh_interval, 'auto');
  assert.equal(normalizeConfig({ language: 'de' }).language, 'auto');
});

test('manualIntervalMinutes: null for automatic, minutes otherwise', () => {
  assert.equal(manualIntervalMinutes(normalizeConfig()), null);
  assert.equal(manualIntervalMinutes(normalizeConfig({ refresh_interval: '120' })), 120);
});

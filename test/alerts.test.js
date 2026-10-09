import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEATHER_ALERT_SEVERITIES, WEATHER_ALERT_TYPES } from '@gladysassistant/integration-sdk';
import {
  MAX_ALERTS,
  alertSeverity,
  alertType,
  alertsFingerprint,
  buildAlerts,
} from '../src/alerts.js';

const TYPES = Object.values(WEATHER_ALERT_TYPES);
const SEVERITIES = Object.values(WEATHER_ALERT_SEVERITIES);

test('NWS events are classified', () => {
  const cases = {
    'Tornado Warning': 'thunderstorm',
    'Tornado Watch': 'thunderstorm',
    'Severe Thunderstorm Warning': 'thunderstorm',
    'Flash Flood Warning': 'flood',
    'Flood Watch': 'flood',
    'Coastal Flood Advisory': 'coastal',
    'Storm Surge Warning': 'coastal',
    'High Surf Advisory': 'coastal',
    'Rip Current Statement': 'coastal',
    'Tsunami Warning': 'coastal',
    'Hurricane Warning': 'wind',
    'Tropical Storm Watch': 'wind',
    'High Wind Warning': 'wind',
    'Wind Advisory': 'wind',
    'Dust Storm Warning': 'wind',
    'Gale Warning': 'wind',
    'Excessive Heat Warning': 'heat',
    'Extreme Heat Warning': 'heat',
    'Heat Advisory': 'heat',
    'Winter Storm Warning': 'snow',
    'Blizzard Warning': 'snow',
    'Ice Storm Warning': 'snow',
    'Lake Effect Snow Warning': 'snow',
    'Winter Weather Advisory': 'snow',
    'Freezing Rain Advisory': 'snow',
    'Wind Chill Warning': 'cold',
    'Extreme Cold Warning': 'cold',
    'Cold Weather Advisory': 'cold',
    'Freeze Warning': 'cold',
    'Hard Freeze Warning': 'cold',
    'Frost Advisory': 'cold',
    'Dense Fog Advisory': 'fog',
    'Freezing Fog Advisory': 'fog',
    'Avalanche Warning': 'avalanche',
  };
  for (const [event, type] of Object.entries(cases)) {
    assert.equal(alertType(event), type, event);
  }
});

test('alerts with no phenomenon of the Gladys list get no type', () => {
  for (const event of [
    'Red Flag Warning',
    'Fire Weather Watch',
    'Air Quality Alert',
    'Special Weather Statement',
    'Small Craft Advisory',
    'Hazardous Weather Outlook',
  ]) {
    assert.equal(alertType(event), null, event);
  }
});

test('WMO alerts in French, German and Spanish are classified', () => {
  const cases = {
    'avertissement de neige en vigueur': 'snow', // Environment Canada, real fixture
    'Avertissement de pluie verglaçante': 'snow',
    'Avertissement de chaleur': 'heat',
    'Avertissement de froid extrême': 'cold',
    'Veille d’orages violents': 'thunderstorm',
    'Avertissement de vents': 'wind',
    'Vigilance jaune orages': 'thunderstorm',
    'Vigilance orange pluie-inondation': 'rain',
    'Vigilance rouge inondation': 'flood',
    'Vigilance jaune vagues-submersion': 'coastal',
    'Vigilance jaune canicule': 'heat',
    'Vigilance jaune grand-froid': 'cold',
    'Vigilance orange neige-verglas': 'snow',
    'Vigilance jaune vent violent': 'wind',
    'Vigilance jaune avalanches': 'avalanche',
    'Amtliche WARNUNG vor STURMBÖEN': 'wind',
    'Amtliche WARNUNG vor DAUERREGEN': 'rain',
    'Amtliche UNWETTERWARNUNG vor STARKREGEN': 'rain',
    'Amtliche WARNUNG vor GLÄTTE': 'snow',
    'Amtliche WARNUNG vor FROST': 'cold',
    'Amtliche WARNUNG vor HITZE': 'heat',
    'Amtliche WARNUNG vor NEBEL': 'fog',
    'Amtliche WARNUNG vor GEWITTER': 'thunderstorm',
    'Aviso amarillo por tormentas': 'thunderstorm',
    'Aviso naranja por lluvias': 'rain',
    'Aviso amarillo por fenómenos costeros': 'coastal',
    'Aviso rojo por temperaturas máximas': 'heat',
  };
  for (const [event, type] of Object.entries(cases)) {
    assert.equal(alertType(event), type, event);
  }
});

test('a word inside another word does not match', () => {
  // "event" holds "vent", "gelb" starts like "gel", "prevention" too.
  assert.equal(alertType('Special event notice'), null);
  assert.equal(alertType('Gelbe Warnstufe'), null);
  assert.equal(alertType('Fire prevention bulletin'), null);
});

test('the CAP severity maps one to one, the NWS significance too', () => {
  assert.equal(alertSeverity('Extreme', 'x'), 'extreme');
  assert.equal(alertSeverity('Severe', 'x'), 'severe');
  assert.equal(alertSeverity('moderate', 'x'), 'moderate');
  assert.equal(alertSeverity(' Minor ', 'x'), 'minor');
  assert.equal(alertSeverity('W', 'x'), 'severe');
  assert.equal(alertSeverity('A', 'x'), 'moderate');
  assert.equal(alertSeverity('Y', 'x'), 'minor');
  assert.equal(alertSeverity('S', 'x'), 'minor');
});

test('an unknown severity is read from the title', () => {
  assert.equal(alertSeverity('Unknown', 'Tornado Warning'), 'severe');
  assert.equal(alertSeverity('Unknown', 'Flood Watch'), 'moderate');
  assert.equal(alertSeverity(null, 'Wind Advisory'), 'minor');
  assert.equal(alertSeverity('Unknown', 'Special Weather Statement'), 'minor');
  assert.equal(alertSeverity('Unknown', 'Vigilance jaune pluie-inondation'), 'moderate');
  assert.equal(alertSeverity('Unknown', 'Vigilance orange orages'), 'severe');
  assert.equal(alertSeverity('Unknown', 'Vigilance rouge crues'), 'extreme');
  assert.equal(alertSeverity('Unknown', 'Red Flag Warning'), 'severe', 'not a red level');
  assert.equal(alertSeverity('Unknown', 'Something else'), 'moderate');
  assert.equal(alertSeverity('toString', 'Something else'), 'moderate');
});

/**
 * @param {object} fields - Overrides.
 * @returns {object} A slim alert.
 */
function alert(fields) {
  return {
    title: 'Heat Advisory',
    severity: 'Moderate',
    time: 1000,
    expires: 9000,
    description: 'Hot.',
    regions: [],
    uri: null,
    ...fields,
  };
}

test('alerts are deduplicated, sorted by severity, and expired ones dropped', () => {
  const built = buildAlerts(
    [
      alert({ title: 'Heat Advisory' }),
      alert({ title: 'Tornado Warning', severity: 'Extreme', time: 2000 }),
      alert({ title: 'Tornado Warning', severity: 'Extreme', time: 2000 }),
      alert({ title: 'Flood Watch', severity: 'Severe', time: 1500 }),
      alert({ title: 'Wind Advisory', severity: 'Minor', expires: 4000 }),
    ],
    5000,
  );
  assert.deepEqual(
    built.map((a) => [a.event, a.severity, a.type]),
    [
      ['Tornado Warning', 'extreme', 'thunderstorm'],
      ['Flood Watch', 'severe', 'flood'],
      ['Heat Advisory', 'moderate', 'heat'],
    ],
  );
  assert.equal(built[0].start, new Date(2000 * 1000).toISOString());
  assert.equal(built[0].end, new Date(9000 * 1000).toISOString());
});

test('at most 10 alerts, the most severe kept', () => {
  const many = Array.from({ length: 14 }, (_, i) =>
    alert({ title: `Advisory ${i}`, severity: 'Minor', time: 1000 + i }),
  );
  many.push(alert({ title: 'Tornado Warning', severity: 'Extreme', time: 5000 }));
  const built = buildAlerts(many, 0);
  assert.equal(built.length, MAX_ALERTS);
  assert.equal(built[0].event, 'Tornado Warning');
});

test('alerts fit the core bounds: event ≤ 100, description ≤ 5000, enums', () => {
  const built = buildAlerts(
    [
      alert({ title: `Avertissement ${'x'.repeat(200)}`, description: 'y'.repeat(9000) }),
      alert({ title: 'No dates', time: null, expires: null, description: null }),
    ],
    0,
  );
  for (const pivot of built) {
    assert.ok(pivot.event.length <= 100);
    assert.ok(SEVERITIES.includes(pivot.severity));
    if (pivot.type !== undefined) {
      assert.ok(TYPES.includes(pivot.type));
    }
    if (pivot.description !== undefined) {
      assert.ok(pivot.description.length <= 5000);
    }
  }
  const long = built.find((pivot) => pivot.event.startsWith('Avertissement'));
  assert.ok(long.event.endsWith('…'));
  const bare = built.find((pivot) => pivot.event === 'No dates');
  assert.equal(bare.start, undefined);
  assert.equal(bare.end, undefined);
  assert.equal(bare.description, undefined);
});

test('the fingerprint changes with the alerts, not with their order', () => {
  const a = buildAlerts([alert({ title: 'Heat Advisory' }), alert({ title: 'Flood Watch' })], 0);
  const b = buildAlerts([alert({ title: 'Flood Watch' }), alert({ title: 'Heat Advisory' })], 0);
  assert.equal(alertsFingerprint(a), alertsFingerprint(b));
  const c = buildAlerts([alert({ title: 'Heat Advisory', severity: 'Severe' })], 0);
  assert.notEqual(alertsFingerprint(a), alertsFingerprint(c));
  assert.equal(alertsFingerprint([]), '');
});

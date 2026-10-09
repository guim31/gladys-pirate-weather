// -----------------------------------------------------------------------------
// Record a REAL Pirate Weather response as a test fixture.
//
//   PIRATE_WEATHER_API_KEY=... node scripts/capture-fixture.mjs <lat> <lon> <name>
//
// Calls the API exactly like the integration does (same URL, same parameters:
// units=si, version=2, icon=pirate) and writes the body to
// test/fixtures/real-<name>.json. The key travels in the URL only: the body
// written to disk never contains it, and nothing here prints it. The quota
// headers are printed, not saved.
//
// One call per run: it counts against your monthly quota like any other.
// -----------------------------------------------------------------------------

import { writeFile } from 'node:fs/promises';
import { fetchForecast } from '../src/api.js';

const [latitude, longitude, name] = process.argv.slice(2);
const apiKey = process.env.PIRATE_WEATHER_API_KEY ?? '';

if (!latitude || !longitude || !/^[a-z0-9-]+$/.test(name ?? '') || apiKey === '') {
  console.error(
    'Usage: PIRATE_WEATHER_API_KEY=... node scripts/capture-fixture.mjs <lat> <lon> <name>\n' +
      '  <name>: lower-case letters, digits and dashes, e.g. miami-hurricane',
  );
  process.exit(1);
}

const { data, usage } = await fetchForecast({
  apiKey,
  latitude: Number(latitude),
  longitude: Number(longitude),
});
const file = new URL(`../test/fixtures/real-${name}.json`, import.meta.url);
await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);

console.log(`Written ${file.pathname}`);
console.log(`  currently.time: ${data.currently?.time} (the "now" of the tests)`);
console.log(`  minutely points: ${data.minutely?.data?.length ?? 'no minutely block'}`);
console.log(`  alerts: ${(data.alerts ?? []).map((alert) => alert.title).join(' | ') || 'none'}`);
console.log(`  flags.units: ${data.flags?.units}, version: ${data.flags?.version}`);
if (usage) {
  console.log(`  quota: ${usage.remaining} of ${usage.limit} calls left`);
}

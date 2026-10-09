# Pirate Weather for Gladys Assistant

Weather provider for [Gladys Assistant](https://gladysassistant.com) backed by
[Pirate Weather](https://pirateweather.net/), the open, worldwide successor of
the Dark Sky API — free up to 10,000 calls a month.

**Powered by Pirate Weather.** This integration is a community project and is
**not affiliated with Pirate Weather**.

## What it does

- **Feeds the Gladys weather widget and chat assistant** (manifest
  `type: "weather"`): current conditions, the next 24 hours, the next 8 days,
  sunrise, sunset, UV index, in °F/mph or °C/m/s after each user's unit
  system.
- **Official weather alerts** — US National Weather Service warnings, watches
  and advisories (tornado, severe thunderstorm, flash flood, hurricane, heat,
  winter storm…), Environment Canada and the European services through the WMO
  register — converted to the Gladys alert model (CAP severity, phenomenon
  type), so the built-in **Weather alert** scene trigger works with them. When
  the alerts of a house change, the integration nudges Gladys to re-read the
  weather at once.
- **Scene trigger "Rain or snow expected within the hour"**, from the
  minute-by-minute forecast.
- **Scene action "Get the precipitation of the next hour"**.
- **Dashboard widget "Precipitation, next hour"**: the minute-by-minute chart.

User documentation: [English](docs/en.md) · [Français](docs/fr.md).

## Get a free API key

1. Sign up on [pirateweather.net](https://pirateweather.net/).
2. Subscribe to the **forecast API** with the free plan (10,000 calls a month;
   20,000 for a $2/month supporter).
3. Copy the key. A new key can take up to 20 minutes to work.

## Install

1. In Gladys (5.1 or later), give your house a location: **Settings →
   Houses**.
2. Install **Pirate Weather** from the integration catalog and allow access to
   the house location.
3. Paste the API key in the **Configuration** tab, save, and click **Test the
   API key**.

## Quota and refresh cadence

One refresh is **one call per house**, and that one response serves
everything (dashboard, chat, alerts, trigger, action, widget). Weather requests
from Gladys are answered from memory: opening a dashboard costs nothing.

A timer in the container refreshes every house with a location. In automatic
mode it keeps the refreshes under **half of the monthly quota**, never more
often than every 15 minutes (Pirate Weather's recommendation):

| Houses | Free plan (10,000)      | Supporter plan (20,000) |
| ------ | ----------------------- | ----------------------- |
| 1      | every 15 min — 2,976/mo | every 15 min — 2,976/mo |
| 2      | every 20 min — 4,464/mo | every 15 min — 5,952/mo |
| 3      | every 30 min — 4,464/mo | every 15 min — 8,928/mo |
| 4      | every 45 min — 3,968/mo | every 20 min — 8,928/mo |

(31-day month.) Every Pirate Weather response carries `Ratelimit-Limit`,
`Ratelimit-Remaining` and `Ratelimit-Reset`: the integration reads them, uses
the real limit of the key, stretches the interval when the calls left cannot
carry it until the reset (a key shared with another app), pauses the
refreshes below a 20-call reserve, and stops calling after a `429` until the
reset. A refused key (`401`/`403`) stops the calls until the key changes or the
test button succeeds. When a refresh fails, a forecast up to 3 hours old keeps
being served.

## Limits

- The minute-by-minute block is **model data** (HRRR sub-hourly over the US,
  global models elsewhere), not radar, refreshed every 15 minutes at best.
- Alert coverage depends on what each national service publishes; outside the
  US, alert titles are in the local language (the phenomenon is still
  recognized in English, French, German and Spanish).
- A location without a minute-by-minute block: the trigger stays silent, the
  action and the widget say so.
- Scene and widget fields name a house by its name: Gladys 5.1 has no house
  picker for them yet.
- Not verified against a real API key in development: see
  [the fixtures](test/fixtures/README.md) for what is real and what is
  synthetic.

## Development

Node.js 22+, ESM, no build step; the only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm ci
npm run format:check   # Prettier (Markdown included)
npm run lint           # ESLint
npm test               # node --test, never touches the network
npx github:GladysAssistant/integration-store .   # store admission checks
```

```
index.js                 SDK wiring only
src/app.js               the integration on an injected client (handlers, status, nudges)
src/api.js               the one Pirate Weather call, quota headers, error kinds
src/forecast.js          raw response → slim SI forecast (any `units` → SI)
src/forecast-store.js    cache per location, shared calls, stale fallback, quota blocks
src/scheduler.js         the refresh timer
src/budget.js            the cadence from the quota
src/pivot.js             SI forecast → Gladys pivot weather, in the requested units
src/conditions.js        icons → Gladys conditions, day/night
src/alerts.js            alerts → Gladys alerts (severity, phenomenon, order)
src/nowcast.js           the next 60 minutes
src/scene-triggers.js    "precipitation expected within the hour"
src/scene-actions.js     "precipitation of the next hour"
src/widget.js            the next-hour chart widget
src/houses.js            the houses of Gladys
scripts/capture-fixture.mjs   record a real response as a test fixture
```

To record a real response as a fixture (one call, the key never lands in the
file):

```bash
PIRATE_WEATHER_API_KEY=... node scripts/capture-fixture.mjs 35.4676 -97.5164 oklahoma-city
```

Run it against a Gladys instance:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="pirate-weather" \
LOG_LEVEL=debug \
npm start
```

## Releasing

Versions belong to the **Release** workflow (Actions → Release → patch, minor
or major): it bumps `package.json` and the manifest `version`/`docker_image`,
moves the `## [Unreleased]` section of [`CHANGELOG.md`](CHANGELOG.md), tags,
builds the multi-arch image to `ghcr.io/guim31/gladys-pirate-weather` and
publishes the GitHub Release.

> A hand-pushed tag (`git tag v1.0.0 && git push --tags`) triggers the same
> build and Release but touches no file: bump `version` in `package.json` and
> in `gladys-assistant-integration.json` (with the `docker_image` tag) and
> commit **before** tagging.

## Credits

- Weather data: [Pirate Weather](https://pirateweather.net/), created by
  [@alexander0042](https://github.com/alexander0042) — powered by Pirate
  Weather.
- The Home Assistant integration
  [Pirate-Weather/pirate-weather-ha](https://github.com/Pirate-Weather/pirate-weather-ha)
  (Apache-2.0) served as reference; one of its test fixtures is reused as is.
  The official API documentation
  [Pirate-Weather/pirateweather](https://github.com/Pirate-Weather/pirateweather)
  (Apache-2.0) provides the other real response.
- The Gladys integration
  [William-De71/gladys-meteo-france](https://github.com/William-De71/gladys-meteo-france)
  showed the way for the weather type (the house registry pattern, the alert
  nudge).
- Started from the official
  [Gladys JavaScript integration template](https://github.com/GladysAssistant/integration-template-js).

## License

Apache-2.0

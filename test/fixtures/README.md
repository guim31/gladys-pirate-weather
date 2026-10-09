# Test fixtures

## Pirate Weather responses

| File                                      | Origin                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `real-san-francisco-us-units.json`        | **Real** response (`units=us`, version 2, October 2025), copied verbatim from the tests of the Home Assistant integration [Pirate-Weather/pirate-weather-ha](https://github.com/Pirate-Weather/pirate-weather-ha) (`tests/fixtures/pirate_weather_response.json`, Apache-2.0). One point per block.                                                               |
| `real-ontario-ca-units-alert.json`        | **Real** response (`units=ca`, November 2025) published in the official API documentation, [Pirate-Weather/pirateweather](https://github.com/Pirate-Weather/pirateweather) (`docs/API/response-example.md`, Apache-2.0), with a real Environment Canada alert in French relayed through the WMO register. The `...` of the page are removed: one point per block. |
| `synthetic-oklahoma-city-nws-alerts.json` | **Synthetic**, `units=si`, version 2: a summer storm over Oklahoma City (US), rain starting in 18 minutes, five NWS alerts (tornado, thunderstorm watch, flash flood, heat, special statement) and one duplicate.                                                                                                                                                 |
| `synthetic-paris-wmo-alerts.json`         | **Synthetic**, `units=si`: an evening in Paris, a dry hour with traces under the rain threshold, two WMO alerts in French, one without onset (`time: -999`), one without expiry (`expires: -999`).                                                                                                                                                                |
| `synthetic-tromso-no-minutely.json`       | **Synthetic**, `units=si`: a polar night in Tromsø, freezing fog then snow, **no `minutely` block**, sunrise and sunset at -999.                                                                                                                                                                                                                                  |

The synthetic fixtures follow the documented format field by field (field names,
units, -999 for missing values, NWS and WMO alert shapes from the API source
code), but no API call produced them: the development environment could not
reach the API. Replace them with real captures when possible — one call each:

```bash
PIRATE_WEATHER_API_KEY=... node scripts/capture-fixture.mjs 35.4676 -97.5164 oklahoma-city
```

The script writes `real-<name>.json` with the exact parameters of the
integration; the API key never lands in the file.

## `gladys-feature-table.json`

The category/type couples, units and poll frequencies of the Gladys core, used
by `test/gladys-rules.test.js`. This integration publishes no device; the table
keeps the conformity test ready if one is ever added.

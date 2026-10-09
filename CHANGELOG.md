# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-09

### Added

- Pirate Weather as the weather provider of Gladys: current conditions, the
  next 24 hours and the next 8 days, in °F/mph or °C/m/s after each user's
  unit system, for every house with a location.
- Official weather alerts (US National Weather Service, Environment Canada,
  European services through the WMO register) with their severity and
  phenomenon, for the Gladys "Weather alert" scene trigger; Gladys is told to
  re-read the weather as soon as the alerts of a house change.
- Scene trigger "Rain or snow expected within the hour", from the
  minute-by-minute forecast.
- Scene action "Get the precipitation of the next hour".
- Dashboard widget "Precipitation, next hour".
- Automatic refresh cadence under half of the monthly quota (every 15 minutes
  for one house on the free plan), adjusted to the calls left reported by
  Pirate Weather; manual intervals from 15 minutes to 2 hours.
- "Test the API key" button, showing the calls left this month.

[Unreleased]: https://github.com/guim31/gladys-pirate-weather/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-pirate-weather/releases/tag/v1.0.1

// -----------------------------------------------------------------------------
// Parse a Pirate Weather response into the slim, SI-only forecast the
// integration caches.
//
// A raw response weighs 50 to 100 KB (60 minutely points, 48 hours, 8 days,
// alert bulletins of several KB). Only the fields the integration reads are
// kept, converted to SI once (see units.js), so the cache of a few locations
// stays far below the 256 MB of the sandbox and every reader works in one unit
// system.
//
// Pirate Weather marks a missing value with -999 (fire index, alert times...)
// or leaves it out: both become null here, so no -999 can ever reach Gladys as
// a temperature.
// -----------------------------------------------------------------------------

import { toSIConverters } from './units.js';

const MISSING = -999;

/**
 * @description Read a finite number, null for absent, non-numeric or -999.
 * @param {any} value - The raw value.
 * @returns {number|null} The number.
 * @example
 * num(-999); // -> null
 */
function num(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === MISSING) {
    return null;
  }
  return value;
}

/**
 * @description Read a non-empty string.
 * @param {any} value - The raw value.
 * @returns {string|null} The trimmed string, or null.
 * @example
 * str(' rain '); // -> 'rain'
 */
function str(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * @description Apply a converter to a value that may be null.
 * @param {Function} convert - The converter.
 * @param {number|null} value - The value.
 * @returns {number|null} The converted value.
 * @example
 * map((x) => x * 2, null); // -> null
 */
function map(convert, value) {
  return value === null ? null : convert(value);
}

/**
 * @description The data points of a block (`{ data: [...] }`), objects only.
 * @param {any} block - The raw block.
 * @returns {Array<object>|null} The points, or null when the block is absent.
 * @example
 * pointsOf({ data: [{ time: 1 }] });
 */
function pointsOf(block) {
  if (block === null || typeof block !== 'object' || !Array.isArray(block.data)) {
    return null;
  }
  return block.data.filter((point) => point !== null && typeof point === 'object');
}

/**
 * @description The precipitation fields shared by every block.
 * @param {object} point - A raw data point.
 * @param {object} si - The SI converters.
 * @returns {object} `{ precipIntensity (mm/h), precipProbability (0-1), precipType }`.
 * @example
 * readPrecipitation({ precipIntensity: 0.5, precipType: 'rain' }, si);
 */
function readPrecipitation(point, si) {
  const type = str(point.precipType);
  return {
    precipIntensity: map(si.intensity, num(point.precipIntensity)),
    precipProbability: num(point.precipProbability),
    precipType: type === 'none' ? null : type,
  };
}

/**
 * @description The liquid-water equivalent that falls over a period, in mm.
 * `precipAccumulation` adds centimetres of snow to centimetres of rain (5 mm
 * of rain and 5 cm of snow read 5.5), so the per-type accumulations of
 * `version=2` are summed instead, snow at the usual 10:1 ratio. Without them,
 * the mean liquid intensity times the duration.
 * @param {object} point - A raw hourly or daily point.
 * @param {object} si - The SI converters.
 * @param {number} hours - The duration of the period.
 * @returns {number|null} Millimetres of water.
 * @example
 * readLiquidAmount({ liquidAccumulation: 0.5 }, si, 1); // -> 5
 */
function readLiquidAmount(point, si, hours) {
  const liquid = map(si.accumulation, num(point.liquidAccumulation));
  const ice = map(si.accumulation, num(point.iceAccumulation));
  const snow = map(si.accumulation, num(point.snowAccumulation));
  if (liquid !== null || ice !== null || snow !== null) {
    // cm of liquid or ice → mm (×10); cm of snow → mm of water (×10 / 10).
    return (liquid ?? 0) * 10 + (ice ?? 0) * 10 + (snow ?? 0);
  }
  const intensity = map(si.intensity, num(point.precipIntensity));
  return intensity === null ? null : intensity * hours;
}

/**
 * @description The atmospheric fields shared by current, hourly and daily.
 * @param {object} point - A raw data point.
 * @param {object} si - The SI converters.
 * @returns {object} The fields, in SI.
 * @example
 * readAtmosphere({ humidity: 0.8, windSpeed: 3 }, si);
 */
function readAtmosphere(point, si) {
  return {
    icon: str(point.icon),
    humidity: num(point.humidity),
    pressure: num(point.pressure),
    windSpeed: map(si.speed, num(point.windSpeed)),
    windGust: map(si.speed, num(point.windGust)),
    windBearing: num(point.windBearing),
    cloudCover: num(point.cloudCover),
    uvIndex: num(point.uvIndex),
    visibility: map(si.distance, num(point.visibility)),
    ...readPrecipitation(point, si),
  };
}

/**
 * @description Read one alert. Times of -999 (no onset, no expiry) are null.
 * @param {object} alert - A raw alert.
 * @returns {object|null} The alert, or null without a title.
 * @example
 * readAlert({ title: 'Heat Advisory', severity: 'Moderate', time: 1, expires: 2 });
 */
function readAlert(alert) {
  if (alert === null || typeof alert !== 'object') {
    return null;
  }
  const title = str(alert.title);
  if (title === null) {
    return null;
  }
  const time = num(alert.time);
  const expires = num(alert.expires);
  return {
    title,
    severity: str(alert.severity),
    time: time !== null && time > 0 ? time : null,
    expires: expires !== null && expires > 0 ? expires : null,
    description: str(alert.description),
    regions: Array.isArray(alert.regions) ? alert.regions.filter((r) => str(r) !== null) : [],
    uri: str(alert.uri),
  };
}

/**
 * @description Parse a raw Pirate Weather response.
 * @param {object} raw - The JSON body.
 * @param {object} [options] - Options.
 * @param {number} [options.fetchedAt] - When it was fetched, in ms.
 * @returns {object} The slim SI forecast: `{ latitude, longitude, timezone,
 * fetchedAt, currently, minutely (array or null), hourly, daily, alerts,
 * nearestCity, sourceUnits }`. Times stay UNIX seconds, as the API sends them.
 * @throws {Error} When the body has no usable current conditions.
 * @example
 * const forecast = parseForecast(await response.json(), { fetchedAt: Date.now() });
 */
function parseForecast(raw, { fetchedAt = Date.now() } = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('The Pirate Weather response is not an object');
  }
  const flags = raw.flags !== null && typeof raw.flags === 'object' ? raw.flags : {};
  const sourceUnits = str(flags.units) || 'si';
  const si = toSIConverters(sourceUnits);

  const current = raw.currently;
  const currentTemperature = num(current?.temperature);
  const currentTime = num(current?.time);
  if (currentTemperature === null || currentTime === null) {
    // Without a temperature and a time the core rejects the payload anyway:
    // failing here keeps an unusable answer out of the cache.
    throw new Error('The Pirate Weather response has no current conditions');
  }

  const minutelyPoints = pointsOf(raw.minutely);
  const minutely =
    minutelyPoints === null
      ? null
      : minutelyPoints
          .filter((point) => num(point.time) !== null)
          .map((point) => ({ time: point.time, ...readPrecipitation(point, si) }));

  const hourly = (pointsOf(raw.hourly) || [])
    .filter((point) => num(point.time) !== null && num(point.temperature) !== null)
    .map((point) => ({
      time: point.time,
      temperature: si.temperature(point.temperature),
      apparentTemperature: map(si.temperature, num(point.apparentTemperature)),
      precipAmount: readLiquidAmount(point, si, 1),
      ...readAtmosphere(point, si),
    }));

  const daily = (pointsOf(raw.daily) || [])
    .filter(
      (point) =>
        num(point.time) !== null &&
        num(point.temperatureMin) !== null &&
        num(point.temperatureMax) !== null,
    )
    .map((point) => ({
      time: point.time,
      temperatureMin: si.temperature(point.temperatureMin),
      temperatureMax: si.temperature(point.temperatureMax),
      sunriseTime: num(point.sunriseTime),
      sunsetTime: num(point.sunsetTime),
      precipAmount: readLiquidAmount(point, si, 24),
      ...readAtmosphere(point, si),
    }));

  const alerts = (Array.isArray(raw.alerts) ? raw.alerts : [])
    .map(readAlert)
    .filter((alert) => alert !== null);

  return {
    latitude: num(raw.latitude),
    longitude: num(raw.longitude),
    timezone: str(raw.timezone),
    fetchedAt,
    currently: {
      time: currentTime,
      temperature: si.temperature(currentTemperature),
      apparentTemperature: map(si.temperature, num(current.apparentTemperature)),
      dewPoint: map(si.temperature, num(current.dewPoint)),
      summary: str(current.summary),
      ...readAtmosphere(current, si),
    },
    minutely,
    hourly,
    daily,
    alerts,
    nearestCity: str(flags.nearestCity),
    sourceUnits,
  };
}

export { MISSING, num, parseForecast };

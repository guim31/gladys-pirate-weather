// -----------------------------------------------------------------------------
// Slim SI forecast → the Gladys pivot weather format (contract B.18).
//
// The core whitelists, bounds and normalizes the payload (normalizeWeather):
// this module produces exactly the fields it keeps, in the unit system of the
// request, and leaves out what Pirate Weather does not know rather than
// sending a null.
//
//   current   temperature, weather, datetime (required), apparent temperature,
//             humidity, pressure, dew point, wind speed / direction / gust,
//             visibility, cloud cover, UV index, sunrise, sunset, is_day;
//   hours     the current hour and the next 23 (Gladys keeps 24);
//   days      today and the next 7 (Gladys keeps 8);
//   alerts    official alerts, most severe first (alerts.js).
//
// Percentages are 0-100 (Pirate Weather sends 0-1 fractions).
// -----------------------------------------------------------------------------

import { buildAlerts } from './alerts.js';
import { isDay, toCondition } from './conditions.js';
import { fromSI, round } from './units.js';

const MAX_HOURS = 24;
const MAX_DAYS = 8;

/**
 * @description Copy the defined values of an object (drop null/undefined).
 * @param {object} fields - The candidate fields.
 * @returns {object} The fields with a value.
 * @example
 * compact({ a: 1, b: null }); // -> { a: 1 }
 */
function compact(fields) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== null && value !== undefined),
  );
}

/**
 * @description A 0-1 fraction as a 0-100 integer percentage.
 * @param {number|null} fraction - The fraction.
 * @returns {number|null} The percentage.
 * @example
 * percent(0.825); // -> 83
 */
function percent(fraction) {
  return fraction === null || fraction === undefined ? null : round(fraction * 100, 0);
}

/**
 * @description UNIX seconds as an ISO date.
 * @param {number|null} seconds - UNIX seconds.
 * @returns {string|null} The ISO date.
 * @example
 * isoDate(0); // -> '1970-01-01T00:00:00.000Z'
 */
function isoDate(seconds) {
  return seconds === null || seconds === undefined ? null : new Date(seconds * 1000).toISOString();
}

/**
 * @description The day of the forecast that holds a time.
 * @param {Array<object>} days - The slim daily points.
 * @param {number} time - UNIX seconds.
 * @returns {object|undefined} The day.
 * @example
 * dayOf(forecast.daily, forecast.currently.time);
 */
function dayOf(days, time) {
  return days.find((day) => day.time <= time && time < day.time + 24 * 3600);
}

/**
 * @description Build the pivot weather of a forecast, in one unit system.
 * @param {object} forecast - The slim SI forecast (forecast.js).
 * @param {object} options - Options.
 * @param {string} options.units - 'metric' or 'us', as the core requested.
 * @param {number} [options.now] - The current time in ms.
 * @returns {object} The pivot weather payload.
 * @example
 * buildWeather(forecast, { units: 'us' });
 */
function buildWeather(forecast, { units, now = Date.now() }) {
  const convert = fromSI(units);
  const nowSeconds = Math.floor(now / 1000);
  const { currently, daily } = forecast;
  const today = dayOf(daily, currently.time);

  const weather = compact({
    temperature: convert.temperature(currently.temperature),
    weather: toCondition(currently),
    datetime: isoDate(currently.time),
    apparent_temperature: convert.temperature(currently.apparentTemperature),
    humidity: percent(currently.humidity),
    pressure: convert.pressure(currently.pressure),
    dew_point: convert.temperature(currently.dewPoint),
    wind_speed: convert.speed(currently.windSpeed),
    wind_direction: currently.windBearing,
    wind_gust: convert.speed(currently.windGust),
    visibility: convert.visibility(currently.visibility),
    cloud_cover: percent(currently.cloudCover),
    uv_index: round(currently.uvIndex, 0),
    sunrise: isoDate(today?.sunriseTime),
    sunset: isoDate(today?.sunsetTime),
    is_day: isDay(currently.time, forecast, currently.icon),
  });

  // The hour under way and the following ones: a forecast served from the
  // cache an hour later must not lead with an hour already past.
  weather.hours = forecast.hourly
    .filter((hour) => hour.time + 3600 > nowSeconds)
    .slice(0, MAX_HOURS)
    .map((hour) =>
      compact({
        temperature: convert.temperature(hour.temperature),
        weather: toCondition(hour),
        datetime: isoDate(hour.time),
        apparent_temperature: convert.temperature(hour.apparentTemperature),
        humidity: percent(hour.humidity),
        pressure: convert.pressure(hour.pressure),
        wind_speed: convert.speed(hour.windSpeed),
        wind_direction: hour.windBearing,
        wind_gust: convert.speed(hour.windGust),
        cloud_cover: percent(hour.cloudCover),
        precipitation: convert.precipitation(hour.precipAmount),
        precipitation_probability: percent(hour.precipProbability),
        uv_index: round(hour.uvIndex, 0),
        is_day: isDay(hour.time, forecast, hour.icon),
      }),
    );

  weather.days = daily
    .filter((day) => day.time + 24 * 3600 > nowSeconds)
    .slice(0, MAX_DAYS)
    .map((day) =>
      compact({
        temperature_min: convert.temperature(day.temperatureMin),
        temperature_max: convert.temperature(day.temperatureMax),
        datetime: isoDate(day.time),
        weather: toCondition(day),
        humidity: percent(day.humidity),
        wind_speed: convert.speed(day.windSpeed),
        wind_direction: day.windBearing,
        wind_gust: convert.speed(day.windGust),
        precipitation: convert.precipitation(day.precipAmount),
        precipitation_probability: percent(day.precipProbability),
        uv_index: round(day.uvIndex, 0),
        sunrise: isoDate(day.sunriseTime),
        sunset: isoDate(day.sunsetTime),
      }),
    );

  const alerts = buildAlerts(forecast.alerts, nowSeconds);
  if (alerts.length > 0) {
    weather.alerts = alerts;
  }
  return weather;
}

export { MAX_DAYS, MAX_HOURS, buildWeather };

// -----------------------------------------------------------------------------
// Pirate Weather icons → Gladys weather conditions.
//
// The request asks for the expanded icon set (`icon=pirate`), which names
// drizzle, heavy rain, haze, flurries... apart; the original Dark Sky set is
// a subset of it, so both map here. The day/night variant of an icon is NOT
// the meteorology: `clear-night` is `clear` with `is_day: false` (the `night`
// condition is deprecated for providers), and is_day comes from the sun times
// whenever they are known (isDay below), the icon suffix being the fallback.
//
// Three refinements use the data next to the icon, because the icon cannot
// say it:
//   - precipType `ice` (freezing rain, version=2) turns rain into
//     `freezing-rain`;
//   - fog at or below 0 °C is `freezing-fog`;
//   - a thunderstorm whose precipitation is snow is `snow-thunderstorm`.
//
// The "possible-*" icons mean a LOW chance of precipitation (Pirate Weather
// shows them below its 25 % threshold) and `breezy` a wind below its windy
// threshold: the sky decides, as the default icon set would.
// -----------------------------------------------------------------------------

import { WEATHER_CONDITIONS as C } from '@gladysassistant/integration-sdk';

const ICON_CONDITIONS = Object.freeze({
  'clear-day': C.CLEAR,
  'clear-night': C.CLEAR,
  'mostly-clear-day': C.CLEAR,
  'mostly-clear-night': C.CLEAR,
  'partly-cloudy-day': C.PARTLY_CLOUDY,
  'partly-cloudy-night': C.PARTLY_CLOUDY,
  // The default set calls 37.5-87.5 % cover "partly cloudy": mostly-cloudy is
  // its upper half.
  'mostly-cloudy-day': C.PARTLY_CLOUDY,
  'mostly-cloudy-night': C.PARTLY_CLOUDY,
  cloudy: C.CLOUD,
  fog: C.FOG,
  mist: C.FOG,
  haze: C.FOG,
  smoke: C.FOG,
  drizzle: C.DRIZZLE,
  'light-rain': C.RAIN,
  rain: C.RAIN,
  'heavy-rain': C.POURING,
  precipitation: C.RAIN,
  flurries: C.SNOW,
  'light-snow': C.SNOW,
  snow: C.SNOW,
  'heavy-snow': C.SNOW,
  'very-light-sleet': C.SLEET,
  'light-sleet': C.SLEET,
  sleet: C.SLEET,
  'heavy-sleet': C.SLEET,
  mixed: C.SLEET,
  hail: C.HAIL,
  thunderstorm: C.THUNDERSTORM,
  wind: C.WIND,
  'dangerous-wind': C.WIND,
  tornado: C.TORNADO,
});

const RAIN_CONDITIONS = new Set([C.DRIZZLE, C.RAIN, C.POURING]);

/**
 * @description The condition of a sky from its cloud cover, with the
 * thresholds Pirate Weather uses for its own icons.
 * @param {number|null} cloudCover - Cloud cover, 0-1.
 * @returns {string} A condition (unknown without a cover).
 * @example
 * skyCondition(0.5); // -> 'partly-cloudy'
 */
function skyCondition(cloudCover) {
  if (cloudCover === null || cloudCover === undefined) {
    return C.UNKNOWN;
  }
  if (cloudCover > 0.875) {
    return C.CLOUD;
  }
  if (cloudCover > 0.375) {
    return C.PARTLY_CLOUDY;
  }
  return C.CLEAR;
}

/**
 * @description Map a data point (current, hour or day) to a Gladys condition.
 * @param {object} point - A slim SI data point (`icon`, `precipType`,
 * `cloudCover`, and `temperature` — or `temperatureMax` for a day: fog is
 * freezing when even the warmest hour freezes).
 * @returns {string} A condition of the Gladys enum.
 * @example
 * toCondition({ icon: 'rain', precipType: 'ice' }); // -> 'freezing-rain'
 */
function toCondition(point) {
  // Not in the table: `breezy`, the `possible-*` icons, `none`, or an icon
  // added to the API after this code — the cloud cover describes the sky.
  const condition = Object.hasOwn(ICON_CONDITIONS, point.icon ?? '')
    ? ICON_CONDITIONS[point.icon]
    : skyCondition(point.cloudCover);

  if (RAIN_CONDITIONS.has(condition) && point.precipType === 'ice') {
    return C.FREEZING_RAIN;
  }
  if (condition === C.THUNDERSTORM && point.precipType === 'snow') {
    return C.SNOW_THUNDERSTORM;
  }
  const temperature = point.temperature ?? point.temperatureMax ?? null;
  if (condition === C.FOG && temperature !== null && temperature <= 0) {
    return C.FREEZING_FOG;
  }
  return condition;
}

/**
 * @description The elevation of the sun above the horizon (NOAA low-precision
 * formulas, well under a degree of error: plenty to tell day from night).
 * @param {number} time - UNIX seconds.
 * @param {number} latitude - Degrees.
 * @param {number} longitude - Degrees.
 * @returns {number} The elevation in degrees.
 * @example
 * solarElevation(1781550000, 35.47, -97.52); // -> about 70
 */
function solarElevation(time, latitude, longitude) {
  const rad = Math.PI / 180;
  const days = time / 86400 - 10957.5; // days since J2000.0
  const meanLongitude = (280.46 + 0.9856474 * days) % 360;
  const meanAnomaly = ((357.528 + 0.9856003 * days) % 360) * rad;
  const eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * rad;
  const obliquity = (23.439 - 0.0000004 * days) * rad;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.cos(eclipticLongitude),
  );
  const siderealTime = (280.46061837 + 360.98564736629 * days + longitude) * rad;
  const hourAngle = siderealTime - rightAscension;
  const lat = latitude * rad;
  return (
    Math.asin(
      Math.sin(lat) * Math.sin(declination) +
        Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle),
    ) / rad
  );
}

/**
 * @description Whether the sun is up at a time: from the sunrise and sunset
 * of the forecast days, else from the icon suffix, else from the position of
 * the sun — Pirate Weather has no sunrise to give in a polar night or day.
 * @param {number} time - UNIX seconds.
 * @param {object} forecast - The slim forecast (`daily`, `latitude`,
 * `longitude`).
 * @param {string|null} [icon] - The icon of the point.
 * @returns {boolean|null} true by day, false by night, null when unknown.
 * @example
 * isDay(forecast.currently.time, forecast, forecast.currently.icon);
 */
function isDay(time, forecast, icon = null) {
  // The day whose span holds the time: daily points start at local midnight.
  const day = (forecast.daily || []).find(
    (candidate) => candidate.time <= time && time < candidate.time + 24 * 3600,
  );
  if (day && day.sunriseTime !== null && day.sunsetTime !== null) {
    return time >= day.sunriseTime && time < day.sunsetTime;
  }
  if (typeof icon === 'string') {
    if (icon.endsWith('-night')) {
      return false;
    }
    if (icon.endsWith('-day')) {
      return true;
    }
  }
  if (Number.isFinite(forecast.latitude) && Number.isFinite(forecast.longitude)) {
    // -0.833°: the sun's upper limb on the horizon, refraction included.
    return solarElevation(time, forecast.latitude, forecast.longitude) > -0.833;
  }
  return null;
}

export { ICON_CONDITIONS, isDay, skyCondition, solarElevation, toCondition };

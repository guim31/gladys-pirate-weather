// -----------------------------------------------------------------------------
// The next 60 minutes, from the `minutely` block.
//
// Pirate Weather gives, minute by minute, a precipitation intensity (liquid
// water equivalent, mm/h in SI), a probability and a type. It is model data
// (HRRR sub-hourly over the US, NBM, then global models elsewhere), not a
// radar nowcast: good enough to say "rain within the hour", with the
// probability to say how sure.
//
// A minute counts as wet when BOTH hold:
//   - the intensity reaches 0.1 mm/h (about 0.004 in/h): below, it is a trace
//     no one would close a window for;
//   - the probability reaches 40 % (when given): a 10 % chance of a shower is
//     not "rain expected".
//
// The intensity classes are the Dark Sky ones, in liquid water equivalent:
// light under 2.5 mm/h (0.1 in/h), moderate up to 7.6 mm/h (0.3 in/h), heavy
// above.
//
// A forecast without a `minutely` block (or with too few points) is "not
// available": the trigger stays silent and the scene action says so, instead
// of reading "dry" into missing data.
// -----------------------------------------------------------------------------

const WET_INTENSITY_MM_H = 0.1;
const WET_PROBABILITY = 0.4;
const MODERATE_MM_H = 2.5;
const HEAVY_MM_H = 7.6;

// Fewer upcoming minutes than this and the hour is not covered.
const MIN_POINTS = 30;

const INTENSITIES = Object.freeze({ LIGHT: 'light', MODERATE: 'moderate', HEAVY: 'heavy' });

const PRECIPITATION_TYPES = Object.freeze({
  RAIN: 'rain',
  SNOW: 'snow',
  SLEET: 'sleet',
  FREEZING_RAIN: 'freezing_rain',
});

/**
 * @description Whether a minute is wet.
 * @param {object} minute - A slim minutely point.
 * @returns {boolean} True when precipitation is expected that minute.
 * @example
 * isWet({ precipIntensity: 1.2, precipProbability: 0.8 }); // -> true
 */
function isWet(minute) {
  if (minute.precipIntensity === null || minute.precipIntensity < WET_INTENSITY_MM_H) {
    return false;
  }
  return minute.precipProbability === null || minute.precipProbability >= WET_PROBABILITY;
}

/**
 * @description The intensity class of a liquid intensity.
 * @param {number} intensity - mm/h.
 * @returns {string} One of INTENSITIES.
 * @example
 * intensityClass(3); // -> 'moderate'
 */
function intensityClass(intensity) {
  if (intensity >= HEAVY_MM_H) {
    return INTENSITIES.HEAVY;
  }
  if (intensity >= MODERATE_MM_H) {
    return INTENSITIES.MODERATE;
  }
  return INTENSITIES.LIGHT;
}

/**
 * @description The scene-facing precipitation type of a Pirate Weather type:
 * `ice` is freezing rain, `mixed` (rain, snow and ice) counts as sleet — which
 * Pirate Weather defines as anything neither rain nor snow.
 * @param {string|null} type - The Pirate Weather precipType.
 * @returns {string} One of PRECIPITATION_TYPES.
 * @example
 * precipitationType('ice'); // -> 'freezing_rain'
 */
function precipitationType(type) {
  switch (type) {
    case 'snow':
      return PRECIPITATION_TYPES.SNOW;
    case 'sleet':
    case 'mixed':
      return PRECIPITATION_TYPES.SLEET;
    case 'ice':
      return PRECIPITATION_TYPES.FREEZING_RAIN;
    default:
      return PRECIPITATION_TYPES.RAIN;
  }
}

/**
 * @description Read the next hour of a forecast.
 * @param {object} forecast - The slim SI forecast.
 * @param {number} nowSeconds - The current UNIX time.
 * @returns {object} `{ available: false }`, or `{ available: true, wetNow,
 * minutesUntil (null when dry), durationMinutes, type, intensity,
 * peakIntensity (mm/h), probability (0-100), points }` — `points` being the
 * upcoming minutes `{ time, intensity }` for the widget chart.
 * @example
 * readNowcast(forecast, Math.floor(Date.now() / 1000));
 */
function readNowcast(forecast, nowSeconds) {
  const minutes = (forecast.minutely || []).filter((minute) => minute.time + 60 > nowSeconds);
  if (minutes.length < MIN_POINTS) {
    return { available: false };
  }
  const points = minutes.map((minute) => ({
    time: minute.time,
    intensity: minute.precipIntensity ?? 0,
  }));
  const firstWet = minutes.findIndex(isWet);
  if (firstWet === -1) {
    return {
      available: true,
      wetNow: false,
      minutesUntil: null,
      durationMinutes: 0,
      type: null,
      intensity: null,
      peakIntensity: 0,
      probability: null,
      points,
    };
  }

  // The first wet spell: from its first minute to the next dry one.
  let end = firstWet;
  while (end < minutes.length && isWet(minutes[end])) {
    end += 1;
  }
  const spell = minutes.slice(firstWet, end);
  const peakIntensity = Math.max(...spell.map((minute) => minute.precipIntensity));
  const probabilities = spell
    .map((minute) => minute.precipProbability)
    .filter((value) => value !== null);
  const first = minutes[firstWet];
  return {
    available: true,
    wetNow: firstWet === 0,
    // Minutes from now, never negative (the first point may be the minute
    // under way).
    minutesUntil: Math.max(0, Math.round((first.time - nowSeconds) / 60)),
    durationMinutes: spell.length,
    type: precipitationType(first.precipType),
    intensity: intensityClass(peakIntensity),
    peakIntensity,
    probability: probabilities.length > 0 ? Math.round(Math.max(...probabilities) * 100) : null,
    points,
  };
}

/**
 * @description Whether a new nowcast announces precipitation the previous one
 * did not: the transition the trigger fires on. The first nowcast of a
 * location is a baseline (null previous): it never fires — a restart during a
 * shower must not announce it again.
 * @param {object|null} previous - The previous nowcast of the location.
 * @param {object} current - The new nowcast.
 * @returns {boolean} True when the trigger should fire.
 * @example
 * isPrecipitationAnnounced(previousNowcast, nowcast);
 */
function isPrecipitationAnnounced(previous, current) {
  if (!current.available || current.minutesUntil === null) {
    return false;
  }
  if (previous === null || !previous.available) {
    return false;
  }
  return previous.minutesUntil === null;
}

export {
  HEAVY_MM_H,
  INTENSITIES,
  MODERATE_MM_H,
  PRECIPITATION_TYPES,
  WET_INTENSITY_MM_H,
  WET_PROBABILITY,
  intensityClass,
  isPrecipitationAnnounced,
  isWet,
  precipitationType,
  readNowcast,
};

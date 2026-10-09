// -----------------------------------------------------------------------------
// Unit conversions.
//
// The integration asks Pirate Weather for SI units and caches SI values. Each
// Gladys request names its unit system (`units`: 'metric' or 'us'), and the
// pivot format expects the values in that system:
//
//   pivot      metric   us      Pirate Weather `si`
//   ---------  -------  ------  -------------------------------------------
//   temp       °C       °F      °C
//   wind       m/s      mph     m/s
//   pressure   hPa      hPa     hPa
//   precip     mm       in      intensity mm/h, accumulation cm (!)
//   visibility km       mi      km
//
// toSI() also accepts the three other Pirate Weather unit systems (us, ca,
// uk), read from `flags.units`: the request always says `si`, but nothing is
// lost by trusting the response over the request.
// -----------------------------------------------------------------------------

const UNIT_SYSTEMS = Object.freeze({ METRIC: 'metric', US: 'us' });

const MPH_TO_MS = 0.44704;
const KMH_TO_MS = 1 / 3.6;
const MILE_TO_KM = 1.609344;
const INCH_TO_MM = 25.4;

/**
 * @description Fahrenheit to Celsius.
 * @param {number} value - °F.
 * @returns {number} °C.
 * @example
 * fahrenheitToCelsius(212); // -> 100
 */
function fahrenheitToCelsius(value) {
  return ((value - 32) * 5) / 9;
}

/**
 * @description Build the converters from one Pirate Weather unit system to SI.
 * @param {string} system - `flags.units` of the response (si, us, ca, uk).
 * @returns {object} `{ temperature, speed, distance, intensity, accumulation }`
 * functions; accumulation is converted to centimetres, like `si`.
 * @example
 * toSIConverters('us').temperature(32); // -> 0
 */
function toSIConverters(system) {
  const identity = (value) => value;
  switch (system) {
    case 'us':
      return {
        temperature: fahrenheitToCelsius,
        speed: (value) => value * MPH_TO_MS,
        distance: (value) => value * MILE_TO_KM,
        intensity: (value) => value * INCH_TO_MM,
        accumulation: (value) => (value * INCH_TO_MM) / 10,
      };
    case 'ca':
      return {
        temperature: identity,
        speed: (value) => value * KMH_TO_MS,
        distance: identity,
        intensity: identity,
        accumulation: identity,
      };
    case 'uk':
      return {
        temperature: identity,
        speed: (value) => value * MPH_TO_MS,
        distance: (value) => value * MILE_TO_KM,
        intensity: identity,
        accumulation: identity,
      };
    default:
      return {
        temperature: identity,
        speed: identity,
        distance: identity,
        intensity: identity,
        accumulation: identity,
      };
  }
}

/**
 * @description Round to a number of decimals, keeping null as null.
 * @param {number|null} value - The value.
 * @param {number} decimals - The decimals.
 * @returns {number|null} The rounded value.
 * @example
 * round(1.2345, 1); // -> 1.2
 */
function round(value, decimals) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** decimals;
  // `+ 0` turns a -0 into 0: "-0 °C" reads as a bug.
  return Math.round(value * factor) / factor + 0;
}

/**
 * @description Build the converters from SI to the unit system of a Gladys
 * request, each one rounding to a sensible precision.
 * @param {string} units - 'metric' or 'us'.
 * @returns {object} `{ temperature, speed, pressure, precipitation, intensity,
 * visibility }`: SI value in, value of the requested system out (null stays
 * null).
 * @example
 * fromSI('us').temperature(0); // -> 32
 */
function fromSI(units) {
  const us = units === UNIT_SYSTEMS.US;
  const guard = (fn) => (value) =>
    value === null || value === undefined || !Number.isFinite(value) ? null : fn(value);
  return {
    // °C → °F
    temperature: guard((celsius) => round(us ? (celsius * 9) / 5 + 32 : celsius, 1)),
    // m/s → mph
    speed: guard((ms) => round(us ? ms / MPH_TO_MS : ms, 1)),
    // hPa in both systems (the pivot keeps hPa for `us` too)
    pressure: guard((hpa) => round(hpa, 0)),
    // mm → in (an amount of liquid water)
    precipitation: guard((mm) => (us ? round(mm / INCH_TO_MM, 2) : round(mm, 1))),
    // mm/h → in/h
    intensity: guard((mmh) => (us ? round(mmh / INCH_TO_MM, 3) : round(mmh, 2))),
    // km → mi
    visibility: guard((km) => round(us ? km / MILE_TO_KM : km, 1)),
  };
}

/**
 * @description The display unit of a precipitation intensity.
 * @param {string} units - 'metric' or 'us'.
 * @returns {string} 'mm/h' or 'in/h'.
 * @example
 * intensityUnit('us'); // -> 'in/h'
 */
function intensityUnit(units) {
  return units === UNIT_SYSTEMS.US ? 'in/h' : 'mm/h';
}

export { UNIT_SYSTEMS, fahrenheitToCelsius, fromSI, intensityUnit, round, toSIConverters };

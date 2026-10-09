// -----------------------------------------------------------------------------
// The call budget: how often to refresh each location without ever running
// out of the monthly quota.
//
// The free Pirate Weather plan allows 10,000 calls a month (20,000 for a
// $2/month supporter). One refresh cycle costs ONE call per location — the
// response serves the dashboard, the chat, the alerts, the scene trigger, the
// scene action and the widget alike — so the budget is a cadence:
//
//   calls per month = locations × (31 days × 1,440 min) / interval
//
// The automatic cadence keeps the scheduled refreshes under HALF of the quota,
// never faster than every 15 minutes (the floor Pirate Weather recommends):
//
//   locations   free plan (10,000)        supporter plan (20,000)
//   1           15 min → 2,976 calls      15 min → 2,976 calls
//   2           20 min → 4,464 calls      15 min → 5,952 calls
//   3           30 min → 4,464 calls      15 min → 8,928 calls
//   4           45 min → 3,968 calls      20 min → 8,928 calls
//
// The other half covers restarts, a house added mid-cycle, the "test" button
// and anything else sharing the key. Above that, the quota headers of every
// response are the safety net: when the calls left cannot carry the cadence
// until the monthly reset, the interval is stretched to fit them, and below a
// small reserve the scheduled refreshes pause until the reset (the last
// forecast keeps being served). A manual interval obeys the same safety net.
// -----------------------------------------------------------------------------

const MONTH_MINUTES = 31 * 24 * 60;
const DEFAULT_MONTHLY_LIMIT = 10000;
const BUDGET_SHARE = 0.5;
const MIN_INTERVAL_MINUTES = 15;

// The cadences the automatic mode picks from: round numbers a user can read
// in the logs and the documentation.
const INTERVAL_LADDER = [15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 720, 1440];

// Calls kept for the on-demand needs once the quota runs low: the "test"
// button, a house added mid-month.
const RESERVE_CALLS = 20;

// While paused without a known reset time, look again after this long.
const PAUSE_FALLBACK_MS = 6 * 60 * 60 * 1000;

const PLAN_REASONS = Object.freeze({
  AUTO: 'auto',
  MANUAL: 'manual',
  STRETCHED: 'stretched',
  PAUSED: 'paused',
});

/**
 * @description Calls a month for a number of locations at a cadence.
 * @param {number} locations - The number of locations refreshed.
 * @param {number} intervalMinutes - The refresh interval.
 * @returns {number} Calls in a 31-day month.
 * @example
 * monthlyCalls(1, 15); // -> 2976
 */
function monthlyCalls(locations, intervalMinutes) {
  return Math.ceil((locations * MONTH_MINUTES) / intervalMinutes);
}

/**
 * @description The smallest ladder interval at or above a duration.
 * @param {number} minutes - The minimum interval.
 * @returns {number} A ladder interval, or the duration itself (rounded up)
 * beyond the last step.
 * @example
 * ceilToLadder(17); // -> 20
 */
function ceilToLadder(minutes) {
  return INTERVAL_LADDER.find((step) => step >= minutes) ?? Math.ceil(minutes);
}

/**
 * @description The automatic cadence: the fastest ladder interval keeping the
 * scheduled refreshes under half of the monthly limit.
 * @param {number} locations - The number of locations refreshed.
 * @param {number} [limit] - The monthly limit of the key.
 * @returns {number} The interval in minutes.
 * @example
 * automaticInterval(2, 10000); // -> 20
 */
function automaticInterval(locations, limit = DEFAULT_MONTHLY_LIMIT) {
  const budget = BUDGET_SHARE * (limit > 0 ? limit : DEFAULT_MONTHLY_LIMIT);
  const count = Math.max(1, locations);
  return ceilToLadder(Math.max(MIN_INTERVAL_MINUTES, (count * MONTH_MINUTES) / budget));
}

/**
 * @description Plan the next refresh.
 * @param {object} options - Options.
 * @param {number} options.locations - The number of locations refreshed.
 * @param {number|null} [options.manualMinutes] - The interval set by the user,
 * null for automatic.
 * @param {object|null} [options.usage] - The last quota read from the headers
 * (`{ limit, remaining, resetAt }`, api.js).
 * @param {number} [options.now] - The current time in ms.
 * @returns {{delayMs: number, intervalMinutes: number, reason: string}} When to
 * refresh next, and why at that pace.
 * @example
 * planNextRefresh({ locations: 1, usage: { limit: 10000, remaining: 9000, resetAt } });
 */
function planNextRefresh({ locations, manualMinutes = null, usage = null, now = Date.now() }) {
  const count = Math.max(1, locations);
  let intervalMinutes =
    manualMinutes !== null && manualMinutes > 0
      ? Math.max(MIN_INTERVAL_MINUTES, manualMinutes)
      : automaticInterval(count, usage?.limit ?? DEFAULT_MONTHLY_LIMIT);
  let reason = manualMinutes !== null ? PLAN_REASONS.MANUAL : PLAN_REASONS.AUTO;

  const remaining = usage?.remaining ?? null;
  if (remaining !== null) {
    const resetAt = usage.resetAt ?? null;
    if (remaining <= RESERVE_CALLS) {
      const delayMs =
        resetAt !== null && resetAt > now ? resetAt - now + 60 * 1000 : PAUSE_FALLBACK_MS;
      return { delayMs, intervalMinutes: Math.ceil(delayMs / 60000), reason: PLAN_REASONS.PAUSED };
    }
    if (resetAt !== null && resetAt > now) {
      // The cycles the calls left can still pay for, until the reset.
      const cycles = (remaining - RESERVE_CALLS) / count;
      const neededMinutes = (resetAt - now) / 60000 / cycles;
      if (neededMinutes > intervalMinutes) {
        intervalMinutes = ceilToLadder(neededMinutes);
        reason = PLAN_REASONS.STRETCHED;
      }
    }
  }
  return { delayMs: intervalMinutes * 60 * 1000, intervalMinutes, reason };
}

export {
  BUDGET_SHARE,
  DEFAULT_MONTHLY_LIMIT,
  INTERVAL_LADDER,
  MIN_INTERVAL_MINUTES,
  MONTH_MINUTES,
  PLAN_REASONS,
  RESERVE_CALLS,
  automaticInterval,
  ceilToLadder,
  monthlyCalls,
  planNextRefresh,
};

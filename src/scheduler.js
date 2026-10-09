// -----------------------------------------------------------------------------
// The refresh timer: one cycle refreshes every located house, then plans the
// next cycle on the quota (budget.js).
//
// A timer inside the container, not the Gladys device polling: a weather
// integration has no devices, and the cadence must follow the quota, not a
// fixed list of intervals. It is a chain of timeouts rather than an interval
// because the delay changes from one cycle to the next (a house added, the
// calls left running low, a 429).
//
// Houses closer than ~110 m share one call (forecast-store.js). A cycle stops
// at the first error that would repeat for every house (invalid key, quota
// spent); any other failure only skips its house. Cycles never overlap: a
// cycle asked for while one runs is queued behind it.
// -----------------------------------------------------------------------------

import { planNextRefresh } from './budget.js';
import { ERROR_KINDS } from './api.js';
import { locationKey } from './forecast-store.js';

// After a cycle where every call failed for a passing reason (network, 5xx),
// try again sooner than the full interval — but not so soon it burns calls.
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

/**
 * @description Create the refresh scheduler.
 * @param {object} options - Options.
 * @param {object} options.houses - The house registry (houses.js).
 * @param {object} options.store - The forecast store (forecast-store.js).
 * @param {Function} options.getManualMinutes - `() => number|null`, the
 * interval set by the user (null: automatic).
 * @param {Function} [options.onRefreshed] - `(house, entry) => Promise|void`,
 * called for every house after its forecast was refreshed.
 * @param {Function} [options.onCycle] - `(summary) => Promise|void`, called at
 * the end of each cycle with `{ houses, refreshed, error, plan }`.
 * @param {object} [options.logger] - Logger with info/warn/debug.
 * @param {Function} [options.now] - `() => ms`, for the tests.
 * @param {Function} [options.setTimer] - setTimeout, for the tests.
 * @param {Function} [options.clearTimer] - clearTimeout, for the tests.
 * @returns {object} The scheduler ({ start, stop, requestCycle, reschedule,
 * lastPlan }).
 * @example
 * const scheduler = createScheduler({ houses, store, getManualMinutes: () => null });
 */
function createScheduler({
  houses,
  store,
  getManualMinutes,
  onRefreshed = () => {},
  onCycle = () => {},
  logger = console,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null;
  let running = null;
  let queued = false;
  let started = false;
  let lastPlan = null;
  let lastCycleAt = null;

  /**
   * @description Arm the next cycle.
   * @param {number} delayMs - The delay.
   * @example
   * schedule(15 * 60000);
   */
  function schedule(delayMs) {
    if (!started) {
      return;
    }
    if (timer !== null) {
      clearTimer(timer);
    }
    timer = setTimer(() => {
      timer = null;
      return requestCycle();
    }, delayMs);
    // Never hold the process alive just for the timer.
    timer?.unref?.();
  }

  /**
   * @description Run one cycle: refresh every located house once.
   * @returns {Promise<object>} The summary `{ houses, refreshed, error, plan }`.
   * @example
   * await cycle();
   */
  async function cycle() {
    lastCycleAt = now();
    const located = await houses.refresh();
    let refreshed = 0;
    let failed = 0;
    let error = store.blockedError();
    const keys = new Set();

    if (error === null) {
      // One call per distinct location, every house of it notified.
      const groups = new Map();
      for (const house of located) {
        const key = locationKey(house.latitude, house.longitude);
        groups.set(key, [...(groups.get(key) ?? []), house]);
      }
      for (const [key, group] of groups) {
        keys.add(key);
        try {
          const entry = await store.refresh(group[0].latitude, group[0].longitude);
          refreshed += 1;
          for (const house of group) {
            try {
              await onRefreshed(house, entry);
            } catch (err) {
              logger.warn(`Post-refresh handling failed for "${house.name}": ${err.message}`);
            }
          }
        } catch (err) {
          failed += 1;
          error = err;
          logger.warn(`Refresh failed for "${group[0].name}": ${err.message}`);
          if (err.kind === ERROR_KINDS.AUTH || err.kind === ERROR_KINDS.QUOTA) {
            break;
          }
        }
      }
    }
    store.prune(keys);

    let plan = planNextRefresh({
      locations: Math.max(1, keys.size || located.length),
      manualMinutes: getManualMinutes(),
      usage: store.usage,
      now: now(),
    });
    const passing =
      error !== null && error.kind !== ERROR_KINDS.AUTH && error.kind !== ERROR_KINDS.QUOTA;
    if (passing && refreshed === 0 && failed > 0) {
      plan = { ...plan, delayMs: Math.min(plan.delayMs, RETRY_AFTER_FAILURE_MS) };
    }
    lastPlan = plan;

    const summary = { houses: located.length, refreshed, error, plan };
    try {
      await onCycle(summary);
    } catch (err) {
      logger.warn(`End-of-cycle handling failed: ${err.message}`);
    }
    // An invalid or missing key waits for a configuration change, which asks
    // for a cycle itself: no timer would do anything but fail again.
    if (error?.kind === ERROR_KINDS.AUTH) {
      return summary;
    }
    schedule(plan.delayMs);
    return summary;
  }

  /**
   * @description Run a cycle now, or right after the one under way.
   * @returns {Promise<object>} The summary of the cycle that ran.
   * @example
   * await scheduler.requestCycle();
   */
  function requestCycle() {
    if (running !== null) {
      queued = true;
      return running;
    }
    running = cycle()
      .catch((err) => {
        logger.warn(`Refresh cycle failed: ${err.message}`);
        schedule(RETRY_AFTER_FAILURE_MS);
        return { houses: 0, refreshed: 0, error: err, plan: lastPlan };
      })
      .finally(() => {
        running = null;
        if (queued) {
          queued = false;
          requestCycle();
        }
      });
    return running;
  }

  /**
   * @description Re-plan the next cycle after a settings change, counting from
   * the last cycle: a shorter interval takes effect without spending a call
   * now, a longer one pushes the next cycle back.
   * @example
   * scheduler.reschedule();
   */
  function reschedule() {
    if (!started || running !== null || lastCycleAt === null) {
      return;
    }
    const plan = planNextRefresh({
      locations: Math.max(1, houses.list().length),
      manualMinutes: getManualMinutes(),
      usage: store.usage,
      now: now(),
    });
    lastPlan = plan;
    schedule(Math.max(0, lastCycleAt + plan.delayMs - now()));
  }

  /**
   * @description Start the refreshes: a first cycle right away.
   * @returns {Promise<object>} The summary of the first cycle.
   * @example
   * await scheduler.start();
   */
  function start() {
    started = true;
    return requestCycle();
  }

  /**
   * @description Wait for the cycle under way, if any (and the one queued
   * behind it).
   * @returns {Promise<void>} Resolves once no cycle runs.
   * @example
   * await scheduler.settled();
   */
  async function settled() {
    while (running !== null) {
      await running;
    }
  }

  /**
   * @description Stop the refreshes.
   * @example
   * scheduler.stop();
   */
  function stop() {
    started = false;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  return {
    start,
    stop,
    requestCycle,
    reschedule,
    settled,
    get lastPlan() {
      return lastPlan;
    },
    get started() {
      return started;
    },
  };
}

export { RETRY_AFTER_FAILURE_MS, createScheduler };

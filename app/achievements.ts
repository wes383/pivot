/** The milestones: what the log adds up to, read as things worth reaching.

    Every one of them is worked out from the stretches themselves, on every
    open — none of them is stored. A trophy pinned to storage would outlive the
    correction that took the achievement away, and the drawer would then be
    telling two stories about the same day. Read this way, the milestones follow
    the log wherever it is edited, and there is nothing to migrate.

    Two of them are about the hours a person keeps rather than about how long
    anything lasted, and they ask different questions on purpose. `Early bird`
    wants a move *onto* useful before 7 am — the all-nighter who switches off at
    six has not risen early, so a move back to rest is not what it looks for.
    `Night owl` asks whether the switch was still on after 11 pm, which a stretch
    running straight through the hour answers without moving at all. */

import type { DayBucket, Span } from "./spans";
import {
  cappedEnd,
  clock12,
  dayBounds,
  dayRuns,
  daysAscending,
  daysStillOnAt,
  duration,
  hourName,
  shortDate,
  startOfDay,
  startOfWeek,
  switchTimes,
} from "./spans";

/** One thing to reach for. */
export type Milestone = {
  id: string;
  /** The unit it is drawn in. Never printed — the drawer shows one flat run of
      cards, and the group only says how a card is walked. */
  group: string;
  name: string;
  /** What it takes, said in full. Read aloud, never printed. */
  goal: string;
  /** What it takes in a few words, printed under the name. A rung whose name
      already carries the whole rule — `3-day streak`, `5 h logged` — goes
      without one, and so does the perfect ladder: its rule is the same on
      every rung, so it is said once under the board rather than twelve times
      on it. */
  rule?: string;
  /** The line under the name: the day it was reached, how far along it is, or —
      on the rung that tops a ladder — the figure the log holds now. Empty when
      there is nothing to say: nothing is printed for a milestone that has not
      been reached and has nothing to measure against. */
  detail: string;
  /** 0 to 1 — how much of the ring above the name is drawn. */
  progress: number;
  reached: boolean;
};

/** A unit of the board. Most hold one card; a ladder holds a run of rungs the
    drawer walks through instead of laying them all out at once. The name is a
    key rather than a heading — the drawer no longer prints one. */
export type MilestoneGroup = {
  group: string;
  items: Milestone[];
  /** Rungs of one climb, each a step past the last, shown one at a time. */
  ladder: boolean;
};

const HOUR = 3_600_000;

/** Past this many moves of the switch in one day, the day is a warning rather
    than a triumph — and the milestone says so. */
const FIDGETY = 30;

/** The share of a day that counts as a day well spent. */
const RICH_DAY = 0.45;

/** The same share as the whole number a card prints. Held here so the spoken
    `goal` and the line under the board are written from one figure and cannot
    drift apart. */
const RICH_PCT = Math.round(RICH_DAY * 100);

/** The two hours the owl and the lark are named after. */
const EARLY_HOUR = 7;
const LATE_HOUR = 23;

const STREAKS = [3, 7, 14, 30, 60, 180, 360, 720, 1000];
const STRETCHES = [15 * 60_000, HOUR, 3 * HOUR, 5 * HOUR];
const TOTALS = [
  HOUR,
  24 * HOUR,
  100 * HOUR,
  250 * HOUR,
  500 * HOUR,
  1000 * HOUR,
  2000 * HOUR,
  5000 * HOUR,
];
/** The days that gave better than their share to useful time, counted up rather
    than run together. One perfect day is not a climb of one — but the days it
    happened on are a tally, and a tally is climbed like any other. */
const PERFECT_DAYS = [1, 3, 7, 14, 30, 60, 100, 200, 360, 500, 720, 1000];

/** What makes a day perfect, said once under the whole board. The ladder counts
    the days and never says what one had to be — `720 perfect days` is a tally
    with nothing behind it — so the drawer prints this line beneath the cards,
    where it describes the ladder without being repeated on every rung of it. */
export const PERFECT_DAY_RULE =
  `A perfect day gives over ${RICH_PCT}% of itself to useful time.`;

/** The longest a stretch can be and still count as a flash: the record for
    getting in and out fast. Nothing shorter than `MIN_USEFUL_MS` can turn up
    here — a stretch that brief is dropped before it is ever written down — so
    the band this record is set in runs from five minutes to ten. */
const FLASH_MS = 10 * 60_000;

/** A fortress is a day whose hours stand up on their own: fewer moves of the
    switch than `FORTRESS_MOVES`, and more useful time than `FORTRESS_MS`. That
    few moves usually means one stretch entered and then left alone, which is
    exactly the day being asked for. */
const FORTRESS_MOVES = 3;
const FORTRESS_MS = 5 * HOUR;

/** The gap between two stretches that still reads as coming straight back. */
const RETURN_MS = 10 * 60_000;

/** How many moves of the switch, all told. */
const SWITCHES = [100, 1000, 10_000];

const START = "Starting out";
const STREAK = "Streaks";
const FOCUS = "Focus";
const LOGGED = "Time logged";
/** The tallies of moves, which climb like any other ladder. */
const MOVES = "Switches";
/** The ones that stand on their own instead of climbing anything: one day at
    its most extreme, one stretch at its briefest, one week's weekend against
    its weekdays. Each heads a group of one, so the drawer lays it out as a
    card of its own rather than a rung that would read as a false step. */
const FLASH = "Flash";
const FORTRESS = "Fortress";
const WEEKEND = "Weekend warrior";
const MIDNIGHT = "Across midnight";
const SEAMLESS = "Seamless";
const FIDGET = "Switch-happy";
const PERFECT = "Perfect day";

/** How much of a ring is drawn. Never quite full unless the thing was reached:
    the last sliver is the whole difference between "nearly" and "there". */
function toward(value: number, target: number, reached: boolean): number {
  return reached ? 1 : Math.min(0.98, value / target);
}

export function milestones(
  spans: Span[],
  buckets: Map<number, DayBucket>,
  now: number,
): MilestoneGroup[] {
  const days = daysAscending(buckets);
  const runs = dayRuns(buckets);

  let longestRun = 0;
  for (const run of runs) if (run.length > longestRun) longestRun = run.length;

  let total = 0;
  let busiest = 0;
  /** The days that went better than their share, oldest first — the tally the
      `Perfect day` ladder counts, and the days it hands out as dates. */
  const rich: number[] = [];
  for (const day of days) {
    const bucket = buckets.get(day);
    if (bucket === undefined) continue;
    total += bucket.useful;
    if (bucket.switches > busiest) busiest = bucket.switches;
    const [from, to] = dayBounds(day);
    if (bucket.useful / (to - from) > RICH_DAY) rich.push(day);
  }

  let longestStretch = 0;
  for (const span of spans) {
    const ms = cappedEnd(span, now) - span.start;
    if (ms > longestStretch) longestStretch = ms;
  }

  /** Every move of the switch, filed by the day that counts it — the same
      events the daily tallies are built from, read a second way. */
  const switchLog = switchTimes(spans, now);

  /** The day a run of `target` days first ran out. The runs are oldest first,
      so the first one long enough is also the one reached first. */
  const streakDay = (target: number): number | null => {
    for (const run of runs) if (run.length >= target) return run[target - 1];
    return null;
  };

  /** The day the log first held a single stretch that long. */
  const stretchDay = (target: number): number | null => {
    for (const span of spans) {
      if (cappedEnd(span, now) - span.start >= target) {
        return startOfDay(span.start);
      }
    }
    return null;
  };

  /** The day the running total first reached `target`. */
  const totalDay = (target: number): number | null => {
    let sum = 0;
    for (const day of days) {
      sum += buckets.get(day)?.useful ?? 0;
      if (sum >= target) return day;
    }
    return null;
  };

  /** The first day that began before 7 am. */
  const earlyDay = (): number | null => {
    let earliest: number | null = null;
    for (const [day, list] of switchLog) {
      const first = list.find((move) => move.into);
      if (first === undefined) continue;
      if (new Date(first.at).getHours() >= EARLY_HOUR) continue;
      if (earliest === null || day < earliest) earliest = day;
    }
    return earliest;
  };

  /** The first day the switch was still on after 11 pm. */
  const lateDay = (): number | null => {
    let earliest: number | null = null;
    for (const day of daysStillOnAt(spans, now, LATE_HOUR)) {
      if (earliest === null || day < earliest) earliest = day;
    }
    return earliest;
  };

  /** The first day whose tally of moves ran past the fidgety line. */
  const fidgetDay = (): number | null => {
    for (const day of days) {
      if ((buckets.get(day)?.switches ?? 0) > FIDGETY) return day;
    }
    return null;
  };

  /** The day the tally reached `target` perfect days, or null while it is still
      short of it. The days are oldest first, so the `target`th one is both the
      one that got there and the earliest to have done it. */
  const richDay = (target: number): number | null =>
    rich[target - 1] ?? null;

  /** Every move of the switch the log holds, added up. */
  let totalMoves = 0;
  for (const list of switchLog.values()) totalMoves += list.length;

  /** The day the running tally of moves first reached `target`. Read off the
      same moves the daily counts are built from, so "how many moves" and "how
      many moves a day" can never disagree. */
  const switchDay = (target: number): number | null => {
    let sum = 0;
    for (const day of days) {
      sum += switchLog.get(day)?.length ?? 0;
      if (sum >= target) return day;
    }
    return null;
  };

  /** The shortest finished stretch in the log, and the day it was run on. A
      stretch still running has no length to be judged by — it would be the
      shortest thing in the log a minute in and an ordinary one an hour later —
      so only the finished ones are read here. */
  let shortest = Infinity;
  let shortestDay: number | null = null;
  /** The first stretch brief enough to count as a flash. */
  let flash: number | null = null;
  /** The first stretch that ran over midnight. */
  let midnight: number | null = null;
  /** The narrowest gap left between one stretch and the next. */
  let closest: number | null = null;
  /** The day the switch first came straight back to useful. */
  let seam: number | null = null;

  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i];
    const next = spans[i + 1];
    if (span === undefined) continue;

    if (span.end !== null) {
      const ms = span.end - span.start;
      if (ms < shortest) {
        shortest = ms;
        shortestDay = startOfDay(span.start);
      }
      if (ms <= FLASH_MS && flash === null) flash = startOfDay(span.start);
      if (next !== undefined) {
        const gap = next.start - span.end;
        if (gap >= 0 && (closest === null || gap < closest)) closest = gap;
        // Dated by the moment it came back rather than the one it left: the
        // return is the thing the milestone is about.
        if (gap >= 0 && gap <= RETURN_MS && seam === null) {
          seam = startOfDay(next.start);
        }
      }
    }

    // Midnight is read off `cappedEnd` rather than the raw end, so a stretch
    // still running is judged by the length it can still reach rather than by
    // whatever the clock says while the drawer happens to be open.
    if (startOfDay(span.start) !== startOfDay(cappedEnd(span, now))) {
      if (midnight === null) midnight = startOfDay(span.start);
    }
  }

  /** The day the fortress was first built on, and — while it is still unbuilt —
      the day that has come closest to being one.

      Two halves have to hold at once, and the card can only show one figure, so
      the day held up is the longest one that kept the switch under the line.
      That is the half hardest to reach: an hour is easy to add, but a day with
      one stretch in it and nothing else is a day lived rather than arranged.
      Only if no day has managed the quiet half at all is the fullest day shown
      instead, so the reader can at least see how far the hours have got. */
  let fortress: number | null = null;
  let calm = 0;
  let calmDay: number | null = null;
  let fullest = 0;
  let fullestDay: number | null = null;

  for (const day of days) {
    const bucket = buckets.get(day);
    if (bucket === undefined) continue;
    const quiet = bucket.switches < FORTRESS_MOVES;
    if (quiet && bucket.useful > calm) {
      calm = bucket.useful;
      calmDay = day;
    }
    if (bucket.useful > fullest) {
      fullest = bucket.useful;
      fullestDay = day;
    }
    if (fortress === null && quiet && bucket.useful > FORTRESS_MS) {
      fortress = day;
    }
  }

  const nearDay = calmDay ?? fullestDay;
  const nearUseful = calmDay === null ? fullest : calm;
  const nearMoves = nearDay === null ? 0 : (buckets.get(nearDay)?.switches ?? 0);

  /** How near the fortress is, counting both halves: the hours are measured
      against their target and the moves against theirs, and the smaller of the
      two is what the ring shows. A day is only as close as its worse half. */
  const fortressScore =
    fortress !== null
      ? 1
      : Math.min(
          nearUseful / FORTRESS_MS,
          Math.min(1, (FORTRESS_MOVES - 1) / Math.max(nearMoves, 1)),
        );

  /** The share of a day that went to useful time. */
  const shareOn = (day: number): number => {
    const bucket = buckets.get(day);
    if (bucket === undefined) return 0;
    const [from, to] = dayBounds(day);
    return bucket.useful / (to - from);
  };

  /** The best a weekday managed in each week — the mark a weekend day has to
      beat. Drawn week by week rather than across the whole log, because the
      milestone is a weekend outworking its own week; every week is a fresh
      contest, and one strong week does not set the bar for a quiet one. */
  const weekdays = new Map<number, number>();
  for (const day of days) {
    const dow = new Date(day).getDay();
    if (dow === 0 || dow === 6) continue;
    const week = startOfWeek(day);
    const share = shareOn(day);
    if (share > (weekdays.get(week) ?? 0)) weekdays.set(week, share);
  }

  /** The first weekend day to outdo every weekday of its own week, and — while
      none has — how close the best of them came. A week with no weekday in the
      log leaves nothing to beat, so a weekend day with any useful time on it
      clears it; a weekend day with none has not outdone anything. */
  let weekend: number | null = null;
  let weekendNear = 0;
  for (const day of days) {
    const dow = new Date(day).getDay();
    if (dow !== 0 && dow !== 6) continue;
    const against = weekdays.get(startOfWeek(day)) ?? 0;
    const share = shareOn(day);
    if (share > against) {
      if (weekend === null || day < weekend) weekend = day;
    } else if (against > 0) {
      const ratio = share / against;
      if (ratio > weekendNear) weekendNear = ratio;
    }
  }

  /** The clock the switch was last kept on, and the distance that picks it.
      Measured around the dial rather than across it — three in the morning is
      late, not early — so the hour nearest midnight wins, whichever side of it
      that hour sits on. Only the clock is printed: a stretch stopping at
      11:50 pm has not half-crossed anything, so the distance earns no ring of
      its own. */
  let nearestMidnight = Infinity;
  let latestClock = "";

  for (const span of spans) {
    const end = cappedEnd(span, now);
    const [from, to] = dayBounds(end);
    const across = end - from;
    const distance = Math.min(across, to - from - across);
    if (distance < nearestMidnight) {
      nearestMidnight = distance;
      latestClock = clock12(end);
    }
  }

  /** The date a milestone wears once it is reached, and the plain word it wears
      until then. */
  const dateOr = (at: number | null, pending: string): string =>
    at === null ? pending : shortDate(at);

  const opened = spans[0];
  const openedAt = opened === undefined ? null : startOfDay(opened.start);
  const early = earlyDay();
  const late = lateDay();
  const fidget = fidgetDay();

  const starting: Milestone[] = [
    {
      id: "first-step",
      group: START,
      name: "First step",
      goal: "Move the switch for the first time.",
      rule: "Switch once",
      detail: dateOr(openedAt, ""),
      progress: openedAt === null ? 0 : 1,
      reached: openedAt !== null,
    },
    {
      id: "early-bird",
      group: START,
      name: "Early bird",
      goal: `Switch onto useful before ${hourName(EARLY_HOUR)}.`,
      rule: `Useful before ${hourName(EARLY_HOUR)}`,
      detail: dateOr(early, ""),
      progress: early === null ? 0 : 1,
      reached: early !== null,
    },
    {
      id: "night-owl",
      group: START,
      name: "Night owl",
      goal: `Still be useful after ${hourName(LATE_HOUR)}.`,
      rule: `Useful after ${hourName(LATE_HOUR)}`,
      detail: dateOr(late, ""),
      progress: late === null ? 0 : 1,
      reached: late !== null,
    },
  ];

  /** The rung that tops a ladder keeps a live figure once it has been reached:
      what the log holds now, instead of the day it was topped. A rung with
      nothing left above it has nothing to report but the climb behind it, and
      the date it was reached is the one thing about it that stops being
      interesting a day later — while the figure is the only reading of its kind
      the drawer holds.

      The stretch ladder is left out of this on purpose: the figure a climb of
      stretches is really about is the longest stretch, and `Personal best`
      already prints that one in full, date and all. */
  const streaks: Milestone[] = STREAKS.map((target, index) => {
    const at = streakDay(target);
    const top = at !== null && index === STREAKS.length - 1;
    return {
      id: `streak-${target}`,
      group: STREAK,
      name: `${target}-day streak`,
      goal: `Hold a run of useful time across ${target} days in a row.`,
      detail: top
        ? `Longest ${longestRun} days`
        : dateOr(at, `${longestRun} / ${target}`),
      progress: toward(longestRun, target, at !== null),
      reached: at !== null,
    };
  });

  const stretches: Milestone[] = STRETCHES.map((target) => {
    const at = stretchDay(target);
    return {
      id: `stretch-${target}`,
      group: FOCUS,
      name: `${duration(target)} stretch`,
      goal: `Stay useful for ${duration(target)} without switching off.`,
      detail: dateOr(
        at,
        `${duration(longestStretch)} / ${duration(target)}`,
      ),
      progress: toward(longestStretch, target, at !== null),
      reached: at !== null,
    };
  });

  const totals: Milestone[] = TOTALS.map((target, index) => {
    const at = totalDay(target);
    // The tally tops out the same way the long ladder does: once the last rung
    // is underfoot the line reports what has been logged, not the day it was.
    const top = at !== null && index === TOTALS.length - 1;
    return {
      id: `total-${target}`,
      group: LOGGED,
      name: `${duration(target)} logged`,
      goal: `Log ${duration(target)} in total.`,
      detail: top
        ? `Total ${duration(total)}`
        : dateOr(at, `${duration(total)} / ${duration(target)}`),
      progress: toward(total, target, at !== null),
      reached: at !== null,
    };
  });

  const perfect: Milestone[] = PERFECT_DAYS.map((target, index) => {
    const at = richDay(target);
    // Topped out, the ladder reports the tally itself — see the note on `top`
    // above the long ladder.
    const top = at !== null && index === PERFECT_DAYS.length - 1;
    const days = target === 1 ? "one day" : `${target} days`;
    return {
      id: `perfect-${target}`,
      group: PERFECT,
      name: target === 1 ? "1 perfect day" : `${target} perfect days`,
      goal: `Give more than ${RICH_PCT}% of a day to useful time, on ${days}.`,
      detail: top
        ? `Total ${rich.length} perfect days`
        : dateOr(at, `${rich.length} / ${target}`),
      progress: toward(rich.length, target, at !== null),
      reached: at !== null,
    };
  });

  /** The moves of the switch, tallied up the way the hours are: a climb, one
      rung at a time. `Switch-happy` reads the same events for a single day and
      has nowhere to climb, so it stands on its own at the end of the board. */
  const switches: Milestone[] = SWITCHES.map((target, index) => {
    const at = switchDay(target);
    // Topped out, the ladder reports the tally itself — see the note on `top`
    // above the long ladder.
    const top = at !== null && index === SWITCHES.length - 1;
    return {
      id: `moves-${target}`,
      group: MOVES,
      name: `${target} switches`,
      goal: `Move the switch ${target} times in all.`,
      detail: top
        ? `Total ${totalMoves} switches`
        : dateOr(at, `${totalMoves} / ${target}`),
      progress: toward(totalMoves, target, at !== null),
      reached: at !== null,
    };
  });

  /** In and out inside ten minutes: the record for the briefest stretch, and
      the one reading on the board that a *smaller* figure wins. The ring fills
      as the thing comes closer like every other card, so it is filled by the
      log getting shorter rather than longer — which is why the line under the
      name has to carry that direction on its own. */
  const flashy: Milestone = {
    id: "flash",
    group: FLASH,
    name: "Flash",
    goal: `Switch on and off again within ${duration(FLASH_MS)}.`,
    rule: `${duration(FLASH_MS)} or less`,
    detail: dateOr(
      flash,
      shortestDay === null ? "" : `Shortest ${duration(shortest)}`,
    ),
    progress:
      flash !== null
        ? 1
        : Math.min(0.98, FLASH_MS / Math.max(shortest, FLASH_MS + 1)),
    reached: flash !== null,
  };

  /** A long day the switch barely touched. The line under the name holds up the
      day that has come closest, moving and all, so a reader can see which half
      of the rule is the one still missing. */
  const bastion: Milestone = {
    id: "fortress",
    group: FORTRESS,
    name: "Fortress",
    goal: `Give more than ${duration(FORTRESS_MS)} to one day, on fewer than ${FORTRESS_MOVES} moves of the switch.`,
    rule: `Under ${FORTRESS_MOVES} switches, ${duration(FORTRESS_MS)}+`,
    detail: dateOr(
      fortress,
      nearDay === null ? "" : `${nearMoves} switches · ${duration(nearUseful)}`,
    ),
    progress: fortressScore,
    reached: fortress !== null,
  };

  /** A weekend day that outdid the week it belongs to. The line under the name
      reads how close one has come as a share of the weekday mark it has to
      beat — `84%` is the best weekend going four fifths of the way. */
  const warrior: Milestone = {
    id: "weekend-warrior",
    group: WEEKEND,
    name: "Weekend warrior",
    goal: "Give a Saturday or Sunday a larger share of itself than any weekday of the same week.",
    rule: "Beat its own weekdays",
    detail: dateOr(
      weekend,
      weekendNear === 0
        ? ""
        : `Best ${Math.round(weekendNear * 100)}% of a weekday`,
    ),
    progress: toward(weekendNear, 1, weekend !== null),
    reached: weekend !== null,
  };

  /** A stretch that ran over the line of midnight. The line under the name is
      the latest the switch has ever been kept on, named by its clock, because
      a direction would only be half true whatever the hour. */
  const overnight: Milestone = {
    id: "across-midnight",
    group: MIDNIGHT,
    name: "Across midnight",
    goal: "Let a single stretch run from one day into the next.",
    rule: "One stretch, two days",
    detail: dateOr(midnight, latestClock === "" ? "" : `Latest ${latestClock}`),
    // Nothing is ever half-crossed: a stretch either ran over the line or it
    // did not, so the ring stays empty until one does. How near the clock came
    // to midnight is not a step towards it, and drawing it as one said the
    // wrong thing about an evening that ended at 11:50 pm.
    progress: midnight !== null ? 1 : 0,
    reached: midnight !== null,
  };

  /** Leaving and coming straight back. The line under the name is only ever the
      day it was first done, like every other card: the narrowest gap the log
      holds is not printed, because the ring already reads as the distance to
      the window and a figure beside it would only say the same thing twice. */
  const seamless: Milestone = {
    id: "seamless",
    group: SEAMLESS,
    name: "Seamless",
    goal: `Come back to useful within ${duration(RETURN_MS)} of leaving it.`,
    rule: `Back within ${duration(RETURN_MS)}`,
    detail: dateOr(seam, ""),
    progress:
      closest !== null && closest <= RETURN_MS
        ? 1
        : Math.min(
            0.98,
            RETURN_MS / Math.max(closest ?? Infinity, RETURN_MS + 1),
          ),
    reached: closest !== null && closest <= RETURN_MS,
  };

  /** Not a step past the last one: a busier day is not a larger focus, not
      more hours logged and not another perfect day. It stands on its own, next
      to the ladders it would otherwise have been tacked onto. */
  const fidgety: Milestone = {
    id: "switch-happy",
    group: FIDGET,
    name: "Switch-happy",
    goal: `Move the switch more than ${FIDGETY} times in one day.`,
    rule: `Over ${FIDGETY} switches a day`,
    // It is not a climb, so it may not be reached by degrees — but
    // the ring still shows how near the day came, and a ring alone would leave
    // the reader guessing at the number behind it. So the line under the name
    // carries the best day so far, named as a record rather than written against
    // the target: `Longest 12 switches` under `Over 30 switches a day` is the
    // day read against the rule, while the `12 / 31` it used to print was read
    // as a score out of a total — and there is no total of switches to be part
    // of, only one day's count to beat.
    detail: dateOr(fidget, `Longest ${busiest} switches`),
    progress: toward(busiest, FIDGETY + 1, fidget !== null),
    reached: fidget !== null,
  };

  // The order of the board is the order it is read in: the ladders are walked
  // first, then the cards that stand on their own. Switch-happy closes it — it
  // reads the same moves the tally does, one day at a time, and is the last
  // word on them rather than the first.
  return [
    { group: START, items: starting, ladder: false },
    { group: STREAK, items: streaks, ladder: true },
    { group: FOCUS, items: stretches, ladder: true },
    { group: LOGGED, items: totals, ladder: true },
    { group: MOVES, items: switches, ladder: true },
    { group: PERFECT, items: perfect, ladder: true },
    { group: FLASH, items: [flashy], ladder: false },
    { group: FORTRESS, items: [bastion], ladder: false },
    { group: WEEKEND, items: [warrior], ladder: false },
    { group: MIDNIGHT, items: [overnight], ladder: false },
    { group: SEAMLESS, items: [seamless], ladder: false },
    { group: FIDGET, items: [fidgety], ladder: false },
  ];
}

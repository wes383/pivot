/** The log and the arithmetic over it — the one place a stretch, a day and a
    period are defined. The page and the drawer both read from here, so neither
    owns the numbers and neither can drift from the other. */

/** One stretch of the day spent in the "useful" state, in epoch ms. `end` is
    null while the stretch is still running: away time counts as work, so a run
    has no knowable end until the switch flips back — and so there is nothing
    for a heartbeat to keep pushing. */
export type Span = { start: number; end: number | null };

/** A dip into "useful" shorter than this is not treated as work at all: the
    stretch is dropped and stays grey, as if the break had simply carried on. */
export const MIN_USEFUL_MS = 300_000;

/** The most a stretch that is *still running* is credited. Nobody works eight
    hours without stopping, so a switch left on by mistake stops counting there
    instead of quietly swallowing the whole night — both while it runs and at
    the moment it is finally switched off. An end already written is never
    trimmed to it: a stretch whose end was set by hand in the drawer is taken at
    its word, however long that makes it. */
export const MAX_USEFUL_MS = 8 * 3_600_000;

/** Local midnight of the day `ms` falls in. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Local midnight → the next one, as epoch ms. Built from the calendar rather
    than by adding 24h, so a daylight-saving day still measures as one day. */
export function dayBounds(ms: number): [number, number] {
  const d = new Date(startOfDay(ms));
  return [
    d.getTime(),
    new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(),
  ];
}

/** Monday of the week `ms` falls in. Weeks are counted from Monday rather than
    from the locale's idea of a week, so the figures read the same everywhere. */
export function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  const back = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
}

/** The same wall-clock time `days` calendar days on, or back for a negative.
    Went through the calendar rather than adding millis, so crossing a
    daylight-saving change still lands on the same time of day. */
export function shiftDays(ms: number, days: number): number {
  const d = new Date(ms);
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() + days,
    d.getHours(),
    d.getMinutes(),
  ).getTime();
}

/** `13:05` — 24-hour and locale-independent, so every reading of the log looks
    the same wherever it is opened. Also the exact value an `<input
    type="time">` wants. */
export function clock(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** A time as the *end* of a stretch reads on a day it has been cut down to:
    `23:40`, or `24:00` when the stretch runs on past the day's last minute.
    `clock` alone would wrap that to `00:00`, which reads as the start of the
    next day rather than the end of this one. */
export function endClock(ms: number, dayEnd: number): string {
  return ms >= dayEnd ? "24:00" : clock(ms);
}

/** `2026-09-13` — the local calendar day, and the exact value an `<input
    type="date">` reads and writes. Spelled out of the local fields rather than
    sliced off `toISOString`, which would hand back the previous or next day
    depending on which side of UTC the reader sits. */
export function dateValue(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** `2 h 15 min` / `45 min` — the same plain, locale-independent wording the
    rest of the page uses. */
export function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** `12 Sep 2026` — spelled out rather than numeric, because `9/12` is two
    different days depending on which side of the ocean it is read. */
export function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** `Sep` — the axis label of a month bar. */
export function shortMonth(ms: number): string {
  return MONTHS[new Date(ms).getMonth()];
}

/** The end a stretch really counts up to. A closed stretch counts to exactly the
    end it carries — the cap was already applied when that end was written, and
    an end set by hand is honoured rather than silently trimmed. A running
    stretch has no end of its own, so it measures to the clock, and the cap is
    what keeps its green from creeping past eight hours while the switch is
    forgotten. */
export function cappedEnd(span: Span, fallback: number): number {
  return span.end ?? Math.min(fallback, span.start + MAX_USEFUL_MS);
}

/** How much of `span` falls inside [from, to). */
export function overlap(
  span: Span,
  from: number,
  to: number,
  now: number,
): number {
  const start = Math.max(span.start, from);
  const end = Math.min(cappedEnd(span, now), to);
  return Math.max(0, end - start);
}

/** Whether a stretch is work *as far as one day is concerned*.

    A stretch is cut at every midnight it crosses, and the five-minute floor is
    then applied per slice rather than once to the whole stretch: 23:00 → 00:03
    is a session worth keeping, but the three minutes it left on the second day
    are on their own too short to be work, so that day does not count them —
    and stays grey through them. Without this the day's list and its total would
    disagree: the row would show three minutes that the total had already
    refused.

    The one exception is a slice that is still being written — the open end of a
    stretch that has not been switched off yet. It is credited as it goes and
    judged when it closes, so flipping to useful and opening the drawer does not
    show an empty day for the first five minutes. */
export function countsOn(
  span: Span,
  from: number,
  to: number,
  now: number,
): boolean {
  const end = cappedEnd(span, now);
  const start = Math.max(span.start, from);
  const stop = Math.min(end, to);
  if (stop <= start) return false;
  if (span.end === null && end < to) return true;
  return stop - start >= MIN_USEFUL_MS;
}

/** Everything one day holds: the time, how many stretches touched it, and how
    many times the switch moved. */
export type DayBucket = { useful: number; spans: number; switches: number };

/** One pass over the log, cutting every stretch at each midnight it crosses, so
    that a day's figures are a lookup rather than a rescan — which is what makes
    the all-history periods affordable to open. */
export function bucketByDay(
  spans: Span[],
  now: number,
): Map<number, DayBucket> {
  const buckets = new Map<number, DayBucket>();
  const at = (day: number): DayBucket => {
    const found = buckets.get(day);
    if (found) return found;
    const made: DayBucket = { useful: 0, spans: 0, switches: 0 };
    buckets.set(day, made);
    return made;
  };

  for (const span of spans) {
    const end = cappedEnd(span, now);
    // The first and the last day that took a slice of this stretch. A switch is
    // counted only on a day that holds some of the work, which is what keeps a
    // stretch ending exactly at midnight from leaving a "1 switch, no time"
    // day behind it — and what keeps a stretch that counted nowhere from
    // moving the switch at all.
    let first: number | null = null;
    let last: number | null = null;

    for (let cursor = span.start; cursor < end; ) {
      const day = startOfDay(cursor);
      const dayEnd = dayBounds(cursor)[1];
      const sliceEnd = Math.min(end, dayEnd);
      if (countsOn(span, day, dayEnd, now)) {
        const bucket = at(day);
        bucket.useful += sliceEnd - cursor;
        bucket.spans += 1;
        if (first === null) first = day;
        last = day;
      }
      cursor = sliceEnd;
    }

    // The switch moved once when the stretch opened and once when it closed; a
    // stretch still running has only made the first of the two.
    if (first !== null) at(first).switches += 1;
    if (span.end !== null && last !== null) at(last).switches += 1;
  }

  return buckets;
}

/** The local midnights from `first` to `last`, both ends included. */
export function daysBetween(first: number, last: number): number[] {
  const days: number[] = [];
  for (let day = startOfDay(first); day <= last; day = dayBounds(day)[1]) {
    days.push(day);
  }
  return days;
}

/** The useful time held by a run of days. */
export function totalOver(
  days: number[],
  buckets: Map<number, DayBucket>,
): number {
  let total = 0;
  for (const day of days) total += buckets.get(day)?.useful ?? 0;
  return total;
}

export type Period = "day" | "week" | "month" | "year" | "all";

export const PERIODS: { key: Period; label: string }[] = [
  { key: "day", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
  { key: "all", label: "All" },
];

/** The midnights a period covers: the ones elapsed so far, ending today. A
    period in progress is measured only over the days it has actually had.

    Week keeps its anchor at Monday — seven days is short enough that a blank
    Monday is a fact about the week rather than a distortion of it. Month and
    year do not: averaging a history three days old across a whole September,
    let alone a whole year, would read as a collapse the person never had, and
    the day count on the card would claim days they never logged. So those two
    begin no earlier than the first stretch on record. Being a `max` against
    the anchor, that only ever bites during the opening period and then goes
    quiet on its own — no state to keep, nothing to migrate. */
export function periodDays(
  spans: Span[],
  period: Period,
  now: number,
): number[] {
  const today = startOfDay(now);
  const d = new Date(today);
  // Nothing logged yet: every period is a single day, so every average is
  // simply zero rather than a division by an empty history.
  const first = spans[0] === undefined ? today : startOfDay(spans[0].start);

  switch (period) {
    case "day":
      return [today];
    case "week":
      return daysBetween(startOfWeek(now), today);
    case "month":
      return daysBetween(
        Math.max(new Date(d.getFullYear(), d.getMonth(), 1).getTime(), first),
        today,
      );
    case "year":
      return daysBetween(
        Math.max(new Date(d.getFullYear(), 0, 1).getTime(), first),
        today,
      );
    case "all":
      return daysBetween(first, today);
  }
}

/** The four averages, all taken over the days the period covers, so "this week"
    means "per day of this week so far" and not "per day since forever". */
export type Averages = {
  days: number;
  useful: number;
  perDay: number;
  share: number;
  switches: number;
  stretch: number;
};

export function averageOver(
  days: number[],
  buckets: Map<number, DayBucket>,
): Averages {
  let useful = 0;
  let spans = 0;
  let switches = 0;
  let shares = 0;

  for (const day of days) {
    const bucket = buckets.get(day);
    const [from, to] = dayBounds(day);
    useful += bucket?.useful ?? 0;
    spans += bucket?.spans ?? 0;
    switches += bucket?.switches ?? 0;
    shares += bucket === undefined ? 0 : bucket.useful / (to - from);
  }

  const count = days.length || 1;
  return {
    days: days.length,
    useful,
    perDay: useful / count,
    // The share is averaged as a share, not rebuilt from the totals: a 25-hour
    // day must not be counted as if it were a 24-hour one.
    share: shares / count,
    switches: switches / count,
    // Averaged over the stretches actually logged, which is what "a stretch"
    // means — not the average of the daily averages.
    stretch: spans === 0 ? 0 : useful / spans,
  };
}

export type Bar = { from: number; to: number; useful: number };

/** The last `count` weeks, oldest first, with this week running only up to
    today. */
export function weekBars(
  buckets: Map<number, DayBucket>,
  now: number,
  count: number,
): Bar[] {
  const today = startOfDay(now);
  const bars: Bar[] = [];

  for (let back = count - 1; back >= 0; back--) {
    const from = shiftDays(startOfWeek(now), -back * 7);
    // The last day of the week, or today if the week is still running.
    const last = Math.min(shiftDays(from, 6), today);
    bars.push({ from, to: shiftDays(from, 7), useful: totalOver(daysBetween(from, last), buckets) });
  }

  return bars;
}

/** The last `count` months, oldest first, with this month running to today. */
export function monthBars(
  buckets: Map<number, DayBucket>,
  now: number,
  count: number,
): Bar[] {
  const today = new Date(startOfDay(now));
  const bars: Bar[] = [];

  for (let back = count - 1; back >= 0; back--) {
    const d = new Date(today.getFullYear(), today.getMonth() - back, 1);
    const from = d.getTime();
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    const last = Math.min(new Date(to - 1).getTime(), today.getTime());
    bars.push({ from, to, useful: totalOver(daysBetween(from, last), buckets) });
  }

  return bars;
}

/** Useful time bucketed by hour of the local day, over the whole log. A stretch
    is cut at every hour boundary it crosses, so an hour is credited only with
    the minutes actually spent inside it. */
export function hourTotals(spans: Span[], now: number): number[] {
  const hours = new Array<number>(24).fill(0);

  for (const span of spans) {
    const end = cappedEnd(span, now);
    for (let cursor = span.start; cursor < end; ) {
      const d = new Date(cursor);
      const nextHour = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        d.getHours() + 1,
      ).getTime();
      const sliceEnd = Math.min(end, nextHour);
      // Only the hours that belong to a slice the day itself counts. A sliver
      // of a session that spilled past midnight is not work anywhere, so it is
      // not an hour either — the same rule the day totals run on.
      if (countsOn(span, startOfDay(cursor), dayBounds(cursor)[1], now)) {
        hours[d.getHours()] += sliceEnd - cursor;
      }
      cursor = sliceEnd;
    }
  }

  return hours;
}

/** Useful time bucketed by weekday and hour of the local day, over the whole
    log: seven rows, Monday first, each twenty-four cells wide. A stretch is cut
    at every hour boundary it crosses, so a cell is credited only with the
    minutes actually spent inside it — and only when the day that slice belongs
    to counts the stretch at all, which is the rule the day totals and the hour
    row above both run on. */
export function heatmap(spans: Span[], now: number): number[][] {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));

  for (const span of spans) {
    const end = cappedEnd(span, now);
    for (let cursor = span.start; cursor < end; ) {
      const d = new Date(cursor);
      const nextHour = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        d.getHours() + 1,
      ).getTime();
      const sliceEnd = Math.min(end, nextHour);
      if (countsOn(span, startOfDay(cursor), dayBounds(cursor)[1], now)) {
        // `getDay` counts from Sunday; the grid counts from Monday, so that it
        // reads down the page the way a week is written.
        grid[(d.getDay() + 6) % 7][d.getHours()] += sliceEnd - cursor;
      }
      cursor = sliceEnd;
    }
  }

  return grid;
}

/** The hour of the day that has swallowed the most useful time. */
export function peakHour(hours: number[]): number | null {
  let peak: number | null = null;
  for (let hour = 0; hour < hours.length; hour++) {
    if (hours[hour] > 0 && (peak === null || hours[hour] > hours[peak])) {
      peak = hour;
    }
  }
  return peak;
}

export type Best = { ms: number; start: number; end: number };

/** The longest single stretch ever logged. */
export function bestStretch(spans: Span[], now: number): Best | null {
  let best: Best | null = null;
  for (const span of spans) {
    const end = cappedEnd(span, now);
    const ms = end - span.start;
    if (ms > 0 && (best === null || ms > best.ms)) {
      best = { ms, start: span.start, end };
    }
  }
  return best;
}

/** The day that holds the most useful time. */
export function bestDay(
  buckets: Map<number, DayBucket>,
): { day: number; useful: number } | null {
  let best: { day: number; useful: number } | null = null;
  for (const [day, bucket] of buckets) {
    if (bucket.useful > 0 && (best === null || bucket.useful > best.useful)) {
      best = { day, useful: bucket.useful };
    }
  }
  return best;
}

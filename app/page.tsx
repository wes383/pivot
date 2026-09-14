"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Drawer from "./drawer";
import {
  MAX_USEFUL_MS,
  MIN_USEFUL_MS,
  cappedEnd,
  clock12,
  countsOn,
  dayBounds,
  duration,
  endClock12,
  hourName,
  type Span,
} from "./spans";

/** The site has exactly two states. Nothing else. */
type State = "idle" | "useful";

const ORDER: State[] = ["idle", "useful"];

const LABELS: Record<State, string> = {
  idle: "I’m taking a break.",
  useful: "I’m doing something useful.",
};

const STORAGE_KEY = "pivot.state";

/** Both states sit on one track, so the track is twice the viewport wide.
    `leading-tight` keeps the box taller than the glyphs — Manrope's "g"
    descender runs past a 1.0 line-height, which is what `text-*` defaults to
    from `lg` up. */
const PANEL_CLASS =
  "flex w-1/2 shrink-0 select-none items-center justify-center px-4 text-center font-display font-bold leading-tight tracking-tight text-[clamp(1.25rem,6.5vw,2rem)] sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl";

type Side = "left" | "right";

/** Pointer target: the label plus a reach on every side. The negative margin
    cancels out the padding exactly, so the label itself never moves and the
    rest of the screen stays inert.

    `group` sits on this element rather than on the label, so the whole reach
    carries the hover state — the pointer can cross the gap between the text and
    the chevron without ever leaving the region that keeps it visible. */
const HIT_CLASS =
  "group -m-4 inline-flex cursor-pointer touch-pan-y p-4 sm:-m-5 sm:p-5 lg:-m-6 lg:p-6";

/** Extra slab of target out past the text on the side the chevron shows up, so
    the chevron sits inside the target instead of hanging off its edge. Sized
    per breakpoint to clear the chevron's gap plus its own width. */
const ARROW_ZONE_CLASS = "absolute inset-y-0 w-8 sm:w-10 lg:w-14";

/** Past this fraction of the width, releasing snaps to the other state. */
const SNAP_RATIO = 0.16;
const SNAP_MAX = 72;
/** Below this the gesture counts as a tap, not a slide. */
const TAP_SLOP = 6;

/** Every session ever logged, oldest first. The log is never trimmed by date —
    it keeps the whole history, and it is up to whoever reads it to pick the
    stretch they want. */
const LOG_KEY = "pivot.log";

function readSpans(): Span[] {
  try {
    const raw = window.localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((span): span is Span => {
        if (typeof span !== "object" || span === null) return false;
        const { start, end } = span as Span;
        return (
          typeof start === "number" && (typeof end === "number" || end === null)
        );
      })
      // Oldest first, which is also the order writes keep. Normalising here
      // means the timeline can walk the log without sorting on every render.
      .sort((a, b) => a.start - b.start);
  } catch {
    return [];
  }
}

function writeSpans(spans: Span[]) {
  try {
    window.localStorage.setItem(LOG_KEY, JSON.stringify(spans));
  } catch {
    // Storage unavailable — the timeline lives in memory only.
  }
}

/** Drops the stretches too brief to count as work. A stretch that is still
    running has no end to measure yet, so it is always kept — it gets judged
    when the switch actually flips back, and dropped then if it came up short. */
function dropBriefSpans(spans: Span[]): Span[] {
  return spans.filter(
    (span) => span.end === null || span.end - span.start >= MIN_USEFUL_MS,
  );
}

/** The switch state and the log are written together, so they normally agree.

    Restoring into "useful" means a session is in flight, so the newest stretch
    is reopened — including one left behind by a log written before open
    stretches existed, whose end is only the last heartbeat rather than a real
    one. Restoring into "break" means nothing is running, so a stretch still
    marked open was left that way by a failed write: it is dropped rather than
    handed an invented end that would claim hours of work. */
function reconcileOpenSpan(spans: Span[], running: boolean): Span[] {
  const last = spans[spans.length - 1];
  if (!last) return spans;
  if (!running) return last.end === null ? spans.slice(0, -1) : spans;
  return [...spans.slice(0, -1), { start: last.start, end: null }];
}

/** One band of the rail. `idle` and `useful` bands tile the day; the ends of
    the whole rail are rounded by the track's own clip, not by the bands. The
    timestamps are kept alongside the geometry so a band can name its own
    range when it is hovered. */
type Mark = {
  kind: "idle" | "useful";
  start: number;
  end: number;
  left: number;
  width: number;
};

/** The hours named along the ruler: every third one, midnight to midnight. The
    in-between labels are dropped on the narrowest screens, where nine of them
    would crowd each other. */
const HOUR_MARKS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

/** One rail per day — local midnight on the left, the next one on the right.
    Everything the day has covered so far is painted: grey for the hours that
    went by, green for the stretches logged as "useful". The unpainted strip on
    the right is what is left of the day. The one stretch with no end yet is the
    session running now, and it is painted to the clock. */
function DayTimeline({ spans, onOpen }: { spans: Span[]; onOpen: () => void }) {
  const [now, setNow] = useState<number | null>(null);
  const [hoverStart, setHoverStart] = useState<number | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    // A slow beat is enough: it only has to catch midnight rolling over.
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const idle: Mark[] = [];
  const useful: Mark[] = [];
  let total = 0;
  /** The day's own length, so the share is measured against the real span —
      23 h, 24 h or 25 h — rather than against a flat 86_400_000. */
  let dayLength = 0;

  // Held out here as well as inside the block below, because the tooltip needs
  // it too: a stretch cut off at midnight has to read as running to midnight
  // rather than wrapping round to 12:00 am on the day after the one being shown.
  const dayEnd = now === null ? 0 : dayBounds(now)[1];

  // Nothing is measured until after mount, so the server and the first client
  // render agree on an empty rail.
  if (now !== null) {
    const [from, to] = dayBounds(now);
    const length = to - from;
    dayLength = length;
    // Paint out to the clock or to the newest closed entry, whichever is later
    // — a stretch is stamped the instant the switch flips, which can be a beat
    // ahead of this stale `now`.
    const upTo = Math.min(Math.max(now, spans[spans.length - 1]?.end ?? 0), to);

    const paint = (start: number, end: number, kind: Mark["kind"]) => {
      // A span that has only just opened has no length yet, so it paints
      // nothing — the green shows up once the session is long enough to have
      // any width at all.
      if (end <= start) return;
      const band = {
        kind,
        start,
        end,
        left: ((start - from) / length) * 100,
        width: ((end - start) / length) * 100,
      };
      if (kind === "useful") {
        total += end - start;
        useful.push(band);
      } else idle.push(band);
    };

    // Walking the spans in order keeps the bands contiguous; whatever sits
    // between two of them is grey by definition. The log arrives oldest-first,
    // so it can be walked as it stands. Spans from earlier days fall outside
    // the window and paint nothing.
    //
    // The session still running has no end recorded, so it is painted to the
    // clock: its green edge tracks "now" instead of stepping forward once per
    // write, and a session picked up again after the page was closed carries
    // straight on from where it was, with no grey notch behind it. Either way
    // the cap applies, so a forgotten session stops at eight hours and the
    // hours after it fall back to grey.
    let cursor = from;
    for (const span of spans) {
      const start = Math.max(span.start, from);
      const end = Math.min(cappedEnd(span, upTo), upTo);
      paint(cursor, start, "idle");
      // Only the share of the day that counts is painted green. A sliver of a
      // session that spilled over midnight is not work on the day it landed on,
      // so the grey simply carries on through it — and the rail's own total
      // stays the day's total rather than a second, slightly larger number.
      if (countsOn(span, from, to, now)) paint(start, end, "useful");
      cursor = Math.max(cursor, end);
    }
    paint(cursor, upTo, "idle");
  }

  // Grey and green tile the day end to end, so the bands are drawn as plain
  // rectangles and the rail's own rounded clip shapes the two ends. Every band
  // keeps its true length; none of them is padded to a minimum, so a short
  // stretch stays exactly as short as it really was.
  const bands = [...idle, ...useful];

  // Which useful band the pointer is resting on, tracked by its start time
  // rather than its index so it survives the rail being recomputed every beat.
  const hovered =
    hoverStart === null
      ? null
      : (useful.find((band) => band.start === hoverStart) ?? null);

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = railRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const pct = ((event.clientX - rect.left) / rect.width) * 100;
    const hit = useful.find(
      (band) => pct >= band.left && pct < band.left + band.width,
    );
    const next = hit ? hit.start : null;
    // Only a change of band re-renders; sliding along one costs nothing.
    setHoverStart((prev) => (prev === next ? prev : next));
  };

  // Today's useful time as a share of the whole day, rounded to whole percent.
  const share = dayLength > 0 ? (total / dayLength) * 100 : 0;
  const percent = Math.round(share);

  const label =
    total === 0
      ? "Nothing logged as useful yet today"
      : `Today: ${duration(total)} spent doing something useful, ${percent}% of the day`;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-10 px-6 sm:bottom-[6.5rem] sm:px-0">
      {/* The padding widens the hover band without moving the rail: the
          negative margin hands the space straight back to the layout. Clicking
          anywhere on it — the rail or the band around it — opens the log. */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Open your log"
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHoverStart(null)}
        className="group pointer-events-auto relative mx-auto -my-2 w-full cursor-pointer py-2 sm:w-[60vw]"
      >
        {/* The rail and everything measured against it share one box, so `%`
            and `bottom-full` mean "the rail", not "the hover band". */}
        <div className="relative">
          <div
            ref={railRef}
            role="img"
            aria-label={label}
            className="relative h-1.5 w-full overflow-hidden rounded-full bg-track"
          >
            {/* Grey first, green over it. */}
            {bands.map((mark) => (
              <span
                key={`${mark.kind}-${mark.start}`}
                style={{
                  left: `${mark.left}%`,
                  width: `${mark.width}%`,
                }}
                className={`absolute inset-y-0 ${
                  mark.kind === "useful" ? "bg-useful-mark" : "bg-idle-mark"
                }`}
              />
            ))}
          </div>

          {/* Ruler: the hours named rather than ticked. It rides above the rail
              so the greens stay unbroken, and fades in while hovered. The hours
              are read off the 12-hour face, so the mark at either end of the
              day says `12 am` and the one at its middle `12 pm`. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-full h-4 opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100 motion-reduce:transition-none"
          >
            {HOUR_MARKS.map((hour) => (
              <span
                key={hour}
                style={{ left: `${(hour / 24) * 100}%` }}
                className={`absolute bottom-1 -translate-x-1/2 whitespace-nowrap text-[10px] leading-none tracking-normal text-foreground-subtle sm:text-[11px] ${
                  hour % 6 === 0 ? "" : "hidden sm:block"
                }`}
              >
                {hourName(hour)}
              </span>
            ))}
          </div>

          {/* One tooltip for the whole rail, parked over whichever green band
              the pointer is on. The `clamp` holds it inside the rail's own
              width, so a band near midnight cannot push it off the screen. */}
          {hovered ? (
            <span
              style={{
                left: `clamp(5rem, ${
                  hovered.left + hovered.width / 2
                }%, calc(100% - 5rem))`,
              }}
              className="pointer-events-none absolute bottom-full mb-6 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-2 text-center text-sm font-normal leading-snug tracking-normal text-foreground shadow-md"
            >
              I was doing something useful from {clock12(hovered.start)} to{" "}
              {endClock12(hovered.end, dayEnd)}.
            </span>
          ) : null}

          {/* Today's useful total, split across the two ends of the rail: the
              time spent on the left, the share of the day on the right. Both
              fade in with the ruler, and both count only the day the rail is
              showing.

              The time is simply absent on a day with nothing logged: the share
              already says as much, and "0 min" next to "0%" would only restate
              it. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-full mt-2 whitespace-nowrap text-[10px] leading-none tracking-normal text-foreground-subtle opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100 motion-reduce:transition-none lg:left-auto lg:right-full lg:top-1/2 lg:mr-3 lg:mt-0 lg:-translate-y-1/2 lg:text-[11px]"
          >
            {total === 0 ? "" : duration(total)}
          </span>

          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-0 top-full mt-2 whitespace-nowrap text-[10px] leading-none tracking-normal text-foreground-subtle opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100 motion-reduce:transition-none lg:left-full lg:right-auto lg:top-1/2 lg:ml-3 lg:mt-0 lg:-translate-y-1/2 lg:text-[11px]"
          >
            {percent}%
          </span>
        </div>
      </div>
    </div>
  );
}

/** Lucide's `chevrons-right` / `chevrons-left`, inlined so the icons cost no
    extra dependency. */
const CHEVRONS: Record<Side, string[]> = {
  right: ["m6 17 5-5-5-5", "m13 17 5-5-5-5"],
  left: ["m11 17-5-5 5-5", "m18 17-5-5 5-5"],
};

/** Double chevron that fades in beside the label on hover, nudged in from the
    text. `right` points at the state waiting off to the right, `left` at the
    one behind.

    The +2px on `top` is an optical correction: centring on the line box leaves
    the icon a touch high, because the visual mass of the lowercase sits below
    the box's centre. */
function Arrow({ side }: { side: Side }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute top-[calc(50%+2px)] -translate-y-1/2 text-foreground-subtle opacity-0 transition duration-200 ease-out group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:transition-none ${
        side === "right"
          ? "left-full ml-3 -translate-x-1 sm:ml-4 lg:ml-5"
          : "right-full mr-3 translate-x-1 sm:mr-4 lg:mr-5"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4 sm:h-5 sm:w-5 lg:h-7 lg:w-7"
      >
        {CHEVRONS[side].map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  );
}

/** The label plus its chevron, and the slab of target the chevron lives in. The
    hover `group` is on the pointer target that wraps this, so all three answer
    to one pointer region. */
function Label({ text, arrow }: { text: string; arrow: Side }) {
  return (
    <span className="relative inline-flex items-center">
      {text}
      <span
        aria-hidden="true"
        className={`${ARROW_ZONE_CLASS} ${
          arrow === "right" ? "left-full" : "right-full"
        }`}
      />
      <Arrow side={arrow} />
    </span>
  );
}

type Gesture = {
  id: number;
  startX: number;
  dx: number;
  moved: boolean;
  /** Viewport width in px — this is one full panel. */
  width: number;
  /** Offset the track started this gesture at. */
  base: number;
};

export default function Home() {
  const [index, setIndex] = useState(0);
  const [spans, setSpans] = useState<Span[]>([]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const state = ORDER[index];
  /** Mirrors `index` so the pointer and key callbacks can read the current
      state without depending on the render they were created in. */
  const indexRef = useRef(0);

  const commit = useCallback((to: number) => {
    const el = trackRef.current;
    if (el) {
      el.style.transition = "";
      el.style.transform = `translateX(${-to * 50}%)`;
    }
    const from = indexRef.current;
    indexRef.current = to;
    setIndex(to);
    try {
      window.localStorage.setItem(STORAGE_KEY, ORDER[to]);
    } catch {
      // Storage unavailable — the state lives in memory only.
    }

    // History is written here, at the one place the switch actually moves —
    // never by watching the state. Watching it would also catch the restore on
    // page load and record that as a flip, which both split the session that
    // was still running and opened a second one behind it. A gesture that lands
    // on the state already showing changes nothing.
    if (from === to) return;

    const now = Date.now();
    setSpans((prev) => {
      const last = prev[prev.length - 1];
      // Going to work opens a stretch and leaves it open. Nothing else is
      // written for as long as it runs, however long that is or however many
      // times the page is closed in between.
      if (ORDER[to] === "useful") {
        const next: Span[] = [...prev, { start: now, end: null }];
        writeSpans(next);
        return next;
      }
      // Coming back closes it — or drops it, if it turned out too brief to
      // count, in which case the time it covered goes back to plain grey. The
      // end is capped, so a stretch left running overnight closes at eight
      // hours rather than at the moment someone finally noticed.
      if (!last || last.end !== null) return prev;
      const end = Math.min(now, last.start + MAX_USEFUL_MS);
      const next =
        end - last.start < MIN_USEFUL_MS
          ? prev.slice(0, -1)
          : [...prev.slice(0, -1), { start: last.start, end }];
      writeSpans(next);
      return next;
    });
  }, []);

  const [logOpen, setLogOpen] = useState(false);

  /** A hand edit of the log. It goes through the same three steps the switch
      itself does — new array, storage, state — so an edited stretch is written
      exactly like a recorded one, and the drawer and the rail can never be
      looking at different logs. */
  const reschedule = useCallback((index: number, end: number) => {
    setSpans((prev) => {
      const span = prev[index];
      // A running stretch has no end to move, and the five-minute floor holds
      // here as firmly as it does when the switch closes a stretch itself.
      if (!span || span.end === null) return prev;
      if (end - span.start < MIN_USEFUL_MS) return prev;
      const next = [...prev];
      next[index] = { start: span.start, end };
      writeSpans(next);
      return next;
    });
  }, []);

  /** Ends the stretch at `index` at `end` *and* keeps the part that ran on into
      the next day as a stretch of its own, opening at that midnight. Ending a
      session on the day it began is the one correction that moving an end
      cannot express: the tail belongs to the next day's list, and one record
      spread over two days has only the one end to move. The floor is the same
      as everywhere else — the switch's own rules, applied to a hand edit. */
  const split = useCallback((index: number, end: number) => {
    setSpans((prev) => {
      const span = prev[index];
      if (!span || span.end === null) return prev;
      if (end - span.start < MIN_USEFUL_MS) return prev;
      const midnight = dayBounds(end)[1];
      // Nothing ran past midnight, so there is nothing to cut off.
      if (span.end <= midnight) return prev;
      const next = [...prev];
      next.splice(
        index,
        1,
        { start: span.start, end },
        { start: midnight, end: span.end },
      );
      writeSpans(next);
      return next;
    });
  }, []);

  const remove = useCallback((index: number) => {
    setSpans((prev) => {
      if (prev[index] === undefined) return prev;
      const next = prev.filter((_, at) => at !== index);
      writeSpans(next);
      return next;
    });
  }, []);

  const openLog = useCallback(() => setLogOpen(true), []);
  const closeLog = useCallback(() => setLogOpen(false), []);

  // Restore the last state without replaying the slide on first paint.
  useEffect(() => {
    const el = trackRef.current;
    let next = 0;
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "useful") next = 1;
    } catch {
      // Storage unavailable — the default state stands.
    }

    // Restoring into "useful" means a session was in flight when the page went
    // away. Away time counts as work — the switch never left "useful" — so the
    // same stretch is reopened and simply carries on, no matter how long the
    // page was closed. Nothing needs writing to make that true: an open stretch
    // is drawn to the clock by definition.
    let logged = reconcileOpenSpan(readSpans(), next === 1);

    // Except a stretch already past the cap: that one ended itself while the
    // page was away. It comes back closed at the cap and the switch comes back
    // on "break", so the page opens showing what actually happened rather than
    // reopening a session that is already overdue by hours. The stored state is
    // corrected too, or the next load would raise it again.
    const last = logged[logged.length - 1];
    if (
      next === 1 &&
      last !== undefined &&
      last.end === null &&
      Date.now() - last.start >= MAX_USEFUL_MS
    ) {
      logged = [
        ...logged.slice(0, -1),
        { start: last.start, end: last.start + MAX_USEFUL_MS },
      ];
      next = 0;
      try {
        window.localStorage.setItem(STORAGE_KEY, ORDER[0]);
      } catch {
        // Storage unavailable — the state lives in memory only.
      }
    }

    if (next !== 0 && el) {
      el.style.transition = "none";
      el.style.transform = `translateX(${-next * 50}%)`;
      requestAnimationFrame(() => {
        el.style.transition = "";
      });
    }
    indexRef.current = next;
    // Adopting the stored state has to happen after mount: reading storage
    // while rendering would disagree with the server's HTML and break
    // hydration, so there is no render-time home for this write.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIndex(next);
    setSpans(() => dropBriefSpans(logged));
  }, []);

  // A session left running closes itself at the cap, switch and all: away time
  // counts as work, but not for ever, so a forgotten tab comes back to "break"
  // on its own. The flip goes through `commit`, which is both what slides the
  // track and the one place history is written — and it stamps the very end the
  // rail stops painting green at, so the two never disagree.
  useEffect(() => {
    const last = spans[spans.length - 1];
    if (state !== "useful" || last === undefined || last.end !== null) return;
    const wait = last.start + MAX_USEFUL_MS - Date.now();
    // A session already overdue — a tab woken from sleep, say — collapses to a
    // zero delay. Either way the flip goes through a timer rather than running
    // in the effect body, where setState would land mid-commit.
    const id = window.setTimeout(() => commit(0), Math.max(0, wait));
    return () => window.clearTimeout(id);
  }, [spans, state, commit]);

  // The arrow keys mirror the slide — but not while the log is open, where a
  // stray arrow would flip the switch behind the sheet.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (logOpen) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        commit(0);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        commit(1);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commit, logOpen]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = trackRef.current;
    const vp = viewportRef.current;
    if (!el || !vp || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }

    const width = vp.clientWidth;
    gesture.current = {
      id: event.pointerId,
      startX: event.clientX,
      dx: 0,
      moved: false,
      width,
      base: -indexRef.current * width,
    };

    el.style.transition = "none";
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    const el = trackRef.current;
    if (!g || !el || g.id !== event.pointerId) return;

    g.dx = event.clientX - g.startX;
    if (Math.abs(g.dx) > TAP_SLOP) g.moved = true;

    // Rubber-band past either end instead of letting the track run away.
    let offset = g.base + g.dx;
    if (offset > 0) offset *= 0.25;
    else if (offset < -g.width) offset = -g.width + (offset + g.width) * 0.25;

    el.style.transform = `translateX(${offset}px)`;
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    gesture.current = null;

    const threshold = Math.min(SNAP_MAX, g.width * SNAP_RATIO);
    const here = indexRef.current;
    let next = here;
    if (g.dx <= -threshold) next = 1;
    else if (g.dx >= threshold) next = 0;
    // A plain tap flips the switch; with two states that is unambiguous.
    else if (!g.moved) next = here === 0 ? 1 : 0;

    commit(next);
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    gesture.current = null;
    commit(indexRef.current);
  };

  // Only the label and its immediate surroundings respond to the pointer; the
  // rest of the screen is left alone. Capture keeps the drag alive after the
  // pointer wanders off the label.
  const hitProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onDragStart: (event: React.DragEvent<HTMLSpanElement>) =>
      event.preventDefault(),
  };

  return (
    <>
      {/* `pb` nudges the label above the geometric centre — the optical middle
          of a page sits a little high once the timeline is down there. */}
      <main className="relative isolate flex flex-1 items-center bg-background pb-12 text-foreground">
        {/* The bloom, and the one thing on the page that does not travel with
            the track: it is pinned to the screen rather than carried by a panel,
            so flipping the switch fades it in or out where it stands instead of
            dragging it across with the words. Deepest at the middle of the
            screen, thinning to nothing at every edge.

            `isolate` on `main` gives this layer something to be negative
            inside: it settles straight onto the page's own background, one step
            under everything that reads. */}
        <span
          aria-hidden="true"
          className={`pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(closest-side,var(--useful-glow),transparent)] transition-opacity duration-700 ease-out motion-reduce:transition-none ${
            state === "useful" ? "opacity-100" : "opacity-0"
          }`}
        />

        <p role="status" aria-live="polite" className="sr-only">
          {LABELS[state]}
        </p>

        {/* One track, two states side by side: slide it, or tap to flip. */}
        <div ref={viewportRef} aria-hidden="true" className="w-full overflow-x-clip">
          <div
            ref={trackRef}
            style={{ width: "200%", transform: `translateX(${-index * 50}%)` }}
            className="flex transition-transform duration-500 ease-out will-change-transform motion-reduce:transition-none"
          >
            <div className={`${PANEL_CLASS} text-foreground-muted`}>
              <span className={HIT_CLASS} {...hitProps}>
                <Label text={LABELS.idle} arrow="right" />
              </span>
            </div>
            <div className={`${PANEL_CLASS} text-foreground`}>
              <span className={HIT_CLASS} {...hitProps}>
                <Label text={LABELS.useful} arrow="left" />
              </span>
            </div>
          </div>
        </div>
      </main>

      <DayTimeline spans={spans} onOpen={openLog} />

      <Drawer
        open={logOpen}
        spans={spans}
        onClose={closeLog}
        onReschedule={reschedule}
        onSplit={split}
        onDelete={remove}
      />
    </>
  );
}

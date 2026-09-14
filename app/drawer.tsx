"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { Period, Span } from "./spans";
import {
  PERFECT_DAY_RULE,
  milestones,
  type Milestone,
  type MilestoneGroup,
} from "./achievements";
import { downloadCsv } from "./csv";
import {
  MIN_USEFUL_MS,
  PERIODS,
  averageOver,
  bestDay,
  bestStretch,
  bucketByDay,
  cappedEnd,
  clock,
  clock12,
  countsOn,
  dateRange,
  dateValue,
  dayBounds,
  daysBetween,
  duration,
  endClock12,
  heatmap,
  hourName,
  hourTotals,
  monthBars,
  peakHour,
  periodDays,
  shiftDays,
  shortDate,
  shortMonth,
  startOfDay,
  startOfWeek,
  totalOver,
  weekBars,
  weekName,
} from "./spans";

type Props = {
  open: boolean;
  /** The whole log, oldest first — the drawer reads it, never owns it. */
  spans: Span[];
  onClose: () => void;
  /** Move the end of the stretch at `index` in the log. */
  onReschedule: (index: number, end: number) => void;
  /** End the stretch at `index` at `end` and keep the rest of it as a second
      stretch, opening at the midnight that divided the two days. */
  onSplit: (index: number, end: number) => void;
  /** Drop the stretch at `index` in the log. */
  onDelete: (index: number) => void;
};

/* ── The vocabulary ────────────────────────────────────────────────────────
   Laid out after Orkest UI's primitives: one hairline border, one radius per
   role, and a quiet wash where a second shadow would only add noise. */

/** As much of a class joiner as conditional classes need; no dependency for it. */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** The one input treatment: hairline, and it darkens when it takes focus. */
const FIELD =
  "rounded-field border border-border bg-surface text-foreground transition-colors duration-150 focus:border-border-strong focus:outline-none";

/** A panel of the log — a hairline on the sheet's own surface, with the title
    standing in the margin above the figures it names. */
function Card({
  title,
  hint,
  action,
  className,
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cx(
        "overflow-hidden rounded-card border border-border bg-surface",
        className,
      )}
    >
      {/* Wraps rather than squeezes: a wide picker drops under the title
          instead of forcing the title to break. */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-5 py-3">
        <div className="flex items-baseline gap-2">
          <h3 className="text-xs font-medium tracking-wide text-foreground-muted">
            {title}
          </h3>
          {hint ? (
            <span className="text-[11px] leading-none text-foreground-faint">
              {hint}
            </span>
          ) : null}
        </div>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** One figure on a quiet tile. The fill is what makes it a card — the panel it
    sits in is the same surface. */
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-field bg-muted px-4 py-3.5">
      <div className="text-xs font-medium tracking-wide text-foreground-muted">
        {label}
      </div>
      <div className="mt-2 font-display text-xl font-semibold leading-none tracking-tight tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}

/** The circumference of a tile's ring — a 48px circle with a 4px stroke, so a
    radius of 22. Drawn as one dash this long, then shortened. */
const RING = 2 * Math.PI * 22;

/** The ring, which is the whole of the progress and the only colour the drawer
    spends on a milestone: the green the rest of the sheet keeps for useful
    time, drawn whether or not the thing is done — an arc is progress, and
    progress is green here. What a finished milestone earns on top is the tick
    at the middle of the circle.

    Nothing is ever drawn as a dot, so the milestones that are simply on or off
    — the first switch, the early start, the late night — read as an empty ring
    or a full one and nothing in between; `achievements.ts` hands those a
    progress of exactly 0 or 1. */
function Ring({ item }: { item: Milestone }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="h-12 w-12 shrink-0">
      <circle
        cx="24"
        cy="24"
        r="22"
        fill="none"
        strokeWidth="4"
        className="stroke-hover-bg-strong"
      />
      <circle
        cx="24"
        cy="24"
        r="22"
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        // One dash as long as the ring, shortened by the offset: what is left
        // drawn is exactly the arc that has been earned.
        strokeDasharray={RING}
        strokeDashoffset={RING * (1 - item.progress)}
        // Begins at twelve rather than at three, the way a dial reads.
        transform="rotate(-90 24 24)"
        className="stroke-useful-mark"
      />
      {item.reached ? (
        // Inside the ring, in the ring's own green: there is nothing more to
        // say about a milestone that is done than that it is done.
        <path
          d="m16.8 24.6 4.8 4.8 9.6-10.8"
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-useful-mark"
        />
      ) : null}
    </svg>
  );
}

/** What a milestone is called, standing on top of its ring. It is the one line
    worth lifting out of the block below: the ring is where the eye lands, and
    the name tells it what it has landed on before the reading starts. The
    `mb-3` is the same air the ring used to keep above its own name.

    The rule it asks for is spelled out for anyone the label does not reach. */
function Name({ item }: { item: Milestone }) {
  return (
    <>
      <span
        className={cx(
          "mb-3 text-sm leading-tight",
          item.reached ? "text-foreground" : "text-foreground-muted",
        )}
      >
        {item.name}
      </span>
      <span className="sr-only">{item.goal}</span>
    </>
  );
}

/** What a milestone has to say for itself, under the ring: the rule it asks for
    in a few words when the name does not already carry it, and then the one
    thing the reader wants next — the day it was reached, or how far along it
    is. Shared by the upright card and the ladder, which differ only in how they
    are walked. */
function Face({ item }: { item: Milestone }) {
  return (
    <>
      {item.rule === undefined ? null : (
        <div
          className={cx(
            "mt-1.5 text-xs leading-snug",
            item.reached ? "text-foreground-faint" : "text-foreground-subtle",
          )}
        >
          {item.rule}
        </div>
      )}
      {item.detail === "" ? null : (
        <div
          className={cx(
            "mt-1.5 text-xs leading-snug tabular-nums",
            item.reached ? "text-foreground-faint" : "text-foreground-subtle",
          )}
        >
          {item.detail}
        </div>
      )}
    </>
  );
}

/** How much air a card keeps above the ring and below the words.

    A share of the card's own width rather than a number, because the padding is
    the only thing that can grow when the card does: the ring and the words are
    the same size in every column, so a wide card is not a roomier one — it is
    the same small cluster in a bigger box, and the box looks emptier the wider
    it gets. Spending the width on the padding keeps the card's proportions
    instead of its size, and the card grows taller to hold it.

    The constant is half of what the name, the ring and the two lines under it
    come to, so taking it off a little more than half the width leaves about the
    air a square card would have had — and the surplus is the slight portrait
    lean these cards wear at every size. The floor is the 1.5rem the narrowest
    column wants: under that the padding stops following the width and stands
    still. */
const CARD_AIR = "py-[max(1.5rem,55cqw_-_3.75rem)]";

/** One milestone. Its width comes from the column it is laid into, and its
    height is whatever the ring, the words and `CARD_AIR` come to — so the card
    keeps its proportions as the column widens rather than a hole between the
    ring and the words.

    The `@container` is the card's column, so `cqw` above reads as the card's
    width; a container cannot query the size of itself, which is why the card
    sits one element inside.

    Nothing is centred down the card: the name stands on the top padding, the
    ring hangs under it and the words stand on the floor. The names are all one
    line — the longest is the one that fits the narrowest column — so the rings
    of a row line up across it, and the last line of each card meets the bottom
    edge at the same height whatever it has to say up there. */
function MilestoneTile({ item }: { item: Milestone }) {
  return (
    <div className="@container flex w-full">
      <div
        className={cx(
          "flex w-full flex-col items-center rounded-field bg-muted px-3 text-center",
          CARD_AIR,
        )}
      >
        <Name item={item} />
        <Ring item={item} />
        {/* The name stands on the top padding, the ring hangs under it and the
            words stand on the floor, so the last line of every card meets the
            bottom edge at the same height whatever the card has to say. */}
        <div className="mt-auto flex w-full flex-col items-center">
          <Face item={item} />
        </div>
      </div>
    </div>
  );
}

/** A group whose milestones are rungs of one ladder — 3, 7, 14 … days; a
    quarter of an hour, an hour, three … — walked one at a time rather than laid
    out side by side. It opens on the rung still to be reached, since finishing
    one is what brings the next forward, and rests on the last rung once every
    one of them is underfoot. The arrows are there for looking back up at what
    has been climbed.

    It is the same card as a lone milestone — same width, same shape — with the
    arrows tucked inside its own edges rather than standing beside it, so a
    ladder and a single milestone sit in one run without a seam between them. */
function MilestoneLadder({ group }: { group: MilestoneGroup }) {
  // Null until an arrow is used, so the rung it opens on is worked out afresh
  // from the log — the one that is actually next, not the one after whatever
  // was last looked at.
  const [picked, setPicked] = useState<number | null>(null);
  const next = group.items.findIndex((item) => !item.reached);
  const at = picked ?? (next === -1 ? group.items.length - 1 : next);
  const last = group.items.length - 1;

  const arrow = (side: "left" | "right") => (
    <button
      type="button"
      onClick={() => setPicked(side === "left" ? at - 1 : at + 1)}
      disabled={side === "left" ? at === 0 : at === last}
      aria-label={side === "left" ? "Previous milestone" : "Next milestone"}
      // Held at the ends of the ladder as an invisible bar rather than
      // dropped, so the rung does not shift sideways as it is reached.
      className="flex w-6 shrink-0 items-center justify-center rounded-field text-foreground-faint transition-colors hover:bg-hover-bg-strong hover:text-foreground disabled:pointer-events-none disabled:opacity-0"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path d={side === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
      </svg>
    </button>
  );

  return (
    <div className="@container flex w-full">
      <div
        className={cx(
          "flex w-full items-stretch rounded-field bg-muted px-1",
          CARD_AIR,
        )}
      >
        {arrow("left")}
        <div className="flex min-w-0 flex-1 flex-col items-center text-center">
          <Name item={group.items[at]} />
          <Ring item={group.items[at]} />
          {/* Like a lone milestone, the name stands on the top padding, the
              ring hangs below it and the words stand on the floor, with the
              dots printed under them. */}
          <div className="mt-auto flex w-full flex-col items-center">
            <Face item={group.items[at]} />
            {/* Where on the ladder this rung sits: one dot a rung, green for
                the ones already underfoot. Pinned to the foot of the card,
                which is where a row of dots belongs — and it keeps them on one
                line across every ladder, whatever the rung above them has to
                say. */}
            <div className="flex items-center gap-1 pt-3">
              {group.items.map((rung, index) => (
                <span
                  key={rung.id}
                  aria-hidden="true"
                  className={cx(
                    "h-1 w-1 rounded-full",
                    index === at
                      ? "bg-foreground"
                      : rung.reached
                        ? "bg-useful-mark"
                        : "bg-border-strong",
                  )}
                />
              ))}
            </div>
          </div>
        </div>
        {arrow("right")}
      </div>
    </div>
  );
}

/** Two or three choices, one of them taken: a sunken track with the chosen
    segment lifted back up onto the surface. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (key: T) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex items-center gap-0.5 rounded-field bg-muted p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          role="tab"
          aria-selected={option.key === value}
          onClick={() => onChange(option.key)}
          className={cx(
            "rounded-chip px-2.5 py-1.5 text-xs font-medium leading-none transition-colors",
            option.key === value
              ? "bg-surface text-foreground shadow-card"
              : "text-foreground-muted hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Orkest UI's Tooltip, rebuilt without Radix: the same inverted pill, the same
    300ms of patience before the first one appears, the same 6px of air between
    it and what it names. It is portalled into the body because these charts
    live in an `overflow-hidden` card inside a scrolling sheet — painted in
    place it would be clipped the moment a chart reached an edge, which is
    precisely why the original portals its content too. */
function BarTip({ text, at }: { text: string; at: { x: number; y: number } }) {
  return createPortal(
    <div
      role="tooltip"
      // The class does the plain centering; this overrides it with the same
      // centering held 8px inside the viewport, because the outermost bars of a
      // 24-bar row sit right against an edge and a centred pill would hang off
      // it. Radix calls this avoid-collisions; the browser does it in one
      // expression here, since a percentage in `translate` resolves against the
      // pill's own width — which is the one thing the clamp needs to know.
      style={{
        left: at.x,
        top: at.y - 6,
        translate: `clamp(calc(8px - ${at.x}px), -50%, calc(100vw - 8px - ${at.x}px - 100%)) -100%`,
      }}
      className="animate-fade-slide-in pointer-events-none fixed z-40 max-w-xs -translate-x-1/2 -translate-y-full rounded-field bg-foreground px-2.5 py-1 text-xs font-medium leading-tight text-background shadow-pop motion-reduce:animate-none"
    >
      {text}
    </div>,
    document.body,
  );
}

/** The hover label both charts share: one pill, portalled, the first one
    arriving after 300ms of patience and every one after it at once — so
    sweeping across a chart reads as a single label moving rather than as a
    series of separate ones. */
function useTip() {
  const [tip, setTip] = useState<{
    text: string;
    at: { x: number; y: number };
  } | null>(null);
  const wait = useRef<number | null>(null);

  // A label still counting down has nothing left to label once the chart goes.
  useEffect(
    () => () => {
      if (wait.current !== null) window.clearTimeout(wait.current);
    },
    [],
  );

  const leave = () => {
    if (wait.current !== null) {
      window.clearTimeout(wait.current);
      wait.current = null;
    }
    setTip(null);
  };

  /** `y` moves the pill off the anchor's top edge, for a chart whose label
      belongs beside a point rather than above the column that holds it. */
  const enter = (
    event: ReactPointerEvent<HTMLElement>,
    text: string,
    y?: number,
  ) => {
    const box = event.currentTarget.getBoundingClientRect();
    const at = { x: box.left + box.width / 2, y: y ?? box.top };
    if (wait.current !== null) {
      window.clearTimeout(wait.current);
      wait.current = null;
    }
    if (tip !== null) {
      setTip({ text, at });
      return;
    }
    wait.current = window.setTimeout(() => setTip({ text, at }), 300);
  };

  return { tip, enter, leave };
}

/** The same totals drawn as a line, one point to a week or a month. The path
    stretches to whatever width it is given — the only way to fill a box whose
    width is not known until it is measured — which would stretch its stroke
    and its dots along with it; hence `vector-effect` on the former and plain
    elements for the latter, where a dot stays a dot at any width. */
function Line({
  values,
  titles,
  labels,
  marked,
}: {
  values: number[];
  titles: string[];
  labels?: string[];
  marked?: number;
}) {
  const { tip, enter, leave } = useTip();
  const tallest = Math.max(...values, 1);
  const last = Math.max(values.length - 1, 1);
  // Shares of the box: `x` across it, `y` down from its top. The 2% kept clear
  // at either end is what a stroke on the outermost value would otherwise be
  // sliced by.
  const points = values.map((value, index) => ({
    x: 2 + (index / last) * 96,
    y: 98 - (value / tallest) * 96,
  }));
  // Each target reaches halfway to its neighbours and runs off both ends, so
  // every part of the width answers to some point and none falls between two.
  const edges = points.map((point, index) => ({
    left: index === 0 ? 0 : (points[index - 1].x + point.x) / 2,
    right: index === last ? 100 : (point.x + points[index + 1].x) / 2,
  }));

  return (
    <div>
      <div className="relative h-28" onPointerLeave={leave}>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="absolute inset-0 h-full w-full"
        >
          {/* The baseline the line is read against, level with a point of zero. */}
          <line
            x1="0"
            y1="98"
            x2="100"
            y2="98"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            className="stroke-border"
          />
          <polyline
            points={points.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className="stroke-useful-mark"
          />
        </svg>
        {points.map((point, index) => (
          <span
            key={index}
            aria-hidden="true"
            style={{ left: `${point.x}%`, top: `${point.y}%` }}
            // The one still running is a little larger, the way the bar that
            // carried it used to be drawn solid.
            className={cx(
              "absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-useful-mark",
              index === marked ? "h-2 w-2" : "h-1.5 w-1.5",
            )}
          />
        ))}
        {edges.map((edge, index) => (
          <div
            key={index}
            role="img"
            aria-label={titles[index]}
            style={{ left: `${edge.left}%`, right: `${100 - edge.right}%` }}
            onPointerEnter={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              enter(
                event,
                titles[index],
                box.top + (points[index].y / 100) * box.height,
              );
            }}
            className="absolute inset-y-0 cursor-pointer"
          />
        ))}
      </div>
      {labels ? (
        // One label per point, at the point's own share of the box: the axis
        // answers to the same geometry the line does, so a label sits under
        // its point however wide the card runs — even columns would drift
        // apart from the points as the box widened.
        <div className="relative mt-2 h-3">
          {labels.map((label, index) => (
            <span
              key={index}
              style={{ left: `${points[index].x}%` }}
              className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-center text-[10px] leading-none text-foreground-faint"
            >
              {label}
            </span>
          ))}
        </div>
      ) : null}
      {tip === null ? null : <BarTip text={tip.text} at={tip.at} />}
    </div>
  );
}

/** A week of hours: seven rows from Monday, twenty-four cells across. Depth of
    colour is the useful time in a cell measured against the fullest cell in the
    grid — the only scale that keeps a history a few days long from reading as
    one lonely square. */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The hours named under the grid: the same every-sixth-one marks the rail
    carries, read off the 12-hour face. Both ends of the day are the same mark,
    which is what midnight looks like on a dial. */
const AXIS_HOURS = [0, 6, 12, 18, 24];

/** Five steps rather than a continuous ramp: a shade that answers to a fraction
    reads as noise, and there is nothing in it that a second shade would say. */
const HEAT_STEPS = [
  "bg-muted",
  "bg-useful-mark/20",
  "bg-useful-mark/40",
  "bg-useful-mark/65",
  "bg-useful-mark",
];

function heatStep(value: number, fullest: number): number {
  if (value <= 0) return 0;
  const ratio = value / fullest;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function Heat({ grid }: { grid: number[][] }) {
  const { tip, enter, leave } = useTip();
  const fullest = Math.max(...grid.flat(), 1);

  return (
    <div>
      <div className="flex flex-col gap-[3px]" onPointerLeave={leave}>
        {grid.map((row, day) => (
          <div key={WEEKDAYS[day]} className="flex items-center gap-[3px]">
            <span className="w-7 shrink-0 text-[10px] leading-none text-foreground-faint">
              {WEEKDAYS[day]}
            </span>
            <div className="flex flex-1 gap-[3px]">
              {row.map((value, hour) => {
                const label = `${WEEKDAYS[day]} ${hourName(hour)} · ${duration(value)}`;
                return (
                  <span
                    key={hour}
                    // A cell holding nothing has nothing to announce, and there
                    // are a hundred and sixty-eight of these.
                    role="img"
                    aria-label={value > 0 ? label : undefined}
                    aria-hidden={value > 0 ? undefined : true}
                    onPointerEnter={(event) => enter(event, label)}
                    className={cx(
                      "h-4 flex-1 cursor-pointer rounded-[3px]",
                      HEAT_STEPS[heatStep(value, fullest)],
                    )}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[3px]">
        <span className="w-7 shrink-0" />
        <div className="flex flex-1 justify-between whitespace-nowrap text-[10px] leading-none text-foreground-faint">
          {AXIS_HOURS.map((hour) => (
            <span key={hour}>{hourName(hour)}</span>
          ))}
        </div>
      </div>
      {tip === null ? null : <BarTip text={tip.text} at={tip.at} />}
    </div>
  );
}

/** `+3 h 10 min (26%)` — how a window sits against the one before it. */
function delta(current: number, previous: number): string {
  const diff = current - previous;
  if (diff === 0) return "no change";
  const sign = diff > 0 ? "+" : "−";
  const percent =
    previous > 0
      ? ` (${sign}${Math.round((Math.abs(diff) / previous) * 100)}%)`
      : "";
  return `${sign}${duration(Math.abs(diff))}${percent}`;
}

/** One row of the day's list: a stretch already cut down to that day, together
    with the two ends that say whether an edge belongs to the day rather than to
    the stretch. A session that ran over midnight has a row on either side of it,
    and each row is only half of the story. */
type Row = {
  span: Span;
  index: number;
  /** The day this row belongs to, as its local midnight. A time typed into the
      row is read on this day, which is what lets the first half of a session
      that ran over midnight be ended before midnight — an edit that cuts the
      session in two at the midnight below it. */
  dayStart: number;
  start: number;
  end: number;
  /** The day's own last minute, which is what an end cut off at midnight is
      written against. */
  dayEnd: number;
  fromEarlier: boolean;
  intoLater: boolean;
};

/** The arrow between a stretch's two times, drawn rather than typed: a row that
    is only a fragment of a longer session gets a dashed shaft, which is the one
    signal that reads the same whether the missing part is before the row or
    after it. The `→` character has nothing to say about that. */
function Arrow({ fragment }: { fragment: boolean }) {
  return (
    <svg
      viewBox="0 0 16 8"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-2 w-4 shrink-0 text-foreground-faint"
    >
      <path d="M1 4h11" strokeDasharray={fragment ? "2 2.5" : undefined} />
      <path d="M12 1.5 15 4l-3 2.5" />
    </svg>
  );
}

export default function Drawer({
  open,
  spans,
  onClose,
  onReschedule,
  onSplit,
  onDelete,
}: Props) {
  // Today is what a log is opened to check, so the averages start there
  // instead of on the week.
  const [period, setPeriod] = useState<Period>("day");
  const [chart, setChart] = useState<"week" | "month">("week");
  /** Which day the stretch list is showing, as a local midnight. `null` means
      today, and it is kept as a flag rather than as a captured timestamp so the
      list goes on meaning *today* once the clock rolls past midnight. */
  const [day, setDay] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [refused, setRefused] = useState<{
    index: number;
    message: string;
    nonce: number;
  } | null>(null);
  /** Bumped on every refusal, so a second bad edit remounts the field even when
      it happens in the same millisecond as the first. */
  const refusals = useRef(0);

  // The clock is read once the sheet is open rather than during a render — a
  // render has to stay pure and the time is not — and then kept honest with a
  // slow beat, so a sheet left open does not quietly drift. Closed, there is
  // nothing to measure; that is also what the server renders, so the first
  // paint agrees on both sides.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    const tick = () => setNow(Date.now());
    // Deferred by a hair rather than run in the effect body, where a
    // synchronous write would land mid-commit.
    const first = window.setTimeout(tick, 0);
    const beat = window.setInterval(tick, 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(beat);
    };
  }, [open]);

  // Closing also puts away anything half-asked: a stale "Delete?" or a stale
  // complaint has no business greeting the next open.
  const close = useCallback(() => {
    setConfirming(null);
    setRefused(null);
    // A log is opened to check today, so it does not come back up wearing
    // whichever day was being browsed last time.
    setDay(null);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  // A complaint is about the edit just attempted, so the next click anywhere
  // retires it — there is nothing to hunt for, and no stale verdict left
  // sitting under a row the reader has already moved on from. Captured on the
  // way down so that whatever was clicked still gets the click.
  useEffect(() => {
    if (!open || refused === null) return;
    const dismiss = () => setRefused(null);
    window.addEventListener("pointerdown", dismiss, true);
    return () => window.removeEventListener("pointerdown", dismiss, true);
  }, [open, refused]);

  const buckets = useMemo(
    () => (now === null ? null : bucketByDay(spans, now)),
    [spans, now],
  );

  /** Everything that does not depend on the period selector. */
  const figures = useMemo(() => {
    if (now === null || buckets === null) return null;
    const today = startOfDay(now);
    return {
      today,
      todayUseful: buckets.get(today)?.useful ?? 0,
      hours: hourTotals(spans, now),
      heat: heatmap(spans, now),
      best: bestStretch(spans, now),
      topDay: bestDay(buckets),
      weeks: weekBars(buckets, now, 8),
      months: monthBars(buckets, now, 12),
    };
  }, [spans, buckets, now]);

  /** The day the stretch list is on — today until another one is picked. */
  const view = day ?? figures?.today ?? null;

  /** The stretches that count towards that day, in order, each already cut down
      to the day it is listed under. A session that ran over midnight is a row on
      both days — `11:00 pm → midnight` on the first, `12:00 am → 2:00 am` on
      the second — so the rows of a day add up to exactly the total in the
      card's own header.
      `index` is the stretch's place in the log, which is what an edit or a
      deletion travels by. */
  const rows = useMemo(() => {
    if (now === null || view === null) return [];
    const [from, to] = dayBounds(view);
    const out: Row[] = [];

    spans.forEach((span, index) => {
      if (!countsOn(span, from, to, now)) return;
      const real = cappedEnd(span, now);
      const start = Math.max(span.start, from);
      const end = Math.min(real, to);
      out.push({
        span,
        index,
        dayStart: from,
        start,
        end,
        dayEnd: to,
        // Which ends of this row are the day's edge rather than the stretch's.
        fromEarlier: start > span.start,
        intoLater: end < real,
      });
    });

    return out;
  }, [spans, now, view]);

  /** The oldest day the log reaches back to, which is as far back as the
      stepper offers to go: before it there is nothing to look at. */
  const earliest = useMemo(() => {
    if (buckets === null) return null;
    let first: number | null = null;
    for (const key of buckets.keys()) {
      if (first === null || key < first) first = key;
    }
    return first;
  }, [buckets]);

  const averages = useMemo(() => {
    if (now === null || buckets === null) return null;
    return averageOver(periodDays(spans, period, now), buckets);
  }, [spans, buckets, period, now]);

  /** The period in progress against the same run of days one week (or month)
      earlier: comparing a half-finished week against a whole one would read as
      a collapse rather than as a week. */
  const compare = useMemo(() => {
    if (now === null || buckets === null) return null;
    const today = startOfDay(now);

    const weekFrom = startOfWeek(now);
    const week = totalOver(daysBetween(weekFrom, today), buckets);
    const weekBefore = totalOver(
      daysBetween(shiftDays(weekFrom, -7), shiftDays(today, -7)),
      buckets,
    );

    const d = new Date(today);
    const monthFrom = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const elapsed = daysBetween(monthFrom, today).length;
    const beforeFrom = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
    const beforeLast = new Date(d.getFullYear(), d.getMonth(), 0).getTime();
    const month = totalOver(daysBetween(monthFrom, today), buckets);
    const monthBefore = totalOver(
      daysBetween(
        beforeFrom,
        Math.min(shiftDays(beforeFrom, elapsed - 1), beforeLast),
      ),
      buckets,
    );

    return { week, weekBefore, month, monthBefore };
  }, [buckets, now]);

  /** The milestones, grouped as they are shown, and the tally that heads them:
      how many are behind the reader out of how many there are. */
  const board = useMemo(
    () =>
      now === null || buckets === null ? [] : milestones(spans, buckets, now),
    [spans, buckets, now],
  );
  const boardItems = board.flatMap((group) => group.items);
  const boardEarned = boardItems.filter((item) => item.reached).length;

  /** Settles the end of the stretch a row stands for. The typed time is read on
      the day the row belongs to — that day's midnight is the anchor — so the
      earlier half of a session that ran over midnight can be ended before
      midnight: a stretch running `11:00 pm → 2:00 am`, ended at `11:45 pm` on
      the first day, becomes `11:00 pm → 11:45 pm` there, while the tail goes on
      holding `12:00 am → 2:00 am` on the second. That is why this edit splits
      the record instead of moving its end: one stretch spread over two days has
      only the one end to move, and the two halves have to end up as two
      stretches to each keep a time of their own. */
  const onEditEnd = (row: Row, value: string) => {
    if (now === null) return;
    const { span, index } = row;

    const refuse = (message: string) => {
      refusals.current += 1;
      setRefused({ index, message, nonce: refusals.current });
    };

    const [hours, minutes] = value.split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      refuse("That is not a time.");
      return;
    }

    const d = new Date(row.dayStart);
    const end = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      hours,
      minutes,
    ).getTime();

    // The rules the log keeps everywhere else, enforced here as well so a hand
    // edit cannot talk it into something the switch itself would have refused:
    // after the start and at least five minutes long, nothing in the future, and
    // nothing that runs into the stretch behind it. How long it may run is not
    // one of them — the eight hours bound what a forgotten switch can write, not
    // what a correction may say.
    if (end < span.start) {
      refuse("That is before the stretch started.");
      return;
    }
    if (end - span.start < MIN_USEFUL_MS) {
      refuse("A stretch needs at least 5 minutes.");
      return;
    }
    if (end > now) {
      refuse("That has not happened yet.");
      return;
    }
    const next = spans.at(index + 1)?.start;
    if (next !== undefined && end > next) {
      refuse("That runs into the next stretch.");
      return;
    }

    setRefused(null);
    // Ending the half that ran on into the next day leaves the rest of that
    // session behind on the next day's list, so the record is cut in two at
    // midnight rather than shortened.
    if (row.intoLater) onSplit(index, end);
    else onReschedule(index, end);
  };

  /** The latest an end may be set to: the clock, and the next stretch, whichever
      comes first. Nothing bounds it from below but the stretch's own start. */
  const ceilingFor = (index: number): number =>
    Math.min(
      now ?? Number.POSITIVE_INFINITY,
      spans.at(index + 1)?.start ?? Number.POSITIVE_INFINITY,
    );

  /** Move the list to another day. Landing back on today clears the pick rather
      than pinning today's midnight, so today goes on meaning today. */
  const goToDay = (next: number | null) => {
    setConfirming(null);
    setRefused(null);
    setDay(next === null || next === figures?.today ? null : next);
  };

  /** One day either way, stopped at both ends of the log: nothing lies beyond
      the oldest stretch, and nothing lies past today. */
  const stepDay = (delta: number) => {
    if (view === null || figures === null) return;
    const next = shiftDays(view, delta);
    if (next > figures.today) return;
    if (earliest !== null && next < earliest) return;
    goToDay(next);
  };

  const hours = figures?.hours ?? [];
  const peak = peakHour(hours);
  const dayUseful =
    buckets === null || view === null ? 0 : (buckets.get(view)?.useful ?? 0);
  const onToday = figures !== null && view !== null && view === figures.today;
  const chartBars =
    figures === null ? [] : chart === "week" ? figures.weeks : figures.months;
  const chartValue = (chart === "week" ? compare?.week : compare?.month) ?? 0;
  const chartBefore =
    (chart === "week" ? compare?.weekBefore : compare?.monthBefore) ?? 0;
  const trendCaption =
    compare === null
      ? ""
      : chartValue === 0 && chartBefore === 0
        ? `Nothing logged in the same days last ${chart} either.`
        : `vs same days last ${chart}: ${delta(chartValue, chartBefore)}`;

  return (
    <div
      className={cx("fixed inset-0 z-30", !open && "pointer-events-none")}
      aria-hidden={!open}
      inert={!open}
    >
      {/* The scrim: quiet enough to leave the switch legible behind it. */}
      <div
        onClick={close}
        className={cx(
          "absolute inset-0 bg-overlay transition-opacity duration-300 ease-out motion-reduce:transition-none",
          open ? "opacity-100" : "opacity-0",
        )}
      />

      {/* Nearly the whole screen wide: a frame's width of page is left showing
          down each side, so the sheet still reads as a sheet rather than as a
          new page. The figures inside stop widening long before it does — a
          table with the times at one edge and the buttons at the other is
          harder to read than a narrower one. */}
      <div className="absolute inset-x-1 bottom-0 flex justify-center sm:inset-x-1.5 lg:inset-x-2">
        <section
          role="dialog"
          aria-modal="true"
          aria-label="Your log"
          className={cx(
            "flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-sheet border border-b-0 border-border bg-surface shadow-sheet transition-transform duration-500 ease-out motion-reduce:transition-none",
            open ? "translate-y-0" : "translate-y-full",
          )}
        >
          <div className="flex justify-center pt-2">
            <span
              aria-hidden="true"
              className="h-1 w-10 rounded-full bg-hover-bg-strong"
            />
          </div>

          <header className="mx-auto flex w-full max-w-[1600px] items-start justify-between gap-6 px-5 pb-2 pt-1 sm:px-6 lg:px-8">
            <div>
              <h2 className="font-sans text-lg font-medium leading-tight tracking-tight text-foreground">
                Your log
              </h2>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-field text-foreground-muted transition-colors hover:bg-hover-bg hover:text-foreground"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                className="h-4 w-4"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </header>

          <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto border-t border-border">
            <div className="mx-auto w-full max-w-[1600px] px-5 pb-12 pt-4 sm:px-6 lg:px-8">
              {/* Two columns once there is room for two; one before that, in
                  the order of how often the thing is looked at. */}
              <div className="grid items-start gap-5 xl:grid-cols-12">
                <Card
                  className="xl:col-span-7"
                  title="Stretch by stretch"
                  hint={dayUseful > 0 ? duration(dayUseful) : undefined}
                  // The day's own pages: a chevron either side for stepping
                  // through the log, and the date itself as a field so a day
                  // months back is one pick rather than thirty taps.
                  action={
                    view === null ? undefined : (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => stepDay(-1)}
                          disabled={earliest === null || view <= earliest}
                          aria-label="Previous day"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-chip text-foreground-muted transition-colors hover:bg-hover-bg hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.5}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-4 w-4"
                            aria-hidden="true"
                          >
                            <path d="m15 18-6-6 6-6" />
                          </svg>
                        </button>
                        <input
                          type="date"
                          value={dateValue(view)}
                          min={earliest === null ? undefined : dateValue(earliest)}
                          max={dateValue(figures?.today ?? view)}
                          onChange={(event) => {
                            const [y, m, d] = event.target.value
                              .split("-")
                              .map(Number);
                            if (
                              !Number.isFinite(y) ||
                              !Number.isFinite(m) ||
                              !Number.isFinite(d)
                            ) {
                              return;
                            }
                            goToDay(new Date(y, m - 1, d).getTime());
                          }}
                          aria-label="Day"
                          className={cx(
                            FIELD,
                            // Sized to what it holds rather than to a guess at
                            // how wide a date is: the native field already has
                            // an intrinsic width of its own, and pinning one
                            // just leaves all the slack sitting between the day
                            // and the calendar button. `field-sizing` tightens
                            // that further wherever it is supported; letting the
                            // width alone is the fallback.
                            "h-8 w-auto shrink-0 px-2 text-xs tabular-nums field-sizing-content",
                          )}
                        />
                        <button
                          type="button"
                          onClick={() => stepDay(1)}
                          disabled={figures === null || view >= figures.today}
                          aria-label="Next day"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-chip text-foreground-muted transition-colors hover:bg-hover-bg hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.5}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-4 w-4"
                            aria-hidden="true"
                          >
                            <path d="m9 18 6-6-6-6" />
                          </svg>
                        </button>
                      </div>
                    )
                  }
                >
                  {rows.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-border bg-surface/60 px-6 py-12 text-center">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-7 w-7 text-foreground-faint"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7.5V12l3 1.75" />
                      </svg>
                      <p className="text-sm text-foreground-muted">
                        {onToday
                          ? "Nothing logged as useful yet today."
                          : "Nothing logged as useful that day."}
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <ul>
                        {rows.map((row) => {
                          const { span, index, dayStart, start, end, dayEnd } =
                            row;
                          // A row is a fragment when one of its edges is the
                          // day's rather than the stretch's. Only an edge that
                          // is the stretch's own can be running, or carry a
                          // field to edit it with.
                          const fragment = row.fromEarlier || row.intoLater;
                          const running = span.end === null && !row.intoLater;
                          const closed = span.end ?? now ?? span.start;
                          const elapsed = duration(end - start);
                          const refusedHere =
                            refused?.index === index ? refused : null;
                          const asking = confirming === index;

                          return (
                            // Hairline-separated rows, the way a table reads —
                            // the whole row answers to the pointer.
                            <li
                              key={span.start}
                              className="border-b border-border px-3 py-2.5 transition-colors last:border-b-0 hover:bg-hover-bg"
                            >
                              <div className="flex items-center gap-3 text-sm">
                                <span
                                  className={cx(
                                    "shrink-0 tabular-nums",
                                    // An edge that is only the day's boundary is
                                    // muted, so the times the stretch really has
                                    // are the ones that stand out.
                                    row.fromEarlier
                                      ? "text-foreground-muted"
                                      : "text-foreground",
                                  )}
                                >
                                  {clock12(start)}
                                </span>
                                <Arrow fragment={fragment} />

                                {running ? (
                                  // The one place the log says a stretch is
                                  // still open: a badge rather than a field,
                                  // because there is nothing to edit yet. It
                                  // carries its own tally, so the row can be
                                  // read without looking to the right edge.
                                  <span className="inline-flex h-9 shrink-0 items-center gap-2 rounded-field bg-muted px-2.5 text-xs font-medium text-foreground-muted">
                                    <span
                                      aria-hidden="true"
                                      className="h-1.5 w-1.5 rounded-full bg-useful-mark"
                                    />
                                    Running
                                    <span className="tabular-nums">
                                      {elapsed}
                                    </span>
                                  </span>
                                ) : row.intoLater && span.end === null ? (
                                  // A stretch still open has no end to move, so
                                  // the day it ran on into stays read-only here:
                                  // the box says where the day stopped and
                                  // nothing more. Switching back is what closes
                                  // it — then there is an end to correct.
                                  <span className="inline-flex h-9 w-[7.5rem] shrink-0 items-center justify-center rounded-field border border-dashed border-border-strong text-center tabular-nums text-foreground-muted">
                                    {endClock12(end, dayEnd)}
                                  </span>
                                ) : (
                                  // The end, as a field on this row's own day.
                                  // On the day a stretch ran on into, the end
                                  // it really has is not this day's to hold — a
                                  // time field cannot spell midnight — so the field
                                  // is left empty and the day's edge is laid
                                  // over it for as long as the pointer is only
                                  // passing through.
                                  <span className="relative flex h-9 w-[7.5rem] shrink-0">
                                    <input
                                      // The key carries the day as well as the
                                      // refusal count. The same stretch is a row
                                      // on the day it began and on the day it ran
                                      // on into, and without the day in the key
                                      // React reuses the one field for both: the
                                      // second day's row has an end of its own in
                                      // there (`02:00`), and a field that has been
                                      // typed into keeps it — so the day's edge
                                      // on the first day came up wearing the other
                                      // day's end. A key per day keeps this side
                                      // blank until it is really typed into.
                                      key={`end-${index}-${dayStart}-${
                                        refusedHere?.nonce ?? 0
                                      }`}
                                      type="time"
                                      step={60}
                                      defaultValue={
                                        row.intoLater ? "" : clock(closed)
                                      }
                                      // Only meaningful when the stretch began
                                      // on this day, which is the only floor the
                                      // field can express; a stretch that ran
                                      // over midnight has its floor on the day
                                      // before, so the check inside `onEditEnd`
                                      // remains the one that decides.
                                      min={
                                        startOfDay(span.start) === dayStart
                                          ? clock(span.start + MIN_USEFUL_MS)
                                          : undefined
                                      }
                                      // A stretch running into the next day can
                                      // only be ended before this one is out, so
                                      // the ceiling is this midnight as well.
                                      max={clock(
                                        row.intoLater
                                          ? Math.min(
                                              ceilingFor(index),
                                              dayEnd - 60_000,
                                            )
                                          : ceilingFor(index),
                                      )}
                                      onChange={(event) =>
                                        onEditEnd(row, event.target.value)
                                      }
                                      aria-label={`End of the stretch starting ${clock12(
                                        span.start,
                                      )} on ${shortDate(dayStart)}`}
                                      className={cx(
                                        FIELD,
                                        "peer h-full w-full px-2 text-center tabular-nums",
                                        // Dashed, because it is the day that
                                        // stops here and not the stretch.
                                        row.intoLater &&
                                          "border-dashed border-border-strong",
                                      )}
                                    />
                                    {row.intoLater ? (
                                      // Sits exactly over the empty field, so
                                      // the day's edge reads as one and the row
                                      // does not offer up the other end of a
                                      // session just because it was pointed at.
                                      // Only taking focus — which is what
                                      // typing needs — reveals the field.
                                      // `inset-px` keeps the field's own
                                      // hairline showing.
                                      <span
                                        aria-hidden="true"
                                        className="pointer-events-none absolute inset-px flex items-center justify-center rounded-field bg-surface tabular-nums text-foreground-muted transition-opacity duration-150 peer-focus:opacity-0 motion-reduce:transition-none"
                                      >
                                        {endClock12(end, dayEnd)}
                                      </span>
                                    ) : null}
                                  </span>
                                )}

                                {/* A running stretch already carries its tally
                                    in the badge, so it is not said twice. */}
                                {running ? null : (
                                  <span className="ml-auto shrink-0 tabular-nums text-foreground-muted">
                                    {elapsed}
                                  </span>
                                )}

                                {running ? null : asking ? (
                                  <span className="flex shrink-0 items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        onDelete(index);
                                        setConfirming(null);
                                      }}
                                      className="rounded-chip bg-muted px-2.5 py-1.5 text-xs font-medium leading-none text-foreground transition-colors hover:bg-hover-bg-strong"
                                    >
                                      Delete
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirming(null)}
                                      className="rounded-chip px-2.5 py-1.5 text-xs leading-none text-foreground-muted transition-colors hover:text-foreground"
                                    >
                                      Keep
                                    </button>
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConfirming(index)}
                                    aria-label={`Delete the stretch starting ${clock12(
                                      span.start,
                                    )}`}
                                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-chip text-foreground-faint transition-colors hover:bg-hover-bg-strong hover:text-foreground"
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth={1.5}
                                      strokeLinecap="round"
                                      className="h-4 w-4"
                                    >
                                      <path d="M18 6 6 18" />
                                      <path d="m6 6 12 12" />
                                    </svg>
                                  </button>
                                )}

                                {fragment ? (
                                  // A dashed shaft says "this row is part of
                                  // something longer" to the eye and nothing at
                                  // all to a screen reader, so the missing side
                                  // is spelled out for it.
                                  <span className="sr-only">
                                    {row.fromEarlier
                                      ? "The stretch began the day before."
                                      : "The stretch runs on into the next day."}
                                  </span>
                                ) : null}
                              </div>

                              {refusedHere ? (
                                <p className="mt-2 rounded-chip bg-muted px-3 py-1.5 text-xs leading-snug text-foreground">
                                  {refusedHere.message}
                                </p>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  {/* The floor under the whole list, said once the way the
                      board says what makes a day perfect: a stretch shorter
                      than the minimum is dropped rather than drawn, and a
                      reader who switched for two minutes and then found no row
                      for it deserves to know why. */}
                  <p className="mt-5 text-sm leading-snug text-foreground-muted">
                    Stretches under {duration(MIN_USEFUL_MS)} are dropped.
                  </p>
                </Card>

                <div className="flex flex-col gap-5 xl:col-span-5">
                  <Card
                    title="Averages"
                    hint={
                      averages === null
                        ? undefined
                        : `${averages.days} ${averages.days === 1 ? "day" : "days"}`
                    }
                    action={
                      <Segmented
                        value={period}
                        options={PERIODS}
                        onChange={setPeriod}
                        label="Period"
                      />
                    }
                  >
                    <div className="grid grid-cols-2 gap-3">
                      <Metric
                        label="Useful / day"
                        value={duration(averages?.perDay ?? 0)}
                      />
                      <Metric
                        label="Share of day"
                        value={`${Math.round((averages?.share ?? 0) * 100)}%`}
                      />
                      <Metric
                        label="Switches / day"
                        value={(averages?.switches ?? 0).toFixed(1)}
                      />
                      <Metric
                        label="Per stretch"
                        value={duration(averages?.stretch ?? 0)}
                      />
                    </div>
                  </Card>

                  <Card title="Personal best">
                    {figures === null || figures.best === null ? (
                      <p className="text-sm text-foreground-muted">
                        No stretch logged yet.
                      </p>
                    ) : (
                      <dl className="text-sm">
                        <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
                          <dt className="text-foreground-muted">
                            Longest stretch
                          </dt>
                          <dd className="text-right text-foreground">
                            <span className="font-display font-semibold tabular-nums">
                              {duration(figures.best.ms)}
                            </span>
                            <span className="text-foreground-faint">
                              {" "}
                              · {shortDate(figures.best.start)}
                            </span>
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-4 pt-3">
                          <dt className="text-foreground-muted">Best day</dt>
                          <dd className="text-right text-foreground">
                            {figures.topDay === null ? (
                              <span className="text-foreground-faint">—</span>
                            ) : (
                              <>
                                <span className="font-display font-semibold tabular-nums">
                                  {duration(figures.topDay.useful)}
                                </span>
                                <span className="text-foreground-faint">
                                  {" "}
                                  · {shortDate(figures.topDay.day)}
                                </span>
                              </>
                            )}
                          </dd>
                        </div>
                      </dl>
                    )}
                  </Card>
                </div>

                <Card
                  className="xl:col-span-7"
                  title="Trend"
                  hint={chart === "week" ? "8 weeks" : "12 months"}
                  action={
                    <Segmented
                      value={chart}
                      options={[
                        { key: "week" as const, label: "Week" },
                        { key: "month" as const, label: "Month" },
                      ]}
                      onChange={setChart}
                      label="Trend range"
                    />
                  }
                >
                  <p className="text-sm leading-snug text-foreground-muted">
                    {chart === "week" ? "This week" : "This month"}:{" "}
                    <span className="font-medium tabular-nums text-foreground">
                      {duration(chartValue)}
                    </span>
                  </p>
                  <p className="mt-1 text-sm leading-snug text-foreground-muted">
                    {trendCaption}
                  </p>
                  <div className="mt-5">
                    <Line
                      values={chartBars.map((bar) => bar.useful)}
                      titles={chartBars.map(
                        (bar, index) =>
                          // The days the bar stands for, not just where it
                          // starts — and the one still running reads through
                          // today, since its tail has not happened yet.
                          `${dateRange(
                            bar.from,
                            index === chartBars.length - 1 &&
                              figures !== null
                              ? shiftDays(figures.today, 1)
                              : bar.to,
                          )} · ${duration(bar.useful)}`,
                      )}
                      labels={chartBars.map((bar) =>
                        chart === "week"
                          ? weekName(bar.from)
                          : shortMonth(bar.from),
                      )}
                      marked={chartBars.length - 1}
                    />
                  </div>
                </Card>

                <Card
                  className="xl:col-span-5"
                  title="When you're useful"
                  hint="All history"
                >
                  <p className="text-sm leading-snug text-foreground-muted">
                    {peak === null
                      ? "Not enough logged yet to see a shape to the day."
                      : `Your strongest hour is ${hourName(peak)}–${hourName(
                          peak + 1,
                        )}, holding ${duration(hours[peak])} of useful time.`}
                  </p>
                  <div className="mt-5">
                    <Heat grid={figures?.heat ?? []} />
                  </div>
                </Card>

                <Card
                  className="xl:col-span-12"
                  title="Milestones"
                  hint={`${boardEarned} of ${boardItems.length}`}
                >
                  {/* One flat run of cards with no headings between them: a
                      ladder is the same card as a lone milestone, walked with
                      the arrows instead of standing still. Same width, same
                      shape, so the board reads as one set.

                      As many cards to a row as the width allows, rather than a
                      fixed count: every card then fills its column instead of
                      sitting in the middle of a wide one with air around it,
                      and the last row is simply the one that ran out of cards
                      to fill it. Two to a row on a phone, where a solitary
                      170px column would be all the width there is.

                      No `items-start`: the cards are as tall as their own
                      contents, and a ladder carries one line fewer than a lone
                      milestone does, so the row is stretched to its tallest
                      card instead and the short one spends the difference as a
                      few pixels of air. */}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
                    {board.map((group) =>
                      group.ladder ? (
                        <MilestoneLadder key={group.group} group={group} />
                      ) : (
                        group.items.map((item) => (
                          <MilestoneTile key={item.id} item={item} />
                        ))
                      ),
                    )}
                  </div>
                  {/* What makes a day perfect, said once for the ladder that
                      counts them. Worn on every rung it would be the same line
                      twelve times over, and the count — `720 perfect days` —
                      never says on its own what one of those days had to be. */}
                  <p className="mt-5 text-sm leading-snug text-foreground-muted">
                    {PERFECT_DAY_RULE}
                  </p>
                </Card>
              </div>

              {/* The log itself, out. One row a stretch, which is all the log
                  actually holds — every figure in this sheet is derived from
                  those rows, so this is the whole history rather than a summary
                  of it. Disabled on an empty log, where there is no file to
                  write. */}
              <div className="mt-5">
                <button
                  type="button"
                  disabled={spans.length === 0}
                  onClick={() => downloadCsv(spans)}
                  className="inline-flex h-9 items-center gap-2 rounded-field border border-border px-3 text-sm text-foreground-muted transition-colors hover:bg-hover-bg hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4"
                    aria-hidden="true"
                  >
                    <path d="M12 4v11" />
                    <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
                    <path d="M5 19.5h14" />
                  </svg>
                  Export all data
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

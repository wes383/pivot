import type { Span } from "./spans";

/** What the log really holds: one row per stretch. Everything the drawer prints
    — the day totals, the shares, the switch counts, the whole milestones board
    — is derived from these, so this file is the complete history rather than a
    summary of it. Nothing is recomputed and nothing is capped: a stretch the
    log says ran nine hours is written as nine hours. */
const HEADER = "start,end,minutes";

/** `2026-09-14 2:03:20 pm`, in the browser's own zone. Deliberately not ISO
    8601: there is no `T`, no offset and no `Z`, because the file is meant to be
    opened in a spreadsheet rather than fed back into a program, and the log was
    kept in local time. The time reads on a 12-hour face like every other time
    the app shows; the one thing the export keeps that the sheet never needs is
    the seconds, so that the two stamps and the minute count beside them can
    never contradict one another. Built here rather than taken from `clock12`,
    which stops at the minute. */
function stamp(ms: number): string {
  const at = new Date(ms);
  const hour = at.getHours();
  const face = hour % 12 === 0 ? 12 : hour % 12;
  const half = hour < 12 ? "am" : "pm";
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${face}:${two(at.getMinutes())}:${two(at.getSeconds())} ${half}`;
}

/** How long a stretch lasted, in minutes to a tenth. A whole number would read
    more calmly, but every row would then lose up to half a minute, and a year of
    rows would sum to a total that no longer matches the one the drawer shows for
    the same days. */
function minutes(from: number, to: number): string {
  return ((to - from) / 60_000).toFixed(1);
}

/** The whole log as CSV. A stretch still running has no end to print and no
    length to measure, so its last two columns are left empty rather than filled
    in with a guess at the current time. */
export function csvOf(spans: Span[]): string {
  const rows = spans.map((span) =>
    span.end === null
      ? `${stamp(span.start)},,`
      : `${stamp(span.start)},${stamp(span.end)},${minutes(span.start, span.end)}`,
  );
  // CRLF, and one at the end of the last row too: that is what RFC 4180 says and
  // what a spreadsheet reading the file expects to find.
  return [HEADER, ...rows].join("\r\n") + "\r\n";
}

/** Hands the log to the browser as a download, named for the day it was taken —
    a second export tomorrow will not land on top of the first. */
export function downloadCsv(spans: Span[]): void {
  const at = new Date();
  const name = `pivot-log-${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}.csv`;
  const url = URL.createObjectURL(
    new Blob([csvOf(spans)], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  // In the document, because a detached anchor is ignored by some browsers; out
  // again straight away, because it is only ever a vehicle for the click.
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next tick rather than at once: the download reads the blob
  // after the click returns in some browsers, and pulling the URL out from under
  // it cancels the save instead of ending it.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function two(value: number): string {
  return String(value).padStart(2, "0");
}

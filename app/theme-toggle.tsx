"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { readPreference, writePreference, type ThemePreference } from "./theme";

/** As much of a class joiner as the three choices need; no dependency for it. */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const OPTIONS: Array<{ key: ThemePreference; label: string }> = [
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
  { key: "system", label: "System" },
];

/** How long the page is given to cross over. The same figure the body's own
    colour transition runs on, so the page and the sheet under the pointer
    arrive together. */
const CROSSOVER_MS = 300;

/** The appearance picker, kept at the foot of the log rather than in a corner of
    the switch: it is a setting, it is visited about as often as the export
    button beside it, and the page it themes is meant to be nothing but the
    switch.

    Three choices, one of them taken — the drawer's own segmented control, in
    name and in build: same sunken track, same lifted chip. It is a radio group
    rather than the tablist that control uses, because choosing an appearance
    swaps no panel; it only changes which of three stand as the answer. */
export default function ThemeToggle() {
  // The server cannot read the pick, so the first render says `system`, which is
  // exactly what the server rendered into the sheet. Reading storage during the
  // render instead would put this control at odds with the page around it and
  // break hydration to say so.
  const [preference, setPreference] = useState<ThemePreference>("system");
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const settle = useRef<number | undefined>(undefined);
  const caption = useId();

  // Two jobs, both finished before the browser paints. The first is adopting the
  // pick the script has already painted, so the lifted chip agrees with the
  // palette on the screen. The second is putting the attribute back: in
  // development React remounts once and resets `<html>` to only the attributes
  // its own JSX declares, which throws the script's work away. Neither does
  // anything in production that the script has not already done.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreference(readPreference());
    window.pivotTheme?.paint();
  }, []);

  /** Hands the choice to storage and then to the script, which is the only
      thing that knows how to resolve it — `system` included.

      The crossover runs only when the theme actually changes: picking `dark` on
      a desktop already dark is a choice, but there is nothing on the page that
      needs to travel to show it. */
  const choose = (next: ThemePreference) => {
    setPreference(next);
    writePreference(next);

    const root = document.documentElement;
    const before = root.dataset.theme;
    root.classList.add("theme-crossover");
    // Read back the computed transition, which flushes the class onto the page
    // before anything is repainted. Without the flush the class and the new
    // theme land in the same recalculation, the transition is never a property
    // of the old style, and the page snaps instead of fading.
    void getComputedStyle(root).transition;
    window.pivotTheme?.paint();

    window.clearTimeout(settle.current);
    if (root.dataset.theme === before) {
      root.classList.remove("theme-crossover");
      return;
    }
    settle.current = window.setTimeout(
      () => root.classList.remove("theme-crossover"),
      CROSSOVER_MS,
    );
  };

  /** Left and right walk the group, as they do in any other set of radios, and
      take the focus with them. Only the chosen one is in the tab order, so
      without this the other two would be unreachable from the keyboard. */
  const walk = (from: number, step: number) => {
    const at = (from + step + OPTIONS.length) % OPTIONS.length;
    choose(OPTIONS[at].key);
    buttons.current[at]?.focus();
  };

  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
      <span id={caption} className="text-xs text-foreground-subtle">
        Appearance
      </span>
      <div
        role="radiogroup"
        aria-labelledby={caption}
        className="inline-flex items-center gap-0.5 rounded-field bg-muted p-0.5"
      >
        {OPTIONS.map((option, index) => {
          const active = option.key === preference;
          return (
            <button
              key={option.key}
              ref={(node) => {
                buttons.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => choose(option.key)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  walk(index, 1);
                } else if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  walk(index, -1);
                }
              }}
              className={cx(
                "rounded-chip px-2.5 py-1.5 text-xs font-medium leading-none transition-colors",
                active
                  ? "bg-surface text-foreground shadow-card"
                  : "text-foreground-muted hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

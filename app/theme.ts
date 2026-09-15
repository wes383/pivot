/** What a reader has picked for the page's appearance. `system` is not a third
    palette: it means "ask the OS", and it is the default, because a page with
    no opinion is a page that agrees with everything around it. */
export type ThemePreference = "light" | "dark" | "system";

/** The two palettes, named the way the attribute on `<html>` names them. */
export type Theme = "light" | "dark";

/** Where the pick is kept, alongside the switch and the log. */
export const THEME_KEY = "pivot.theme";

/** The surfaces the page is painted on, repeated here for the one thing that is
    not a CSS variable: the browser's own chrome, which reads its colour off a
    `theme-color` meta tag. Mirrored by `--background` in `globals.css`, which
    cannot import from here. */
export const THEME_COLORS: Record<Theme, string> = {
  light: "#fcfbfa",
  dark: "#101010",
};

/** The appearance the reader picked, or `system` if they never picked one.
    The script below resolves the same value out of the same key — it runs
    before any module does, so it cannot import this — and the two have to be
    kept in step. This is the copy the toggle reads. */
export function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage unavailable — the OS decides.
  }
  return "system";
}

export function writePreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_KEY, preference);
  } catch {
    // Storage unavailable — the pick lives in memory only, for this page.
  }
}

/** The theme, painted before anything is.

    It has to be inline in the head and has to run synchronously as the sheet is
    parsed: the server cannot read local storage, so it renders the light
    palette into the HTML, and by the time a module or an effect could correct
    that the reader has already seen it. This is the one place that can.

    It resolves the pick to a theme, writes it onto `<html>` — which is the only
    thing the stylesheet reads — and re-runs whenever the OS flips, so `system`
    goes on meaning the system for as long as the page is open. The toggle calls
    back into it through `window.pivotTheme` rather than repeating any of this.

    Kept as a string because that is what an inline script is; the `try` around
    storage and the absence of anything newer than ES5 are both deliberate. */
export const THEME_SCRIPT = `(function () {
  var os = window.matchMedia("(prefers-color-scheme: dark)");
  function paint() {
    var stored = null;
    try {
      stored = window.localStorage.getItem("${THEME_KEY}");
    } catch (error) {
      // Storage unavailable — the OS decides.
    }
    var theme =
      stored === "light" || stored === "dark"
        ? stored
        : os.matches
          ? "dark"
          : "light";
    document.documentElement.setAttribute("data-theme", theme);
    // The browser's chrome, kept with the page rather than with the OS. Only
    // one meta is ever wanted, so an existing one is reused rather than joined.
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", theme === "dark" ? "${THEME_COLORS.dark}" : "${THEME_COLORS.light}");
  }
  paint();
  os.addEventListener("change", paint);
  window.pivotTheme = { paint: paint };
})();`;

declare global {
  interface Window {
    /** Handed over by `THEME_SCRIPT`. Absent only if the script never ran, in
        which case the stylesheet's own default already stands. */
    pivotTheme?: { paint: () => void };
  }
}

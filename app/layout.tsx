import type { Metadata, Viewport } from "next";
import { Inter, Manrope } from "next/font/google";
import "./globals.css";
import { THEME_SCRIPT } from "./theme";

// Same type pairing as orkest-ui: Inter for the UI voice, Manrope for display.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pivot",
  description: "One switch: are you doing something useful, or not?",
};

export const viewport: Viewport = {
  // No `themeColor` here, deliberately: the browser's own chrome is painted by
  // the meta tag the theme script writes, so that it follows the appearance
  // picked in the app rather than the one the OS happens to be in. A pair of
  // tags matched to `prefers-color-scheme` would fight it for the same job.
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // `data-theme` is what `globals.css` reads, and the script below overwrites
    // it — from local storage, or from the OS when the pick is `system` — while
    // the sheet is still parsing, so the first thing painted is already the
    // right palette. `suppressHydrationWarning` is what lets the attribute the
    // script wrote stand rather than being reconciled back to this default.
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${inter.variable} ${manrope.variable} antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col font-sans">{children}</body>
    </html>
  );
}

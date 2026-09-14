import type { Metadata, Viewport } from "next";
import { Inter, Manrope } from "next/font/google";
import "./globals.css";

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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfbfa" },
    { media: "(prefers-color-scheme: dark)", color: "#101010" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${manrope.variable} antialiased`}
    >
      <body className="flex min-h-dvh flex-col font-sans">{children}</body>
    </html>
  );
}

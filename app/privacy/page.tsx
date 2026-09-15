import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Pivot",
  description: "How Pivot handles your data: it never leaves your device.",
};

export default function Privacy() {
  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16 sm:py-24">
      <article className="w-full max-w-[42rem] font-sans">
        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Privacy Policy
        </h1>
        <p className="mt-3 text-sm text-foreground-subtle">
          Last updated September 14, 2026
        </p>

        <div className="mt-10 space-y-8 text-[15px] leading-relaxed text-foreground-muted">
          <section>
            <p className="text-foreground">
              Pivot keeps everything on your device. There is no account, no
              server, and no analytics. Any action you take in the app is
              recorded only in the browser on your own device.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold text-foreground">
              What is stored, and where
            </h2>
            <p className="mt-2">
              Three values are stored in your browser&rsquo;s local storage:
            </p>
            <ul className="mt-3 space-y-3">
              <li>
                <code className="rounded bg-muted px-1.5 py-0.5 text-sm text-foreground">
                  pivot.state
                </code>
                <span className="mt-1 block">
                  The current state of the switch.
                </span>
              </li>
              <li>
                <code className="rounded bg-muted px-1.5 py-0.5 text-sm text-foreground">
                  pivot.log
                </code>
                <span className="mt-1 block">
                  The full history of stretches you have marked as useful.
                </span>
              </li>
              <li>
                <code className="rounded bg-muted px-1.5 py-0.5 text-sm text-foreground">
                  pivot.theme
                </code>
                <span className="mt-1 block">
                  Which appearance you picked: light, dark, or following your
                  system settings.
                </span>
              </li>
            </ul>
            <p className="mt-3">
              This is the entirety of the data Pivot stores. Nothing is
              uploaded, synced, or shared with any third party.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold text-foreground">
              No tracking
            </h2>
            <p className="mt-2">
              Pivot sends no requests about you to any third party, and sets no
              cookies &mdash; the only browser storage is the local storage
              described above. The typefaces are bundled with the app at build
              time, so loading the page makes no request to any external font
              service.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold text-foreground">
              Your control
            </h2>
            <p className="mt-2">
              Because the data never leaves your device, you retain full
              control over it. Clearing your browser&rsquo;s site data removes
              your history completely and instantly. No deletion request to us
              is required, as this data was never transmitted to us.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold text-foreground">
              Regulations
            </h2>
            <p className="mt-2">
              Because Pivot collects no personal data, there is nothing here for
              data-subject requests under laws like the GDPR or CCPA to apply
              to. If that ever changes, this page will be updated first.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold text-foreground">
              Contact
            </h2>
            <p className="mt-2">
              Pivot is developed in the open &mdash; the source code is
              available at{" "}
              <a
                href="https://github.com/wes383/pivot"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-muted underline-offset-2 hover:text-foreground"
              >
                github.com/wes383/pivot
              </a>
              . For any questions about this policy, please open an issue in
              the repository.
            </p>
          </section>

          <section>
            <p className="text-foreground-subtle">
              If this changes &mdash; if Pivot ever gains accounts, syncing, or
              any form of analytics &mdash; we will update this page and
              provide notice before the change takes effect.
            </p>
          </section>
        </div>

        <div className="mt-12">
          <Link
            href="/"
            className="text-sm text-foreground-subtle transition-colors hover:text-foreground"
          >
            Back to Pivot
          </Link>
        </div>
      </article>
    </main>
  );
}

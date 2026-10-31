import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import type { ReactNode } from "react";

import type { Route } from "./+types/root";
import { ThemeToggle, themeInitScript } from "~/components/theme-toggle";
import "./app.css";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <>
      <Outlet />
      {import.meta.env.DEV && <ThemeToggle />}
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-xl bg-emerald-600 text-white">
          <span className="font-heading text-lg font-semibold">S</span>
        </div>
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Spending Snapshot</p>
        <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight">
          {isNotFound ? "Page not found" : "Something went wrong"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {isNotFound
            ? "We couldn’t find the page you were looking for."
            : "We couldn’t load your snapshot. Try refreshing the page."}
        </p>
        <a
          href="/"
          className="mt-6 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
        >
          Back to dashboard
        </a>
        {import.meta.env.DEV && error instanceof Error && (
          <pre className="mt-8 max-h-48 overflow-auto rounded-lg bg-muted p-3 text-left text-xs">
            {error.message}
          </pre>
        )}
      </div>
    </main>
  );
}

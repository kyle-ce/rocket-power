# Spending Snapshot

A personal finance app for one user. Import or add transactions, see where your money goes, and spot recurring subscriptions. Everything runs in the browser, and data never leaves your machine.

## Features

- **Dashboard**: income vs. expenses for the selected month and a spending-by-category donut chart.
- **Possible subscriptions**: scans the whole selected year for similar charges at regular intervals (weekly, biweekly, monthly, quarterly) and estimates the next date.
- **Transactions**: add, edit, delete, search, and filter by type or category.
- **CSV import**: upload a bank export (see below).
- **Local persistence**: transactions are stored in `localStorage`. Unreadable saved data is never overwritten.
- **Light and dark themes**: follows the browser preference. In development, a button in the bottom-right corner toggles the theme.

## Tech stack

- [React Router](https://reactrouter.com/) in framework mode, SPA (`ssr: false`)
- React, TypeScript, Vite
- Tailwind CSS v4 and [shadcn/ui](https://ui.shadcn.com/) (Radix, Nova preset)
- Vitest, Testing Library, and V8 coverage

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server with HMR |
| `npm run build` | Create a production build in `build/` |
| `npm start` | Serve the production build |
| `npm run typecheck` | Generate route types and run `tsc` |
| `npm test` | Run the test suite once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run coverage` | Run tests with coverage (HTML report in `coverage/`) |

## CSV import

The first row must be a header. Column names are case-insensitive.

| Field | Accepted headers | Required |
| --- | --- | --- |
| Date | `date`, `postingdate`, `transactiondate` | Yes |
| Description | `description`, `merchant`, `name` | Yes |
| Amount | `amount`, `expense` | Yes |
| Category | `category` | No (defaults to "Other") |
| Type | `type`, `creditdebitindicator` | No (defaults to expense) |

- Dates can be `YYYY-MM-DD` or `M/D/YYYY`.
- Amounts are stored as positive values. Values in parentheses count as negative.
- Quote amounts that contain commas, e.g. `"1,234.50"`.
- A file with any invalid row is rejected, so nothing is partially imported.

## Project structure

```
app/
  routes/home.tsx            Dashboard and transactions UI
  lib/transactions.ts        Types, validation, storage, CSV import, subscription detection
  components/theme-toggle.tsx  Theme init script and dev toggle
  components/ui/             shadcn/ui components
  root.tsx                   Layout and error boundary
  app.css                    Design tokens and light/dark palettes
test/setup.ts                Vitest setup (jest-dom, jsdom stubs)
```

Tests live next to the code as `*.test.ts(x)`. Generated shadcn components and `app/routes.ts` are excluded from coverage.

## Data and privacy

Transactions are saved in your browser under the `spending-snapshot-transactions-v1` key. Clearing site data deletes them, and they are not synced between browsers or devices.

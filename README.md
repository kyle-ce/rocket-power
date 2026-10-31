# Rocket Power

A personal finance app for one user. Import your bank CSV, see where your money goes, and spot recurring subscriptions. Everything runs in the browser, and data never leaves your machine.

## Features

- **Dashboard**: income vs. expenses for the selected month and a spending-by-category donut chart.
- **Subscriptions**: scans the whole selected year for similar charges at regular intervals (weekly, biweekly, monthly, quarterly). Shows your total monthly and yearly cost, then each subscription with its charge, monthly equivalent, and last charge date, biggest first. Yearly subscriptions are not detected yet.
  - On screens 1024px and wider, the card matches the height of the summary column and shows the rows that fit, with a "+N more" button to show every row (and "Show fewer" to go back).
  - Below 1024px it is a collapsed accordion; the totals stay visible and "Show all" reveals the list.
- **Transactions**: search, filter by type or category (the category filter lists the categories in the selected month), and change a transaction's category with the pencil button. Other fields can't be edited and transactions can't be deleted or added by hand.
- **CSV import**: the only way to add data. Upload a bank export (see below).
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
| `npm run fixtures:generate` | Regenerate the fake two-year CSV and its answer key |

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
- Columns that aren't listed above are ignored.

## Testing subscription detection

`scripts/generate-fake-transactions.mjs` creates a seeded, deterministic two-year CSV (`test/fixtures/fake-transactions.csv`) with known subscriptions (Netflix, Hulu, GitHub, Discord, AT&T, car insurance, and others), filler spending, and decoys that should not be detected (daily coffee, car washes, one-off purchases). `test/fixtures/fake-subscriptions.json` is the answer key, and `app/lib/subscriptions.fixture.test.ts` scores detection against it. You can also import the fake CSV in the app to try it out.

When detection misses or misreads something in your real data, add a similar case to the generator and tune `findRecurringPayments` until the fixture test passes.

## Project structure

```
app/
  routes/home.tsx            Dashboard and transactions UI
  lib/transactions.ts        Types, validation, storage, CSV import, subscription detection
  lib/subscriptions.fixture.test.ts  Scores detection against the fake data
  components/theme-toggle.tsx  Theme init script and dev toggle
  components/ui/             shadcn/ui components
  root.tsx                   Layout and error boundary
  app.css                    Design tokens and light/dark palettes
scripts/                     Fake data generator
test/fixtures/               Fake CSV and subscription answer key
test/setup.ts                Vitest setup (jest-dom, jsdom stubs)
```

Tests live next to the code as `*.test.ts(x)`. Generated shadcn components and `app/routes.ts` are excluded from coverage.

## Data and privacy

Transactions are saved in your browser under the `spending-snapshot-transactions-v1` key. Clearing site data deletes them, and they are not synced between browsers or devices.

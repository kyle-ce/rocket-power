import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findRecurringPayments,
  importTransactionsCsv,
  type RecurringPayment,
} from "./transactions";

// Ground truth for test/fixtures/fake-transactions.csv.
// Regenerate both with: node scripts/generate-fake-transactions.mjs
type Expected = {
  name: string;
  pattern: string;
  frequency: string;
  kind: "subscription" | "bill" | "ambiguous";
  detectableWithinYear?: boolean;
  notes: string;
};

const read = (name: string) =>
  readFileSync(resolve(process.cwd(), "test/fixtures", name), "utf8");

const { transactions } = importTransactionsCsv(read("fake-transactions.csv"));
const expected: Expected[] = JSON.parse(read("fake-subscriptions.json"));
const matches = (entry: Expected, payment: RecurringPayment) =>
  new RegExp(entry.pattern, "i").test(payment.description);

const required = expected.filter(
  (entry) => entry.kind !== "ambiguous" && entry.detectableWithinYear !== false,
);

describe("subscription detection against fake 2-year data", () => {
  it("imports the whole fixture", () => {
    expect(transactions.length).toBeGreaterThan(1000);
  });

  for (const month of ["2024-06", "2025-06"]) {
    const year = month.slice(0, 4);
    const found = findRecurringPayments(transactions, month);

    describe(year, () => {
      it.each(required.map((entry) => [entry.name, entry] as const))(
        "finds %s",
        (_name, entry) => {
          expect(found.some((payment) => matches(entry, payment))).toBe(true);
        },
      );

      it("reports nothing that is not a known recurring charge", () => {
        const unexpected = found
          .filter((payment) => !expected.some((entry) => matches(entry, payment)))
          .map((payment) => `${payment.description} (${payment.frequency}, $${payment.amount})`);

        expect(unexpected).toEqual([]);
      });

      it("reports each subscription once", () => {
        for (const entry of required) {
          const hits = found.filter((payment) => matches(entry, payment));
          expect(hits.length, entry.name).toBeLessThanOrEqual(1);
        }
      });
    });
  }

  it.todo("finds yearly subscriptions such as Amazon Prime using adjacent-year history");
});

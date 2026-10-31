import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXPENSE_CATEGORIES,
  findRecurringPayments,
  getMonthlyCost,
  normalizeMerchant,
  formatMonth,
  getLocalDateString,
  getMonthKey,
  getPreviousMonthKey,
  importTransactionsCsv,
  INCOME_CATEGORIES,
  readTransactions,
  STORAGE_KEY,
  writeTransactions,
  type Transaction,
} from "./transactions";

const tx = (
  id: string,
  date: string,
  overrides: Partial<Transaction> = {},
): Transaction => ({
  id,
  date,
  amount: 15,
  type: "expense",
  description: "Streaming",
  category: "Entertainment",
  ...overrides,
});

describe("date helpers", () => {
  it("formats local dates with zero padding", () => {
    expect(getLocalDateString(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(getLocalDateString(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("defaults to today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 9, 23, 30));
    expect(getLocalDateString()).toBe("2026-06-09");
    expect(getMonthKey()).toBe("2026-06");
    vi.useRealTimers();
  });

  it("derives month keys and previous months across year boundaries", () => {
    expect(getMonthKey(new Date(2026, 2, 31))).toBe("2026-03");
    expect(getPreviousMonthKey("2026-03")).toBe("2026-02");
    expect(getPreviousMonthKey("2026-01")).toBe("2025-12");
  });

  it("formats a month for display", () => {
    expect(formatMonth("2026-02")).toBe("February 2026");
  });
});

describe("local storage", () => {
  beforeEach(() => window.localStorage.clear());

  it("returns an empty list when nothing is saved", () => {
    expect(readTransactions()).toEqual([]);
  });

  it("round-trips saved transactions", () => {
    const saved = [tx("a", "2026-02-10"), tx("b", "2026-02-11", { type: "income" })];
    writeTransactions(saved);
    expect(readTransactions()).toEqual(saved);
  });

  it("rejects data that is not an array", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ a: 1 }));
    expect(() => readTransactions()).toThrow("not in a valid format");
  });

  it.each([
    ["null entry", null],
    ["non-object entry", "text"],
    ["missing id", { ...tx("a", "2026-01-01"), id: undefined }],
    ["non-finite amount", { ...tx("a", "2026-01-01"), amount: "10" }],
    ["zero amount", tx("a", "2026-01-01", { amount: 0 })],
    ["negative amount", tx("a", "2026-01-01", { amount: -5 })],
    ["unknown type", { ...tx("a", "2026-01-01"), type: "transfer" }],
    ["bad category", { ...tx("a", "2026-01-01"), category: 4 }],
    ["non-string date", { ...tx("a", "2026-01-01"), date: 20260101 }],
    ["malformed date", tx("a", "2026-1-1")],
    ["impossible date", tx("a", "2026-02-30")],
  ])("rejects an invalid entry: %s", (_name, entry) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([entry]));
    expect(() => readTransactions()).toThrow("not in a valid format");
  });

  it("throws on corrupted JSON", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(() => readTransactions()).toThrow();
  });
});

describe("findRecurringPayments", () => {
  it("finds monthly subscriptions across the selected year", () => {
    const result = findRecurringPayments(
      [
        tx("1", "2026-01-05"),
        tx("2", "2026-02-05"),
        tx("3", "2026-03-05"),
        tx("4", "2026-04-05"),
      ],
      "2026-02",
    );

    expect(result).toEqual([
      {
        description: "Streaming",
        category: "Entertainment",
        amount: 15,
        frequency: "Monthly",
        lastDate: "2026-04-05",
        occurrences: 4,
      },
    ]);
  });

  it("detects weekly, biweekly, and quarterly cadences", () => {
    const result = findRecurringPayments(
      [
        tx("w1", "2026-01-01", { description: "Weekly" }),
        tx("w2", "2026-01-08", { description: "Weekly" }),
        tx("b1", "2026-01-01", { description: "Biweekly" }),
        tx("b2", "2026-01-15", { description: "Biweekly" }),
        tx("q1", "2026-01-01", { description: "Quarterly" }),
        tx("q2", "2026-04-01", { description: "Quarterly" }),
        tx("q3", "2026-07-01", { description: "Quarterly" }),
      ],
      "2026-06",
    );
    const byName = Object.fromEntries(
      result.map((payment) => [payment.description, payment.frequency]),
    );

    expect(byName).toEqual({
      Weekly: "Weekly",
      Biweekly: "Biweekly",
      Quarterly: "Quarterly",
    });
  });

  it("ignores other years, income, and single payments", () => {
    expect(
      findRecurringPayments(
        [tx("1", "2025-01-05"), tx("2", "2025-02-05")],
        "2026-12",
      ),
    ).toEqual([]);
    expect(
      findRecurringPayments(
        [
          tx("1", "2026-01-05", { type: "income" }),
          tx("2", "2026-02-05", { type: "income" }),
        ],
        "2026-12",
      ),
    ).toEqual([]);
    expect(findRecurringPayments([tx("1", "2026-01-05")], "2026-12")).toEqual([]);
  });

  it("rejects a malformed reference month", () => {
    expect(findRecurringPayments([tx("1", "2026-01-05")], "")).toEqual([]);
    expect(findRecurringPayments([tx("1", "2026-01-05")], "abcd-01")).toEqual([]);
  });

  it("requires similar amounts", () => {
    expect(
      findRecurringPayments(
        [tx("1", "2026-01-05"), tx("2", "2026-02-05", { amount: 80 })],
        "2026-12",
      ),
    ).toEqual([]);
  });

  it("allows small amount drift", () => {
    expect(
      findRecurringPayments(
        [tx("1", "2026-01-05"), tx("2", "2026-02-05", { amount: 15.5 })],
        "2026-12",
      ),
    ).toHaveLength(1);
  });

  it("requires regular intervals", () => {
    expect(
      findRecurringPayments(
        [
          tx("1", "2026-01-01"),
          tx("2", "2026-01-31"),
          tx("3", "2026-03-02"),
          tx("4", "2026-03-04"),
          tx("5", "2026-04-30"),
        ],
        "2026-12",
      ),
    ).toEqual([]);
  });

  it("rejects cadences that do not match a known frequency", () => {
    expect(
      findRecurringPayments(
        [tx("1", "2026-01-01"), tx("2", "2026-01-21")],
        "2026-12",
      ),
    ).toEqual([]);
  });

  it("rejects same-day duplicates", () => {
    expect(
      findRecurringPayments(
        [tx("1", "2026-01-05"), tx("2", "2026-01-05")],
        "2026-12",
      ),
    ).toEqual([]);
  });

  it("groups by description and category, case-insensitively", () => {
    const result = findRecurringPayments(
      [
        tx("1", "2026-01-05", { description: "Netflix" }),
        tx("2", "2026-02-05", { description: " netflix " }),
        tx("3", "2026-01-05", { description: "Netflix", category: "Other" }),
      ],
      "2026-12",
    );

    expect(result).toHaveLength(1);
    expect(result[0].occurrences).toBe(2);
  });

  it("sorts results by amount, highest first", () => {
    const result = findRecurringPayments(
      [
        tx("a1", "2026-01-05", { description: "Cheap", amount: 5 }),
        tx("a2", "2026-02-05", { description: "Cheap", amount: 5 }),
        tx("b1", "2026-01-06", { description: "Pricey", amount: 50 }),
        tx("b2", "2026-02-06", { description: "Pricey", amount: 50 }),
      ],
      "2026-12",
    );

    expect(result.map((payment) => payment.description)).toEqual([
      "Pricey",
      "Cheap",
    ]);
  });
});

describe("importTransactionsCsv", () => {
  beforeEach(() => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000000",
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("imports a basic CSV", () => {
    const { transactions } = importTransactionsCsv(
      "Date,Description,Amount\n2026-03-01,Coffee,4.50\n",
    );

    expect(transactions).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000000",
        date: "2026-03-01",
        description: "Coffee",
        amount: 4.5,
        type: "expense",
        category: EXPENSE_CATEGORIES[7],
      },
    ]);
  });

  it("supports header aliases, BOM, and CRLF line endings", () => {
    const { transactions } = importTransactionsCsv(
      "\uFEFFTransaction Date,Merchant,Expense\r\n03/05/2026,Cafe,$1,234.50\r\n",
    );
    // The unquoted thousands separator splits the field; quote it instead.
    expect(transactions[0].amount).not.toBe(1234.5);

    const quoted = importTransactionsCsv(
      "\uFEFFPosting Date,Name,Amount\r\n03/05/2026,Cafe,\"$1,234.50\"\r\n",
    );
    expect(quoted.transactions[0]).toMatchObject({
      date: "2026-03-05",
      description: "Cafe",
      amount: 1234.5,
    });
  });

  it("handles quoted values, escaped quotes, and embedded newlines", () => {
    const { transactions } = importTransactionsCsv(
      'date,description,amount\n2026-03-01,"Lunch, ""big"" one\nsecond line",12\n',
    );

    expect(transactions[0].description).toBe('Lunch, "big" one\nsecond line');
  });

  it("uses supplied category and type", () => {
    const { transactions } = importTransactionsCsv(
      "date,description,amount,category,type\n2026-03-01,Pay,2000,Salary,income\n",
    );

    expect(transactions[0]).toMatchObject({
      type: "income",
      category: "Salary",
      amount: 2000,
    });
  });

  it("defaults income to the Other income category", () => {
    const { transactions } = importTransactionsCsv(
      "date,description,amount,type\n2026-03-01,Gift,50,income\n",
    );

    expect(transactions[0].category).toBe(INCOME_CATEGORIES[4]);
  });

  it("treats credits as income when a credit/debit column exists", () => {
    const { transactions } = importTransactionsCsv(
      "date,description,amount,credit debit indicator\n2026-03-01,Refund,10,Credit\n2026-03-02,Shop,10,Debit\n",
    );

    expect(transactions.map((item) => item.type)).toEqual(["income", "expense"]);
  });

  it("normalizes negative and parenthesized amounts to positive values", () => {
    const { transactions } = importTransactionsCsv(
      "date,description,amount\n2026-03-01,A,-5.256\n2026-03-02,B,(7.10)\n",
    );

    expect(transactions.map((item) => item.amount)).toEqual([5.26, 7.1]);
  });

  it("skips blank lines", () => {
    const { transactions } = importTransactionsCsv(
      "date,description,amount\n\n2026-03-01,A,1\n\n",
    );

    expect(transactions).toHaveLength(1);
  });

  it("reports unclosed quotes", () => {
    expect(() =>
      importTransactionsCsv('date,description,amount\n2026-03-01,"oops,1\n'),
    ).toThrow("unclosed quoted value");
  });

  it("requires a header and a data row", () => {
    expect(() => importTransactionsCsv("")).toThrow("header row");
    expect(() => importTransactionsCsv("date,description,amount")).toThrow(
      "header row",
    );
  });

  it("requires the core columns", () => {
    expect(() => importTransactionsCsv("date,amount\n2026-01-01,5")).toThrow(
      "date, description, and amount",
    );
    expect(() =>
      importTransactionsCsv("description,amount\nA,5"),
    ).toThrow("date, description, and amount");
    expect(() => importTransactionsCsv("date,description\n2026-01-01,A")).toThrow(
      "date, description, and amount",
    );
  });

  it.each([
    ["bad date", "2026-13-40,A,5", "Row 2: use a valid"],
    ["unparseable date", "yesterday,A,5", "Row 2: use a valid"],
    ["missing description", "2026-01-01,,5", "Row 2: add a description"],
    ["non-numeric amount", "2026-01-01,A,abc", "Row 2: add a non-zero amount"],
    ["zero amount", "2026-01-01,A,0", "Row 2: add a non-zero amount"],
  ])("reports row errors: %s", (_name, row, message) => {
    expect(() =>
      importTransactionsCsv(`date,description,amount\n${row}`),
    ).toThrow(message);
  });

  it("includes the correct row number in errors", () => {
    expect(() =>
      importTransactionsCsv("date,description,amount\n2026-01-01,A,1\n2026-01-02,,1"),
    ).toThrow("Row 3");
  });

  it("handles rows that are shorter than the header", () => {
    expect(() =>
      importTransactionsCsv("date,description,amount\n2026-01-01"),
    ).toThrow("Row 2");
  });
});

describe("findRecurringPayments merchant matching", () => {
  const monthly = (id: string, month: number, description: string, amount: number, category = "Entertainment") =>
    tx(`${id}${month}`, `2026-${String(month).padStart(2, "0")}-10`, {
      description,
      amount,
      category,
    });

  it("treats bank descriptor noise as the same merchant", () => {
    const result = findRecurringPayments(
      [
        monthly("a", 1, "NETFLIX.COM 866-579-7172 CA", 15.49),
        monthly("b", 2, "Netflix", 15.49),
        monthly("c", 3, "NETFLIX.COM 800-555-0100 CA", 15.49),
      ],
      "2026-06",
    );

    expect(result).toHaveLength(1);
    expect(result[0].occurrences).toBe(3);
  });

  it("keeps different products from one merchant apart", () => {
    const result = findRecurringPayments(
      [
        monthly("a", 1, "APPLE.COM/BILL ICLOUD", 2.99),
        monthly("b", 2, "APPLE.COM/BILL ICLOUD", 2.99),
        tx("x", "2026-01-20", { description: "APPLE.COM/BILL APP STORE", amount: 4.99, category: "Entertainment" }),
      ],
      "2026-06",
    );

    expect(result.map((payment) => payment.description)).toEqual(["APPLE.COM/BILL ICLOUD"]);
  });

  it("follows price increases and reports the latest price", () => {
    const result = findRecurringPayments(
      [
        monthly("a", 1, "Streaming", 15.49),
        monthly("b", 2, "Streaming", 15.49),
        monthly("c", 3, "Streaming", 17.99),
        monthly("d", 4, "Streaming", 17.99),
      ],
      "2026-06",
    );

    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(17.99);
  });

  it("finds the regular charge when an extra fee shares its name", () => {
    const charges = [1, 2, 3, 4, 5, 6].map((month) => monthly("g", month, "Gym", 24.99));
    charges.push(tx("fee", "2026-01-13", { description: "Gym", amount: 49, category: "Entertainment" }));

    const result = findRecurringPayments(charges, "2026-06");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ amount: 24.99, occurrences: 6 });
  });

  it("tolerates one missed payment when there is enough history", () => {
    const charges = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11].map((month) =>
      monthly("m", month, "Cloud storage", 9.99),
    );

    expect(findRecurringPayments(charges, "2026-06")).toHaveLength(1);
  });

  it("requires three charges for a quarterly cadence", () => {
    const result = findRecurringPayments(
      [
        tx("1", "2026-01-01", { description: "Maybe" }),
        tx("2", "2026-04-01", { description: "Maybe" }),
      ],
      "2026-06",
    );

    expect(result).toEqual([]);
  });

  it("ignores a coincidental cluster inside frequent shopping", () => {
    const frequent = Array.from({ length: 20 }, (_, index) =>
      tx(`f${index}`, `2026-01-${String(index + 1).padStart(2, "0")}`, {
        description: "Corner store",
        amount: 5 + index * 7,
      }),
    );

    expect(findRecurringPayments(frequent, "2026-06")).toEqual([]);
  });
});

describe("normalizeMerchant", () => {
  it("strips phone numbers, store numbers, states, and punctuation", () => {
    expect(normalizeMerchant("HULU 877-8244858 CA")).toBe("HULU");
    expect(normalizeMerchant("ATT*BILL PAYMENT")).toBe("ATT BILL");
    expect(normalizeMerchant("AT&T BILL")).toBe("ATT BILL");
    expect(normalizeMerchant("GITHUB, INC. SAN FRANCISCO CA")).toBe("GITHUB SAN FRANCISCO");
  });

  it("falls back to the trimmed description when nothing is left", () => {
    expect(normalizeMerchant("  123 45 ")).toBe("123 45");
  });
});

describe("getMonthlyCost", () => {
  const payment = (frequency: "Weekly" | "Biweekly" | "Monthly" | "Quarterly") => ({
    description: "x",
    category: "Other",
    amount: 12,
    frequency,
    lastDate: "2026-01-01",
    occurrences: 3,
  });

  it.each([
    ["Weekly", 52],
    ["Biweekly", 26],
    ["Monthly", 12],
    ["Quarterly", 4],
  ] as const)("normalizes %s charges to a monthly amount", (frequency, perYear) => {
    expect(getMonthlyCost(payment(frequency))).toBeCloseTo((12 * perYear) / 12);
  });
});

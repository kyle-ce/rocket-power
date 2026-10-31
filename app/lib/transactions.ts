export const STORAGE_KEY = "spending-snapshot-transactions-v1";

export const EXPENSE_CATEGORIES = [
  "Food & dining",
  "Shopping",
  "Transport",
  "Bills & utilities",
  "Entertainment",
  "Health",
  "Travel",
  "Other",
] as const;

export const INCOME_CATEGORIES = [
  "Salary",
  "Freelance",
  "Interest",
  "Gift",
  "Other",
] as const;

export type TransactionType = "income" | "expense";

export type Transaction = {
  id: string;
  description: string;
  amount: number;
  type: TransactionType;
  category: string;
  date: string;
};

export type CsvImportResult = {
  transactions: Transaction[];
};

export type RecurringPayment = {
  description: string;
  category: string;
  amount: number;
  frequency: "Weekly" | "Biweekly" | "Monthly" | "Quarterly";
  lastDate: string;
  occurrences: number;
};

function daysBetween(firstDate: string, secondDate: string) {
  const first = new Date(`${firstDate}T12:00:00`);
  const second = new Date(`${secondDate}T12:00:00`);
  return Math.round((second.getTime() - first.getTime()) / 86_400_000);
}

function recurringFrequency(medianDays: number) {
  if (medianDays >= 6 && medianDays <= 8) {
    return { label: "Weekly" as const, days: 7 };
  }
  if (medianDays >= 12 && medianDays <= 16) {
    return { label: "Biweekly" as const, days: 14 };
  }
  if (medianDays >= 26 && medianDays <= 35) {
    return { label: "Monthly" as const, days: 30 };
  }
  if (medianDays >= 80 && medianDays <= 100) {
    return { label: "Quarterly" as const, days: 90 };
  }
  return null;
}

// Words banks add to descriptors that say nothing about who was paid.
const DESCRIPTION_NOISE = new Set([
  "COM", "WWW", "INC", "LLC", "LTD", "CO", "CORP", "PAYMENT", "PMT", "PURCHASE",
  "POS", "DEBIT", "CARD", "ONLINE", "RECURRING", "AUTOPAY", "AUTO", "PAY",
  "SQ", "TST", "PP", "PAYPAL",
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
]);

// "NETFLIX.COM 866-579-7172 CA" and "Netflix" should be the same merchant.
export function normalizeMerchant(description: string) {
  const tokens = description
    .toUpperCase()
    .replace(/&/g, "")
    .split(/[^A-Z]+/)
    .filter((token) => token.length > 1 && !DESCRIPTION_NOISE.has(token));
  return tokens.length > 0 ? tokens.join(" ") : description.trim().toLowerCase();
}

function median(values: number[]) {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

// Splits charges into price tiers so a one-off fee billed under the same
// name (for example an annual fee) does not hide the regular charge.
function clusterByAmount(payments: Transaction[]) {
  const sorted = [...payments].sort((first, second) => first.amount - second.amount);
  const clusters: Transaction[][] = [];
  for (const payment of sorted) {
    const current = clusters.at(-1);
    if (current && payment.amount <= current.at(-1)!.amount * 1.12 + 0.5) {
      current.push(payment);
    } else {
      clusters.push([payment]);
    }
  }
  return clusters;
}

function detectCadence(payments: Transaction[]) {
  if (payments.length < 2) return null;

  const sorted = [...payments].sort((first, second) =>
    first.date.localeCompare(second.date),
  );
  const typicalAmount = median(sorted.map((payment) => payment.amount));
  // Price changes and tax swings are normal; wild swings are not a subscription.
  const tolerance = Math.max(1, typicalAmount * 0.25);
  if (sorted.some((payment) => Math.abs(payment.amount - typicalAmount) > tolerance)) {
    return null;
  }

  const intervals = sorted
    .slice(1)
    .map((payment, index) => daysBetween(sorted[index].date, payment.date));
  if (intervals.some((interval) => interval <= 0)) return null;

  const frequency = recurringFrequency(median(intervals));
  if (!frequency) return null;
  // Two charges are too easy to line up by chance at a long cadence.
  if (frequency.label === "Quarterly" && sorted.length < 3) return null;

  const regular = intervals.filter(
    (interval) =>
      interval >= frequency.days * 0.8 && interval <= frequency.days * 1.2,
  ).length;
  // With enough history, tolerate an occasional skipped or late payment.
  const required = intervals.length >= 5 ? Math.ceil(intervals.length * 0.8) : intervals.length;
  if (regular < required) return null;

  return { frequency, sorted };
}

const PAYMENTS_PER_MONTH: Record<RecurringPayment["frequency"], number> = {
  Weekly: 52 / 12,
  Biweekly: 26 / 12,
  Monthly: 1,
  Quarterly: 1 / 3,
};

export function getMonthlyCost(payment: RecurringPayment) {
  return payment.amount * PAYMENTS_PER_MONTH[payment.frequency];
}

export function findRecurringPayments(
  transactions: Transaction[],
  referenceMonth: string,
): RecurringPayment[] {
  const selectedYear = referenceMonth.slice(0, 4);
  if (!/^\d{4}$/.test(selectedYear)) return [];

  const paymentsByMerchant = transactions
    .filter(
      (transaction) =>
        transaction.type === "expense" &&
        transaction.date.startsWith(`${selectedYear}-`),
    )
    .reduce<Map<string, Transaction[]>>((groups, transaction) => {
      const key = `${normalizeMerchant(transaction.description)}\u0000${transaction.category.trim().toLowerCase()}`;
      const group = groups.get(key) ?? [];
      group.push(transaction);
      groups.set(key, group);
      return groups;
    }, new Map());

  return Array.from(paymentsByMerchant.values())
    .flatMap((payments) => {
      const whole = detectCadence(payments);
      const matches = whole
        ? [whole]
        : clusterByAmount(payments).flatMap((cluster) => {
            if (cluster.length < 3 || cluster.length < payments.length / 2) {
              return [];
            }
            const result = detectCadence(cluster);
            return result ? [result] : [];
          });

      return matches.map(({ frequency, sorted }) => {
        const lastPayment = sorted[sorted.length - 1];
        return {
          description: lastPayment.description,
          category: lastPayment.category,
          amount: lastPayment.amount,
          frequency: frequency.label,
          lastDate: lastPayment.date,
          occurrences: sorted.length,
        };
      });
    })
    .sort(
      (first, second) => getMonthlyCost(second) - getMonthlyCost(first),
    );
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];

    if (quoted) {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(value.trim());
      value = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (quoted) throw new Error("The CSV contains an unclosed quoted value.");

  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseCsvDate(value: string) {
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const usMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const match = isoMatch ?? usMatch;
  if (!match) return null;

  const [year, month, day] = isoMatch
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : [Number(match[3]), Number(match[1]), Number(match[2])];
  const date = new Date(year, month - 1, day);

  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? getLocalDateString(date)
    : null;
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

export function importTransactionsCsv(csv: string): CsvImportResult {
  const rows = parseCsvRows(csv.replace(/^\uFEFF/, ""));
  if (rows.length < 2) {
    throw new Error("Add a header row and at least one transaction.");
  }

  const headers = rows[0].map(normalizeHeader);
  const dateColumn = headers.findIndex(
    (header) =>
      header === "date" ||
      header === "postingdate" ||
      header === "transactiondate",
  );
  const descriptionColumn = headers.findIndex(
    (header) =>
      header === "description" ||
      header === "merchant" ||
      header === "name",
  );
  const amountColumn = headers.findIndex(
    (header) => header === "amount" || header === "expense",
  );
  const categoryColumn = headers.findIndex((header) => header === "category");
  const typeColumn = headers.findIndex((header) => header === "type");
  const creditDebitColumn = headers.findIndex(
    (header) => header === "creditdebitindicator",
  );

  if (dateColumn === -1 || descriptionColumn === -1 || amountColumn === -1) {
    throw new Error(
      "CSV needs a date, description, and amount column. Category and Type are optional.",
    );
  }

  const transactions = rows.slice(1).map((row, index) => {
    const rowNumber = index + 2;
    const date = parseCsvDate(row[dateColumn] ?? "");
    const description = (row[descriptionColumn] ?? "").trim();
    const amountValue = (row[amountColumn] ?? "")
      .replace(/[$,]/g, "")
      .replace(/^\((.*)\)$/, "-$1");
    const amount = Number(amountValue);
    const suppliedType = (row[typeColumn] ?? "").trim().toLowerCase();
    const creditDebit = (row[creditDebitColumn] ?? "").trim().toLowerCase();

    if (!date) {
      throw new Error(`Row ${rowNumber}: use a valid YYYY-MM-DD date.`);
    }
    if (!description) {
      throw new Error(`Row ${rowNumber}: add a description.`);
    }
    if (!Number.isFinite(amount) || amount === 0) {
      throw new Error(`Row ${rowNumber}: add a non-zero amount.`);
    }
    const type =
      suppliedType === "income" || suppliedType === "expense"
        ? suppliedType
        : creditDebit === "credit"
          ? "income"
          : "expense";

    return {
      id: crypto.randomUUID(),
      description,
      amount: Math.round(Math.abs(amount) * 100) / 100,
      type,
      category:
        (row[categoryColumn] ?? "").trim() ||
        (type === "income" ? INCOME_CATEGORIES[4] : EXPENSE_CATEGORIES[7]),
      date,
    } satisfies Transaction;
  });

  return { transactions };
}

function isTransaction(value: unknown): value is Transaction {
  if (!value || typeof value !== "object") return false;

  const transaction = value as Record<string, unknown>;
  const parsedDate =
    typeof transaction.date === "string"
      ? new Date(`${transaction.date}T00:00:00`)
      : null;
  return (
    typeof transaction.id === "string" &&
    typeof transaction.description === "string" &&
    typeof transaction.amount === "number" &&
    Number.isFinite(transaction.amount) &&
    transaction.amount > 0 &&
    (transaction.type === "income" || transaction.type === "expense") &&
    typeof transaction.category === "string" &&
    typeof transaction.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(transaction.date) &&
    parsedDate !== null &&
    !Number.isNaN(parsedDate.getTime()) &&
    getLocalDateString(parsedDate) === transaction.date
  );
}

export function readTransactions(): Transaction[] {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === null) return [];

  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed) || !parsed.every(isTransaction)) {
    throw new Error("Saved transactions are not in a valid format.");
  }

  return parsed;
}

export function writeTransactions(transactions: Transaction[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
}

export function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getMonthKey(date = new Date()) {
  return getLocalDateString(date).slice(0, 7);
}

export function getPreviousMonthKey(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return getMonthKey(new Date(year, monthNumber - 2, 1));
}

export function formatMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, monthNumber - 1, 1));
}

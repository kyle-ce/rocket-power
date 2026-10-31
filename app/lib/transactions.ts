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
  nextDate: string;
  occurrences: number;
};

function daysBetween(firstDate: string, secondDate: string) {
  const first = new Date(`${firstDate}T12:00:00`);
  const second = new Date(`${secondDate}T12:00:00`);
  return Math.round((second.getTime() - first.getTime()) / 86_400_000);
}

function recurringFrequency(averageDays: number) {
  if (averageDays >= 6 && averageDays <= 8) {
    return { label: "Weekly" as const, days: 7 };
  }
  if (averageDays >= 12 && averageDays <= 16) {
    return { label: "Biweekly" as const, days: 14 };
  }
  if (averageDays >= 26 && averageDays <= 35) {
    return { label: "Monthly" as const, days: 30 };
  }
  if (averageDays >= 80 && averageDays <= 100) {
    return { label: "Quarterly" as const, days: 90 };
  }
  return null;
}

export function findRecurringPayments(
  transactions: Transaction[],
  referenceMonth: string,
): RecurringPayment[] {
  const selectedYear = referenceMonth.slice(0, 4);
  if (!/^\d{4}$/.test(selectedYear)) return [];

  const paymentsByDescription = transactions
    .filter(
      (transaction) =>
        transaction.type === "expense" &&
        transaction.date.startsWith(`${selectedYear}-`),
    )
    .reduce<Map<string, Transaction[]>>((groups, transaction) => {
      const key = `${transaction.description.trim().toLowerCase()}\u0000${transaction.category.trim().toLowerCase()}`;
      const group = groups.get(key) ?? [];
      group.push(transaction);
      groups.set(key, group);
      return groups;
    }, new Map());

  return Array.from(paymentsByDescription.values())
    .flatMap((payments) => {
      if (payments.length < 2) return [];

      const sortedPayments = [...payments].sort((first, second) =>
        first.date.localeCompare(second.date),
      );
      const referenceAmount = sortedPayments[0].amount;
      const amountTolerance = Math.max(1, referenceAmount * 0.05);
      if (
        sortedPayments.some(
          (payment) =>
            Math.abs(payment.amount - referenceAmount) > amountTolerance,
        )
      ) {
        return [];
      }

      const intervals = sortedPayments
        .slice(1)
        .map((payment, index) =>
          daysBetween(sortedPayments[index].date, payment.date),
        );
      if (intervals.some((interval) => interval <= 0)) return [];
      const averageDays =
        intervals.reduce((total, interval) => total + interval, 0) /
        intervals.length;
      const frequency = recurringFrequency(averageDays);
      if (!frequency) return [];
      if (
        intervals.some(
          (interval) =>
            interval < frequency.days * 0.8 ||
            interval > frequency.days * 1.2,
        )
      ) {
        return [];
      }

      const lastPayment = sortedPayments.at(-1);
      if (!lastPayment) return [];
      const nextDate = new Date(`${lastPayment.date}T12:00:00`);
      nextDate.setDate(nextDate.getDate() + frequency.days);

      return [
        {
          description: lastPayment.description,
          category: lastPayment.category,
          amount: referenceAmount,
          frequency: frequency.label,
          nextDate: getLocalDateString(nextDate),
          occurrences: sortedPayments.length,
        },
      ];
    })
    .sort((first, second) => second.amount - first.amount);
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

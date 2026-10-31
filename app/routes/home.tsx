import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import type { Route } from "./+types/home";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  Trash2,
  Upload,
  Wallet,
} from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import {
  EXPENSE_CATEGORIES,
  findRecurringPayments,
  formatMonth,
  getLocalDateString,
  getMonthKey,
  importTransactionsCsv,
  INCOME_CATEGORIES,
  readTransactions,
  type Transaction,
  type TransactionType,
  writeTransactions,
} from "~/lib/transactions";

type TransactionDraft = {
  description: string;
  amount: string;
  type: TransactionType;
  category: string;
  date: string;
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const categories = [
  ...new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES]),
];
const categoryColors = Array.from(
  { length: 8 },
  (_, index) => `var(--category-${index + 1})`,
);

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function getDefaultDraft(): TransactionDraft {
  return {
    description: "",
    amount: "",
    type: "expense",
    category: EXPENSE_CATEGORIES[0],
    date: getLocalDateString(),
  };
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Spending Snapshot" },
    {
      name: "description",
      content: "A clear picture of your personal finances.",
    },
  ];
}

export default function Home() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(getMonthKey());
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TransactionDraft>(getDefaultDraft);
  const [formError, setFormError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const csvInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      setTransactions(readTransactions());
    } catch (error) {
      setStorageError(
        error instanceof Error
          ? error.message
          : "Could not read saved transactions.",
      );
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady || storageError) return;

    try {
      writeTransactions(transactions);
    } catch (error) {
      setStorageError(
        error instanceof Error
          ? `Could not save your transactions: ${error.message}`
          : "Could not save your transactions.",
      );
    }
  }, [storageReady, storageError, transactions]);

  const monthTransactions = useMemo(
    () =>
      transactions.filter(
        (transaction) => transaction.date.slice(0, 7) === selectedMonth,
      ),
    [selectedMonth, transactions],
  );
  const { income, expenses } = useMemo(
    () =>
      monthTransactions.reduce(
        (totals, transaction) => {
          totals[transaction.type === "income" ? "income" : "expenses"] +=
            transaction.amount;
          return totals;
        },
        { income: 0, expenses: 0 },
      ),
    [monthTransactions],
  );
  const categorySpending = useMemo(
    () =>
      Object.entries(
        monthTransactions
          .filter((transaction) => transaction.type === "expense")
          .reduce<Record<string, number>>((totals, transaction) => {
            totals[transaction.category] =
              (totals[transaction.category] ?? 0) + transaction.amount;
            return totals;
          }, {}),
      ).sort(([, firstAmount], [, secondAmount]) => secondAmount - firstAmount),
    [monthTransactions],
  );
  const chartCategories = useMemo<[string, number][]>(() => {
    const largestCategories = categorySpending.slice(0, 5);
    const remainingAmount = categorySpending
      .slice(5)
      .reduce((total, [, amount]) => total + amount, 0);

    return remainingAmount > 0
      ? [
          ...largestCategories,
          ["Remaining categories", remainingAmount] as [string, number],
        ]
      : largestCategories;
  }, [categorySpending]);
  const categorySlices = useMemo(() => {
    let offset = 0;

    return chartCategories.map(([category, amount], index) => {
      const percentage = (amount / expenses) * 100;
      const slice = {
        category,
        amount,
        percentage,
        offset,
        color: categoryColors[index % categoryColors.length],
      };
      offset += percentage;
      return slice;
    });
  }, [chartCategories, expenses]);
  const recurringPayments = useMemo(
    () => findRecurringPayments(transactions, selectedMonth),
    [selectedMonth, transactions],
  );
  const filteredTransactions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return monthTransactions
      .filter((transaction) => {
        const matchesSearch =
          !query ||
          transaction.description.toLowerCase().includes(query) ||
          transaction.category.toLowerCase().includes(query);
        const matchesType =
          typeFilter === "all" || transaction.type === typeFilter;
        const matchesCategory =
          categoryFilter === "all" || transaction.category === categoryFilter;
        return matchesSearch && matchesType && matchesCategory;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [categoryFilter, monthTransactions, search, typeFilter]);

  const openNewTransaction = () => {
    setEditingId(null);
    setDraft(getDefaultDraft());
    setFormError("");
    setDialogOpen(true);
  };

  const openEditTransaction = (transaction: Transaction) => {
    setEditingId(transaction.id);
    setDraft({
      description: transaction.description,
      amount: String(transaction.amount),
      type: transaction.type,
      category: transaction.category,
      date: transaction.date,
    });
    setFormError("");
    setDialogOpen(true);
  };

  const handleTypeChange = (type: TransactionType) => {
    setDraft({
      ...draft,
      type,
      category:
        type === "expense" ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0],
    });
  };

  const saveTransaction = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(draft.amount);
    if (!draft.description.trim()) {
      setFormError("Add a name for this transaction.");
      return;
    }
    const cents = Math.round((amount + Number.EPSILON) * 100);
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      Math.abs(amount * 100 - cents) > 1e-7
    ) {
      setFormError(
        "Enter an amount greater than zero with up to two decimals.",
      );
      return;
    }
    const date = new Date(`${draft.date}T00:00:00`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) ||
      Number.isNaN(date.getTime()) ||
      getLocalDateString(date) !== draft.date
    ) {
      setFormError("Choose a valid transaction date.");
      return;
    }
    const normalizedAmount = cents / 100;

    if (editingId) {
      setTransactions((current) =>
        current.map((transaction) =>
          transaction.id === editingId
            ? {
                ...transaction,
                ...draft,
                description: draft.description.trim(),
                amount: normalizedAmount,
              }
            : transaction,
        ),
      );
    } else {
      setTransactions((current) => [
        {
          id: crypto.randomUUID(),
          ...draft,
          description: draft.description.trim(),
          amount: normalizedAmount,
        },
        ...current,
      ]);
    }
    setDialogOpen(false);
  };

  const deleteTransaction = (transaction: Transaction) => {
    if (!window.confirm(`Delete "${transaction.description}"?`)) return;
    setTransactions((current) =>
      current.filter((item) => item.id !== transaction.id),
    );
  };

  const handleCsvUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportMessage("");
    try {
      const { transactions: importedTransactions } = importTransactionsCsv(
        await file.text(),
      );
      setTransactions((current) => [...importedTransactions, ...current]);
      setImportMessage(
        `${importedTransactions.length} transaction${
          importedTransactions.length === 1 ? "" : "s"
        } imported.`,
      );
    } catch (error) {
      setImportMessage(
        error instanceof Error ? error.message : "Could not import that CSV.",
      );
    } finally {
      event.target.value = "";
    }
  };

  const categoriesForDraft =
    draft.type === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;

  return (
    <div className="min-h-screen bg-muted/30 text-foreground">
      <header className="border-b border-border/70 bg-background">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <Wallet className="size-4" />
            </span>
            <span className="font-heading text-sm font-semibold">
              Spending Snapshot
            </span>
          </div>
          <label className="relative">
            {/* <CalendarDays className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /> */}
            <Input
              type="month"
              aria-label="Select month"
              value={selectedMonth}
              onClick={(event) => {
                if (typeof event.currentTarget.showPicker === "function") {
                  event.currentTarget.showPicker();
                }
              }}
              onChange={(event) => setSelectedMonth(event.target.value)}
              className="h-9 pl-9"
            />
          </label>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {storageError && (
          <div
            role="alert"
            className="mb-6 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            {storageError} Your saved data has not been changed.
          </div>
        )}

        <section className="mb-6">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Expenses
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Import a CSV to keep a simple record for{" "}
            {formatMonth(selectedMonth)}.
          </p>
          <dl className="mt-5 flex divide-x divide-border rounded-lg border border-border/70 bg-background text-sm">
            <div className="flex-1 px-4 py-3">
              <dt className="text-muted-foreground">Income</dt>
              <dd className="mt-1 font-medium tabular-nums">
                {currency.format(income)}
              </dd>
            </div>
            <div className="flex-1 px-4 py-3">
              <dt className="text-muted-foreground">Expenses</dt>
              <dd className="mt-1 font-medium tabular-nums">
                {currency.format(expenses)}
              </dd>
            </div>
          </dl>
          <figure className="mt-5 rounded-lg border border-border/70 bg-background p-5">
            <figcaption className="mb-5 text-sm font-medium">
              Spending by category
            </figcaption>
            {categorySpending.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Import expenses to see where you spend the most.
              </p>
            ) : (
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                <div className="relative mx-auto size-40 shrink-0">
                  <svg
                    viewBox="0 0 36 36"
                    role="img"
                    aria-label="Expense share by category"
                    className="size-full -rotate-90"
                  >
                    <circle
                      cx="18"
                      cy="18"
                      r="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="5"
                      className="text-muted"
                    />
                    {categorySlices.map((slice) => (
                      <circle
                        key={slice.category}
                        cx="18"
                        cy="18"
                        r="14"
                        fill="none"
                        stroke={slice.color}
                        strokeWidth="5"
                        pathLength="100"
                        strokeDasharray={`${slice.percentage} ${100 - slice.percentage}`}
                        strokeDashoffset={-slice.offset}
                      />
                    ))}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xs text-muted-foreground">
                      Expenses
                    </span>
                    <span className="text-sm font-semibold tabular-nums">
                      {currency.format(expenses)}
                    </span>
                  </div>
                </div>
                <ul className="min-w-0 flex-1 space-y-2.5">
                  {categorySlices.map((slice) => (
                    <li
                      key={slice.category}
                      className="flex items-center justify-between gap-4 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: slice.color }}
                        />
                        <span className="truncate">{slice.category}</span>
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">
                        {slice.percentage.toFixed(0)}% ·{" "}
                        {currency.format(slice.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </figure>
          <section className="mt-5 rounded-lg border border-border/70 bg-background p-5">
            <div className="mb-1">
              <h2 className="text-sm font-medium">
                Possible subscriptions
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Similar charges with regular timing across{" "}
                {selectedMonth.slice(0, 4)}.
              </p>
            </div>
            {recurringPayments.length === 0 ? (
              <p className="mt-5 text-sm text-muted-foreground">
                No likely subscriptions found for {selectedMonth.slice(0, 4)}.
                At least two similar payments with regular dates are needed.
              </p>
            ) : (
              <ul className="mt-5 divide-y divide-border">
                {recurringPayments.map((payment) => (
                  <li
                    key={`${payment.description}-${payment.category}`}
                    className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {payment.description}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {payment.frequency} · next around{" "}
                        {formatDate(payment.nextDate)} · {payment.occurrences}{" "}
                        payments this year
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-medium tabular-nums text-destructive">
                      {currency.format(payment.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <Card className="mt-5 border-border/70 shadow-none">
            <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">Import expense data</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  CSV columns: Date, Description, Amount. Category and Type are
                  optional.
                </p>
              </div>
              <Button
                onClick={() => csvInputRef.current?.click()}
                className="w-full sm:w-auto"
              >
                <Upload />
                Upload CSV
              </Button>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => void handleCsvUpload(event)}
                className="sr-only"
              />
            </CardContent>
            {importMessage && (
              <p
                role="status"
                className={`border-t border-border/60 px-5 py-3 text-sm ${
                  importMessage.endsWith("imported.")
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-destructive"
                }`}
              >
                {importMessage}
              </p>
            )}
          </Card>
        </section>

        <section id="transactions" className="scroll-mt-24 pb-10">
          <Card className="border-border/70 shadow-none">
            <CardHeader className="gap-4 border-b border-border/60 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">Transactions</CardTitle>
                <CardDescription className="mt-1">
                  {monthTransactions.length}{" "}
                  {monthTransactions.length === 1
                    ? "transaction"
                    : "transactions"}{" "}
                  in {formatMonth(selectedMonth)}
                </CardDescription>
              </div>
              <Button
                variant="outline"
                onClick={openNewTransaction}
                className="w-full sm:w-auto"
              >
                <Plus />
                Add transaction
              </Button>
            </CardHeader>
            <div className="flex flex-col gap-2 border-b border-border/60 p-4 sm:flex-row">
              <label className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search transactions"
                  aria-label="Search transactions"
                  className="pl-9"
                />
              </label>
              <select
                aria-label="Filter by type"
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
                className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="all">All types</option>
                <option value="expense">Expenses</option>
                <option value="income">Income</option>
              </select>
              <select
                aria-label="Filter by category"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="all">All categories</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
            {filteredTransactions.length === 0 ? (
              <div className="flex min-h-56 flex-col items-center justify-center px-5 py-10 text-center">
                <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  {monthTransactions.length === 0 ? (
                    <ReceiptText className="size-5" />
                  ) : (
                    <Search className="size-5" />
                  )}
                </span>
                <p className="text-sm font-medium">
                  {monthTransactions.length === 0
                    ? "No transactions for this month"
                    : "No matching transactions"}
                </p>
                <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                  {monthTransactions.length === 0
                    ? "Upload a CSV above to start your record, or add one manually."
                    : "Try another search or adjust your filters."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[690px] text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                      <th className="px-5 py-3 font-medium">Description</th>
                      <th className="px-4 py-3 font-medium">Category</th>
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 text-right font-medium">
                        Amount
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTransactions.map((transaction) => (
                      <tr
                        key={transaction.id}
                        className="border-b border-border/50 last:border-0 hover:bg-muted/30"
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <span
                              className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                                transaction.type === "income"
                                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-400"
                                  : "bg-destructive/10 text-destructive"
                              }`}
                            >
                              {transaction.type === "income" ? (
                                <ArrowUpRight className="size-[18px]" />
                              ) : (
                                <ArrowDownRight className="size-[18px]" />
                              )}
                            </span>
                            <span className="font-medium">
                              {transaction.description}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <Badge variant="secondary" className="font-normal">
                            {transaction.category}
                          </Badge>
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground">
                          {formatDate(transaction.date)}
                        </td>
                        <td
                          className={`px-4 py-3.5 text-right font-medium tabular-nums ${
                            transaction.type === "income"
                              ? "text-emerald-700 dark:text-emerald-400"
                              : "text-destructive"
                          }`}
                        >
                          {transaction.type === "income" ? "+" : "−"}
                          {currency.format(transaction.amount)}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Edit ${transaction.description}`}
                              onClick={() => openEditTransaction(transaction)}
                            >
                              <Pencil />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Delete ${transaction.description}`}
                              onClick={() => deleteTransaction(transaction)}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {filteredTransactions.length > 0 && (
              <div className="border-t border-border/60 px-5 py-3 text-xs text-muted-foreground">
                <span>
                  Showing {filteredTransactions.length} of{" "}
                  {monthTransactions.length} transactions
                </span>
              </div>
            )}
          </Card>
        </section>
        <footer className="pb-4 text-center text-xs text-muted-foreground">
          Your transactions stay on this device.
        </footer>
      </main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit transaction" : "Add a transaction"}
            </DialogTitle>
            <DialogDescription>
              Record income or an expense to keep your snapshot up to date.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveTransaction} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="transaction-description"
                className="text-sm font-medium"
              >
                Description
              </label>
              <Input
                id="transaction-description"
                autoFocus
                placeholder="e.g. Grocery run"
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
                maxLength={100}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="transaction-amount"
                  className="text-sm font-medium"
                >
                  Amount
                </label>
                <Input
                  id="transaction-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={draft.amount}
                  onChange={(event) =>
                    setDraft({ ...draft, amount: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="transaction-type"
                  className="text-sm font-medium"
                >
                  Type
                </label>
                <select
                  id="transaction-type"
                  value={draft.type}
                  onChange={(event) => {
                    if (
                      event.target.value === "income" ||
                      event.target.value === "expense"
                    ) {
                      handleTypeChange(event.target.value);
                    }
                  }}
                  className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="transaction-category"
                  className="text-sm font-medium"
                >
                  Category
                </label>
                <select
                  id="transaction-category"
                  value={draft.category}
                  onChange={(event) =>
                    setDraft({ ...draft, category: event.target.value })
                  }
                  className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {categoriesForDraft.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="transaction-date"
                  className="text-sm font-medium"
                >
                  Date
                </label>
                <Input
                  id="transaction-date"
                  type="date"
                  value={draft.date}
                  onChange={(event) =>
                    setDraft({ ...draft, date: event.target.value })
                  }
                />
              </div>
            </div>
            {formError && (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">
                {editingId ? "Save changes" : "Add transaction"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

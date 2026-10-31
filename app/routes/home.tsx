import {
  useEffect,
  useLayoutEffect,
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
  ChevronDown,
  Pencil,
  ReceiptText,
  Rocket,
  Search,
  Upload,
} from "lucide-react";
import { MonthPicker } from "~/components/month-picker";
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
  getMonthlyCost,
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

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const categoryColors = Array.from(
  { length: 8 },
  (_, index) => `var(--category-${index + 1})`,
);

const frequencySuffix = {
  Weekly: "/ wk",
  Biweekly: "/ 2 wks",
  Monthly: "/ mo",
  Quarterly: "/ qtr",
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Rocket Power" },
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
  const [editingTransaction, setEditingTransaction] =
    useState<Transaction | null>(null);
  const [draftCategory, setDraftCategory] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [subscriptionsOpen, setSubscriptionsOpen] = useState(false);
  const [subscriptionsExpanded, setSubscriptionsExpanded] = useState(false);
  const [fitCount, setFitCount] = useState(Infinity);
  const subscriptionListRef = useRef<HTMLUListElement>(null);
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
  const filterCategories = useMemo(() => {
    const names = new Set(monthTransactions.map((item) => item.category));
    if (categoryFilter !== "all") names.add(categoryFilter);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [categoryFilter, monthTransactions]);
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
  const monthlySubscriptionCost = useMemo(
    () =>
      recurringPayments.reduce(
        (total, payment) => total + getMonthlyCost(payment),
        0,
      ),
    [recurringPayments],
  );
  const subscriptionCount = recurringPayments.length;
  const fitSubscriptions = !subscriptionsExpanded && subscriptionCount > 0;

  // On wide screens the open card stretches to its sibling column's height, so
  // measure how many rows fit instead of letting the list set the height.
  useLayoutEffect(() => {
    const list = subscriptionListRef.current;
    if (!list || !fitSubscriptions) return;

    const measure = () => {
      const row = list.firstElementChild;
      // Rows stretch to fill leftover space, so measure their minimum height.
      const minHeight = row ? parseFloat(getComputedStyle(row).minHeight) : NaN;
      const rowHeight =
        minHeight > 0 ? minHeight : row?.getBoundingClientRect().height;
      if (!rowHeight || !list.clientHeight) {
        setFitCount(Infinity);
        return;
      }
      setFitCount(Math.max(1, Math.floor(list.clientHeight / rowHeight)));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [fitSubscriptions, subscriptionCount]);

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

  const openEditTransaction = (transaction: Transaction) => {
    setEditingTransaction(transaction);
    setDraftCategory(transaction.category);
    setDialogOpen(true);
  };

  const saveTransaction = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingTransaction) return;

    setTransactions((current) =>
      current.map((transaction) =>
        transaction.id === editingTransaction.id
          ? { ...transaction, category: draftCategory }
          : transaction,
      ),
    );
    setDialogOpen(false);
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

  const categoryOptions = useMemo(() => {
    if (!editingTransaction) return [];
    const defaults: readonly string[] =
      editingTransaction.type === "income"
        ? INCOME_CATEGORIES
        : EXPENSE_CATEGORIES;
    const imported = transactions
      .filter((item) => item.type === editingTransaction.type)
      .map((item) => item.category)
      .filter((category) => !defaults.includes(category));
    return [...defaults, ...[...new Set(imported)].sort()];
  }, [editingTransaction, transactions]);

  return (
    <div className="min-h-screen bg-muted/30 text-foreground">
      <header className="border-b border-border/70 bg-background">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-purple-600 text-white">
              <Rocket className="size-4" />
            </span>
            <span className="truncate font-heading text-sm font-semibold">
              Rocket Power
            </span>
          </div>
          <MonthPicker value={selectedMonth} onChange={setSelectedMonth} />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
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
          <div className="mt-5 grid gap-5 lg:grid-cols-2 lg:items-start">
            <div className="space-y-5 lg:col-start-2 lg:row-start-1">
              <dl className="flex divide-x divide-border rounded-lg border border-border/70 bg-background text-sm">
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
              <figure className="rounded-lg border border-border/70 bg-background p-5">
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
            </div>
            <section
              className={`rounded-lg border border-border/70 bg-background lg:col-start-1 lg:row-start-1 ${
                fitSubscriptions ? "lg:relative lg:self-stretch" : ""
              }`}
            >
              <div
                className={
                  fitSubscriptions ? "flex flex-col lg:absolute lg:inset-0" : ""
                }
              >
                <div className="relative shrink-0 p-5">
                  <h2 className="text-sm font-medium">
                    {recurringPayments.length > 0 ? (
                      <>
                        <span className="hidden lg:inline">Subscriptions</span>
                        <button
                          type="button"
                          aria-expanded={subscriptionsOpen}
                          aria-controls="subscriptions-list"
                          onClick={() => setSubscriptionsOpen((open) => !open)}
                          className="flex w-full items-center justify-between gap-2 rounded-md text-left outline-none after:absolute after:inset-0 focus-visible:ring-3 focus-visible:ring-ring/50 lg:hidden"
                        >
                          Subscriptions
                          <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                            {subscriptionsOpen ? "Hide" : "Show all"}
                            <ChevronDown
                              aria-hidden="true"
                              className={`size-4 transition-transform ${subscriptionsOpen ? "rotate-180" : ""}`}
                            />
                          </span>
                        </button>
                      </>
                    ) : (
                      "Subscriptions"
                    )}
                  </h2>
                  <p className="mt-4 text-3xl font-semibold tabular-nums">
                    {currency.format(monthlySubscriptionCost)}
                    <span className="ml-1 text-sm font-normal text-muted-foreground">
                      / month
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {recurringPayments.length}{" "}
                    {recurringPayments.length === 1
                      ? "subscription"
                      : "subscriptions"}{" "}
                    · about {currency.format(monthlySubscriptionCost * 12)} a
                    year · based on {selectedMonth.slice(0, 4)}
                  </p>
                </div>
                {recurringPayments.length === 0 ? (
                  <p className="border-t border-border/60 p-5 text-sm text-muted-foreground">
                    No likely subscriptions found for{" "}
                    {selectedMonth.slice(0, 4)}. At least two similar payments
                    with regular dates are needed.
                  </p>
                ) : (
                  <ul
                    id="subscriptions-list"
                    ref={subscriptionListRef}
                    className={`divide-y divide-border/60 border-t border-border/60 ${
                      subscriptionsOpen ? "" : "hidden lg:flex"
                    } lg:flex-col ${
                      fitSubscriptions
                        ? "lg:min-h-0 lg:flex-1 lg:overflow-hidden"
                        : ""
                    }`}
                  >
                    {recurringPayments.map((payment, index) => {
                      const monthlyCost = getMonthlyCost(payment);
                      return (
                        <li
                          key={`${payment.description}-${payment.category}`}
                          className={`flex items-center gap-3 px-5 py-3.5 lg:min-h-[4.5rem] ${
                            !fitSubscriptions
                              ? "lg:shrink-0"
                              : index >= fitCount
                                ? "lg:hidden"
                                : "lg:flex-1"
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                            style={{
                              backgroundColor:
                                categoryColors[
                                  Array.from(payment.description).reduce(
                                    (sum, character) =>
                                      sum + character.charCodeAt(0),
                                    0,
                                  ) % categoryColors.length
                                ],
                            }}
                          >
                            {payment.description.trim().charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {payment.description}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {payment.category} · last charged{" "}
                              {formatDate(payment.lastDate)}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-semibold tabular-nums">
                              {currency.format(payment.amount)}
                              <span className="ml-0.5 text-xs font-normal text-muted-foreground">
                                {frequencySuffix[payment.frequency]}
                              </span>
                            </p>
                            {payment.frequency !== "Monthly" && (
                              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                                {currency.format(monthlyCost)} / mo
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {subscriptionCount > fitCount && (
                  <button
                    type="button"
                    onClick={() =>
                      setSubscriptionsExpanded((expanded) => !expanded)
                    }
                    className="hidden w-full shrink-0 items-center justify-center border-t border-border/60 px-5 py-3 text-sm font-medium text-muted-foreground outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 lg:flex"
                  >
                    {subscriptionsExpanded
                      ? "Show fewer"
                      : `+${subscriptionCount - fitCount} more`}
                  </button>
                )}
              </div>
            </section>
            <Card className="border-border/70 shadow-none lg:col-span-2">
              <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">Import expense data</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    CSV columns: Date, Description, Amount. Category and Type
                    are optional.
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
            <section id="transactions" className="scroll-mt-24 lg:col-span-2">
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
                    {filterCategories.map((category) => (
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
                        ? "Upload a CSV above to get started."
                        : "Try another search or adjust your filters."}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                          <th className="px-4 py-3 font-medium sm:px-5">
                            Description
                          </th>
                          <th className="hidden px-4 py-3 font-medium md:table-cell">
                            Category
                          </th>
                          <th className="hidden px-4 py-3 font-medium md:table-cell">
                            Date
                          </th>
                          <th className="px-2 py-3 text-right font-medium sm:px-4">
                            Amount
                          </th>
                          <th className="px-2 py-3 text-right font-medium sm:px-4">
                            <span className="sr-only sm:not-sr-only">
                              Actions
                            </span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTransactions.map((transaction) => (
                          <tr
                            key={transaction.id}
                            className="border-b border-border/50 last:border-0 hover:bg-muted/30"
                          >
                            <td className="px-4 py-3.5 sm:px-5">
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
                                <div className="min-w-0">
                                  <span className="block font-medium break-words">
                                    {transaction.description}
                                  </span>
                                  <span className="mt-0.5 block text-xs text-muted-foreground md:hidden">
                                    {transaction.category} ·{" "}
                                    {formatDate(transaction.date)}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="hidden px-4 py-3.5 md:table-cell">
                              <Badge
                                variant="secondary"
                                className="font-normal"
                              >
                                {transaction.category}
                              </Badge>
                            </td>
                            <td className="hidden px-4 py-3.5 whitespace-nowrap text-muted-foreground md:table-cell">
                              {formatDate(transaction.date)}
                            </td>
                            <td
                              className={`px-2 py-3.5 text-right font-medium whitespace-nowrap tabular-nums sm:px-4 ${
                                transaction.type === "income"
                                  ? "text-emerald-700 dark:text-emerald-400"
                                  : "text-destructive"
                              }`}
                            >
                              {transaction.type === "income" ? "+" : "−"}
                              {currency.format(transaction.amount)}
                            </td>
                            <td className="px-2 py-3.5 sm:px-4">
                              <div className="flex justify-end gap-0.5 sm:gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`Edit ${transaction.description}`}
                                  onClick={() =>
                                    openEditTransaction(transaction)
                                  }
                                >
                                  <Pencil />
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
          </div>
        </section>
        <div className="pb-6" />

        <footer className="pb-4 text-center text-xs text-muted-foreground">
          Your transactions stay on this device.
        </footer>
      </main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit category</DialogTitle>
            <DialogDescription>
              {editingTransaction?.description}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveTransaction} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="transaction-category"
                className="text-sm font-medium"
              >
                Category
              </label>
              <select
                id="transaction-category"
                value={draftCategory}
                onChange={(event) => setDraftCategory(event.target.value)}
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Save changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

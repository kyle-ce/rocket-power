import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home, { meta } from "./home";
import {
  getLocalDateString,
  getMonthKey,
  STORAGE_KEY,
  type Transaction,
} from "~/lib/transactions";

const month = getMonthKey();
const day = (dayOfMonth: number) => `${month}-${String(dayOfMonth).padStart(2, "0")}`;

const seed = (transactions: Transaction[]) =>
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));

const saved = (): Transaction[] =>
  JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");

const tx = (
  id: string,
  overrides: Partial<Transaction> = {},
): Transaction => ({
  id,
  description: "Shopping",
  amount: 100,
  type: "expense",
  category: "Food & dining",
  date: day(2),
  ...overrides,
});

describe("meta", () => {
  it("sets the document title and description", () => {
    expect(meta({} as never)).toEqual([
      { title: "Rocket Power" },
      expect.objectContaining({ name: "description" }),
    ]);
  });
});

describe("Home dashboard", () => {
  beforeEach(() => {
    let counter = 0;
    vi.spyOn(crypto, "randomUUID").mockImplementation(
      () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows empty states when there is no data", async () => {
    render(<Home />);

    expect(await screen.findByText("No transactions for this month")).toBeInTheDocument();
    expect(screen.getByText(/Import expenses to see/)).toBeInTheDocument();
    expect(screen.getByText(/No likely subscriptions found/)).toBeInTheDocument();
    expect(screen.getByText("0 transactions in", { exact: false })).toBeInTheDocument();
  });

  it("summarizes income, expenses, and categories for the month", async () => {
    seed([
      tx("1", { amount: 300 }),
      tx("2", { amount: 100, category: "Transport", description: "Bus" }),
      tx("3", { type: "income", amount: 2000, category: "Salary", description: "Pay" }),
      tx("4", { date: "2001-01-01", amount: 999 }),
    ]);
    render(<Home />);

    const summary = (await screen.findByText("Income", { selector: "dt" })).closest("dl")!;
    expect(within(summary).getByText("$2,000.00")).toBeInTheDocument();
    expect(within(summary).getByText("$400.00")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Expense share by category" })).toBeInTheDocument();
    expect(screen.getByText("75% · $300.00")).toBeInTheDocument();
    expect(screen.getByText("25% · $100.00")).toBeInTheDocument();
    expect(screen.getByText("3 transactions in", { exact: false })).toBeInTheDocument();
  });

  it("groups categories beyond the top five", async () => {
    const names = ["A", "B", "C", "D", "E", "F", "G"];
    seed(names.map((name, index) => tx(name, { category: name, amount: 100 - index })));
    render(<Home />);

    expect(await screen.findByText("Remaining categories")).toBeInTheDocument();
  });

  it("switches month and shows that month's data", async () => {
    seed([
      tx("now", { description: "This month" }),
      tx("old", { description: "Old purchase", date: "2020-03-10" }),
    ]);
    render(<Home />);
    expect(await screen.findByText("This month")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Select month" }));
    const current = Number(month.slice(0, 4));
    for (let year = current; year > 2020; year--) {
      await user.click(screen.getByRole("button", { name: "Previous year" }));
    }
    await user.click(screen.getByRole("button", { name: "Mar" }));

    expect(screen.getByText("Old purchase")).toBeInTheDocument();
    expect(screen.queryByText("This month")).not.toBeInTheDocument();
    expect(screen.getByText("1 transaction in", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/March 2020/, { selector: "p" })).toBeInTheDocument();
  });

  it("marks the selected month and moves between years", async () => {
    const user = userEvent.setup();
    render(<Home />);
    await user.click(await screen.findByRole("button", { name: "Select month" }));

    const monthIndex = Number(month.slice(5, 7)) - 1;
    const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    expect(screen.getByRole("button", { name: labels[monthIndex] })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Next year" }));
    expect(screen.getByText(String(Number(month.slice(0, 4)) + 1))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: labels[monthIndex] })).toHaveAttribute("aria-pressed", "false");
  });

  it("lists detected subscriptions for the selected year", async () => {
    const year = month.slice(0, 4);
    seed([
      tx("1", { description: "Streaming", amount: 15, date: `${year}-01-05` }),
      tx("2", { description: "Streaming", amount: 15, date: `${year}-02-05` }),
      tx("3", { description: "Streaming", amount: 15, date: `${year}-03-05` }),
    ]);
    render(<Home />);

    // Phones and tablets: collapsed until opened. Desktop CSS keeps the list shown.
    const toggle = await screen.findByRole("button", { name: /Subscriptions/ });
    const list = document.getElementById("subscriptions-list")!;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(list).toHaveClass("hidden", "lg:flex");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(list).not.toHaveClass("hidden");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(list).toHaveClass("hidden");
    expect(screen.getByRole("heading", { name: /Subscriptions/ })).toBeInTheDocument();
    expect(screen.getByText("1 subscription", { exact: false })).toHaveTextContent("about $180.00 a year");
  });

  describe("subscription card height fitting", () => {
    const year = month.slice(0, 4);
    const merchants = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];

    beforeEach(() => {
      seed(
        merchants.flatMap((name, index) =>
          [1, 2, 3].map((m) =>
            tx(`${name}${m}`, {
              description: name,
              amount: 50 - index * 10,
              date: `${year}-0${m}-05`,
            }),
          ),
        ),
      );
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
        height: 68,
      } as DOMRect);
      Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        configurable: true,
        get() {
          return this.id === "subscriptions-list" ? 150 : 0;
        },
      });
    });
    afterEach(() => {
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    });

    const rows = () =>
      within(document.getElementById("subscriptions-list")!).getAllByRole("listitem");
    const hiddenRows = () => rows().filter((row) => row.className.includes("lg:hidden"));

    it("shows only the rows that fit on load, with a +N more row", async () => {
      render(<Home />);
      await screen.findByRole("button", { name: /Subscriptions/ });

      expect(hiddenRows()).toHaveLength(3);
      expect(screen.getByRole("button", { name: "+3 more" })).toBeInTheDocument();
    });

    it("expands to every subscription and can collapse again", async () => {
      render(<Home />);
      await screen.findByRole("button", { name: /Subscriptions/ });

      await userEvent.click(screen.getByRole("button", { name: "+3 more" }));
      expect(hiddenRows()).toHaveLength(0);

      await userEvent.click(screen.getByRole("button", { name: "Show fewer" }));
      expect(hiddenRows()).toHaveLength(3);
    });

    it("returns to the fitted view with Show fewer", async () => {
      render(<Home />);
      await screen.findByRole("button", { name: /Subscriptions/ });
      await userEvent.click(screen.getByRole("button", { name: "+3 more" }));
      expect(hiddenRows()).toHaveLength(0);
      await userEvent.click(screen.getByRole("button", { name: "Show fewer" }));

      expect(hiddenRows()).toHaveLength(3);
    });

    it("always keeps at least one row when there is very little room", async () => {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        configurable: true,
        get() {
          return this.id === "subscriptions-list" ? 10 : 0;
        },
      });
      render(<Home />);
      await screen.findByRole("button", { name: /Subscriptions/ });

      expect(hiddenRows()).toHaveLength(4);
      expect(screen.getByRole("button", { name: "+4 more" })).toBeInTheDocument();
    });

    it("shows no more-row when everything fits", async () => {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        configurable: true,
        get() {
          return this.id === "subscriptions-list" ? 1000 : 0;
        },
      });
      render(<Home />);
      await screen.findByRole("button", { name: /Subscriptions/ });

      expect(hiddenRows()).toHaveLength(0);
      expect(screen.queryByRole("button", { name: /more/ })).not.toBeInTheDocument();
    });
  });

  describe("storage", () => {
    it("reports unreadable saved data without overwriting it", async () => {
      window.localStorage.setItem(STORAGE_KEY, "{broken");
      render(<Home />);

      expect(await screen.findByRole("alert")).toHaveTextContent("Your saved data has not been changed.");
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("{broken");
    });

    it("reports invalid saved data", async () => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([{ nope: true }]));
      render(<Home />);

      expect(await screen.findByRole("alert")).toHaveTextContent("not in a valid format");
    });

    it("reports a failed save", async () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota exceeded");
      });
      render(<Home />);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not save your transactions: quota exceeded",
      );
    });

    it("handles non-Error failures", async () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw "denied";
      });
      render(<Home />);

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not read saved transactions.");
    });

    it("handles non-Error save failures", async () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw "full";
      });
      render(<Home />);

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not save your transactions.");
    });
  });

  describe("editing a category", () => {
    const openDialog = async (
      overrides: Parameters<typeof tx>[1] = {},
    ) => {
      seed([tx("1", { description: "Lunch", amount: 12.5, ...overrides })]);
      const user = userEvent.setup();
      render(<Home />);
      await user.click(await screen.findByRole("button", { name: "Edit Lunch" }));
      return { user, dialog: within(await screen.findByRole("dialog")) };
    };

    it("has no way to add or delete a transaction", async () => {
      seed([tx("1", { description: "Lunch" })]);
      render(<Home />);
      await screen.findByText("Lunch");

      expect(screen.queryByRole("button", { name: /Add transaction/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
    });

    it("only offers the category field", async () => {
      const { dialog } = await openDialog();

      expect(dialog.getByLabelText("Category")).toHaveValue("Food & dining");
      expect(dialog.queryByLabelText("Description")).not.toBeInTheDocument();
      expect(dialog.queryByLabelText("Amount")).not.toBeInTheDocument();
      expect(dialog.queryByLabelText("Type")).not.toBeInTheDocument();
      expect(dialog.queryByLabelText("Date")).not.toBeInTheDocument();
    });

    it("saves only the category", async () => {
      const { user, dialog } = await openDialog();

      await user.selectOptions(dialog.getByLabelText("Category"), "Shopping");
      await user.click(dialog.getByRole("button", { name: "Save changes" }));

      expect(saved()).toHaveLength(1);
      expect(saved()[0]).toMatchObject({
        id: "1",
        description: "Lunch",
        amount: 12.5,
        category: "Shopping",
      });
    });

    it("offers income categories for income and keeps an imported category", async () => {
      const { dialog } = await openDialog({ type: "income", category: "Paycheck" });

      const options = dialog.getAllByRole("option").map((option) => option.textContent);
      expect(options).toContain("Salary");
      expect(options).toContain("Paycheck");
      expect(options).not.toContain("Shopping");
      expect(dialog.getByLabelText("Category")).toHaveValue("Paycheck");
    });

    it("closes without saving on cancel", async () => {
      const { user, dialog } = await openDialog();

      await user.selectOptions(dialog.getByLabelText("Category"), "Shopping");
      await user.click(dialog.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(saved()[0].category).toBe("Food & dining");
    });

    it("leaves other transactions untouched", async () => {
      seed([tx("1", { description: "First" }), tx("2", { description: "Second" })]);
      const user = userEvent.setup();
      render(<Home />);

      await user.click(await screen.findByRole("button", { name: "Edit First" }));
      const dialog = within(await screen.findByRole("dialog"));
      await user.selectOptions(dialog.getByLabelText("Category"), "Shopping");
      await user.click(dialog.getByRole("button", { name: "Save changes" }));

      const byName = Object.fromEntries(saved().map((item) => [item.description, item.category]));
      expect(byName).toEqual({ First: "Shopping", Second: "Food & dining" });
    });
  });

  describe("search and filters", () => {
    beforeEach(() =>
      seed([
        tx("1", { description: "Coffee shop", category: "Food & dining", date: day(3) }),
        tx("2", { description: "Bus pass", category: "Transport", date: day(5) }),
        tx("3", { description: "Salary", type: "income", category: "Salary", date: day(4) }),
      ]),
    );

    it("searches by description and category", async () => {
      const user = userEvent.setup();
      render(<Home />);
      await screen.findByText("Coffee shop");

      await user.type(screen.getByLabelText("Search transactions"), "  COFFEE ");
      expect(screen.queryByText("Bus pass")).not.toBeInTheDocument();
      expect(screen.getByText("Coffee shop")).toBeInTheDocument();

      await user.clear(screen.getByLabelText("Search transactions"));
      await user.type(screen.getByLabelText("Search transactions"), "transport");
      expect(screen.getByText("Bus pass")).toBeInTheDocument();
      expect(screen.queryByText("Coffee shop")).not.toBeInTheDocument();
    });

    it("filters by type and category", async () => {
      const user = userEvent.setup();
      render(<Home />);
      await screen.findByText("Coffee shop");

      await user.selectOptions(screen.getByLabelText("Filter by type"), "income");
      expect(screen.getByText("Salary", { selector: "span.font-medium" })).toBeInTheDocument();
      expect(screen.queryByText("Coffee shop")).not.toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText("Filter by type"), "all");
      await user.selectOptions(screen.getByLabelText("Filter by category"), "Transport");
      expect(screen.getByText("Bus pass")).toBeInTheDocument();
      expect(screen.queryByText("Coffee shop")).not.toBeInTheDocument();
    });

    it("lists each category once in the filter", async () => {
      render(<Home />);
      await screen.findByText("Coffee shop");

      const options = within(screen.getByLabelText("Filter by category"))
        .getAllByRole("option")
        .map((option) => option.textContent);
      expect(new Set(options).size).toBe(options.length);
    });

    it("shows a no-match state", async () => {
      const user = userEvent.setup();
      render(<Home />);
      await screen.findByText("Coffee shop");

      await user.type(screen.getByLabelText("Search transactions"), "zzz");

      expect(screen.getByText("No matching transactions")).toBeInTheDocument();
    });

    it("sorts newest first", async () => {
      render(<Home />);
      await screen.findByText("Coffee shop");

      const rows = screen.getAllByRole("row").slice(1);
      expect(rows.map((row) => /Bus pass|Salary|Coffee shop/.exec(row.textContent ?? "")?.[0])).toEqual([
        "Bus pass",
        "Salary",
        "Coffee shop",
      ]);
    });
  });

  describe("CSV import", () => {
    const csvInput = (container: HTMLElement) =>
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const csvFile = (content: string) =>
      new File([content], "bank.csv", { type: "text/csv" });

    it("imports transactions and reports the count", async () => {
      const { container } = render(<Home />);
      await screen.findByText("No transactions for this month");

      await userEvent.upload(
        csvInput(container),
        csvFile(`date,description,amount\n${day(1)},Imported A,5\n${day(2)},Imported B,6\n`),
      );

      expect(await screen.findByText("Imported A")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("2 transactions imported.");
      expect(saved()).toHaveLength(2);
    });

    it("uses the singular form for one transaction", async () => {
      const { container } = render(<Home />);
      await screen.findByText("No transactions for this month");

      await userEvent.upload(csvInput(container), csvFile(`date,description,amount\n${day(1)},Only,5\n`));

      expect(await screen.findByRole("status")).toHaveTextContent("1 transaction imported.");
    });

    it("reports invalid files and imports nothing", async () => {
      const { container } = render(<Home />);
      await screen.findByText("No transactions for this month");

      await userEvent.upload(csvInput(container), csvFile("nonsense"));

      expect(await screen.findByRole("status")).toHaveTextContent("header row");
      expect(saved()).toEqual([]);
    });

    it("does nothing when no file is chosen", async () => {
      const { container } = render(<Home />);
      await screen.findByText("No transactions for this month");

      fireEvent.change(csvInput(container), { target: { files: [] } });

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("opens the file chooser from the upload button", async () => {
      const { container } = render(<Home />);
      const click = vi.spyOn(csvInput(container), "click");

      await userEvent.click(screen.getByRole("button", { name: /Upload CSV/ }));

      expect(click).toHaveBeenCalled();
    });

    it("reports a generic message for non-Error failures", async () => {
      const { container } = render(<Home />);
      const file = csvFile("x");
      Object.defineProperty(file, "text", { value: () => Promise.reject("boom") });

      await userEvent.upload(csvInput(container), file);

      expect(await screen.findByRole("status")).toHaveTextContent("Could not import that CSV.");
    });
  });
});

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
  description: "Groceries",
  amount: 100,
  type: "expense",
  category: "Food & dining",
  date: day(2),
  ...overrides,
});

describe("meta", () => {
  it("sets the document title and description", () => {
    expect(meta({} as never)).toEqual([
      { title: "Spending Snapshot" },
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

    fireEvent.change(screen.getByLabelText("Select month"), {
      target: { value: "2020-03" },
    });

    expect(screen.getByText("Old purchase")).toBeInTheDocument();
    expect(screen.queryByText("This month")).not.toBeInTheDocument();
    expect(screen.getByText("1 transaction in", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/March 2020/, { selector: "p" })).toBeInTheDocument();
  });

  it("opens the native month picker on click when supported", async () => {
    render(<Home />);
    const input = await screen.findByLabelText("Select month");
    const showPicker = vi.fn();
    Object.defineProperty(input, "showPicker", { value: showPicker, configurable: true });

    await userEvent.click(input);

    expect(showPicker).toHaveBeenCalled();
  });

  it("does not fail when showPicker is unavailable", async () => {
    render(<Home />);
    const input = await screen.findByLabelText("Select month");
    Object.defineProperty(input, "showPicker", { value: undefined, configurable: true });

    await expect(userEvent.click(input)).resolves.toBeUndefined();
  });

  it("lists detected subscriptions for the selected year", async () => {
    const year = month.slice(0, 4);
    seed([
      tx("1", { description: "Streaming", amount: 15, date: `${year}-01-05` }),
      tx("2", { description: "Streaming", amount: 15, date: `${year}-02-05` }),
      tx("3", { description: "Streaming", amount: 15, date: `${year}-03-05` }),
    ]);
    render(<Home />);

    expect(await screen.findByText("Possible subscriptions")).toBeInTheDocument();
    expect(screen.getByText(/Monthly · next around/)).toHaveTextContent("3 payments this year");
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

  describe("adding transactions", () => {
    const openDialog = async () => {
      const user = userEvent.setup();
      render(<Home />);
      await screen.findByText("No transactions for this month");
      await user.click(screen.getByRole("button", { name: /Add transaction/ }));
      return { user, dialog: within(await screen.findByRole("dialog")) };
    };

    it("adds an expense and persists it", async () => {
      const { user, dialog } = await openDialog();

      await user.type(dialog.getByLabelText("Description"), "  Lunch  ");
      await user.type(dialog.getByLabelText("Amount"), "12.5");
      await user.click(dialog.getByRole("button", { name: "Add transaction" }));

      expect(await screen.findByText("Lunch")).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(saved()).toEqual([
        {
          id: "00000000-0000-4000-8000-000000000001",
          description: "Lunch",
          amount: 12.5,
          type: "expense",
          category: "Food & dining",
          date: getLocalDateString(),
        },
      ]);
    });

    it("adds income and resets the category list when the type changes", async () => {
      const { user, dialog } = await openDialog();

      await user.selectOptions(dialog.getByLabelText("Type"), "income");
      expect(dialog.getByLabelText("Category")).toHaveValue("Salary");
      await user.selectOptions(dialog.getByLabelText("Type"), "expense");
      expect(dialog.getByLabelText("Category")).toHaveValue("Food & dining");
      await user.selectOptions(dialog.getByLabelText("Type"), "income");

      await user.type(dialog.getByLabelText("Description"), "Paycheck");
      await user.type(dialog.getByLabelText("Amount"), "1000");
      await user.selectOptions(dialog.getByLabelText("Category"), "Freelance");
      fireEvent.change(dialog.getByLabelText("Date"), { target: { value: day(1) } });
      await user.click(dialog.getByRole("button", { name: "Add transaction" }));

      expect(await screen.findByText("Paycheck")).toBeInTheDocument();
      expect(saved()[0]).toMatchObject({ type: "income", category: "Freelance", date: day(1) });
    });

    it.each([
      ["a missing description", "", "5", "Add a name for this transaction."],
      ["a zero amount", "Item", "0", "Enter an amount greater than zero"],
      ["a blank amount", "Item", "", "Enter an amount greater than zero"],
      ["too many decimals", "Item", "1.234", "up to two decimals"],
    ])("validates %s", async (_name, description, amount, message) => {
      const { user, dialog } = await openDialog();

      if (description) await user.type(dialog.getByLabelText("Description"), description);
      if (amount) await user.type(dialog.getByLabelText("Amount"), amount);
      // Submit directly so native min/step constraints don't pre-empt app validation.
      fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);

      expect(dialog.getByRole("alert")).toHaveTextContent(message);
      expect(saved()).toEqual([]);
    });

    it("validates the date", async () => {
      const { user, dialog } = await openDialog();

      await user.type(dialog.getByLabelText("Description"), "Item");
      await user.type(dialog.getByLabelText("Amount"), "5");
      fireEvent.change(dialog.getByLabelText("Date"), { target: { value: "" } });
      await user.click(dialog.getByRole("button", { name: "Add transaction" }));

      expect(dialog.getByRole("alert")).toHaveTextContent("Choose a valid transaction date.");
    });

    it("closes without saving on cancel", async () => {
      const { user, dialog } = await openDialog();

      await user.type(dialog.getByLabelText("Description"), "Discarded");
      await user.click(dialog.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByText("Discarded")).not.toBeInTheDocument();
    });

    it("clears the previous draft and error when reopened", async () => {
      const { user, dialog } = await openDialog();

      await user.click(dialog.getByRole("button", { name: "Add transaction" }));
      expect(dialog.getByRole("alert")).toBeInTheDocument();
      await user.click(dialog.getByRole("button", { name: "Cancel" }));
      await user.click(screen.getByRole("button", { name: /Add transaction/ }));

      const reopened = within(await screen.findByRole("dialog"));
      expect(reopened.queryByRole("alert")).not.toBeInTheDocument();
      expect(reopened.getByLabelText("Description")).toHaveValue("");
    });
  });

  describe("editing and deleting", () => {
    it("edits a transaction", async () => {
      seed([tx("1", { description: "Old name", amount: 20 })]);
      const user = userEvent.setup();
      render(<Home />);

      await user.click(await screen.findByRole("button", { name: "Edit Old name" }));
      const dialog = within(await screen.findByRole("dialog"));
      expect(dialog.getByLabelText("Description")).toHaveValue("Old name");
      expect(dialog.getByLabelText("Amount")).toHaveValue(20);

      await user.clear(dialog.getByLabelText("Description"));
      await user.type(dialog.getByLabelText("Description"), "New name");
      await user.click(dialog.getByRole("button", { name: "Save changes" }));

      expect(await screen.findByText("New name")).toBeInTheDocument();
      expect(saved()).toHaveLength(1);
      expect(saved()[0]).toMatchObject({ id: "1", description: "New name", amount: 20 });
    });

    it("leaves other transactions untouched when editing one", async () => {
      seed([tx("1", { description: "First" }), tx("2", { description: "Second" })]);
      const user = userEvent.setup();
      render(<Home />);

      await user.click(await screen.findByRole("button", { name: "Edit First" }));
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save changes" }));

      expect(saved().map((item) => item.description).sort()).toEqual(["First", "Second"]);
    });

    it("deletes after confirmation", async () => {
      seed([tx("1", { description: "Remove me" })]);
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const user = userEvent.setup();
      render(<Home />);

      await user.click(await screen.findByRole("button", { name: "Delete Remove me" }));

      expect(window.confirm).toHaveBeenCalledWith('Delete "Remove me"?');
      expect(screen.queryByText("Remove me")).not.toBeInTheDocument();
      expect(saved()).toEqual([]);
    });

    it("keeps the transaction when deletion is cancelled", async () => {
      seed([tx("1", { description: "Keep me" })]);
      vi.spyOn(window, "confirm").mockReturnValue(false);
      const user = userEvent.setup();
      render(<Home />);

      await user.click(await screen.findByRole("button", { name: "Delete Keep me" }));

      expect(screen.getByText("Keep me")).toBeInTheDocument();
      expect(saved()).toHaveLength(1);
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

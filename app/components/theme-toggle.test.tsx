import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  THEME_OVERRIDE_KEY,
  ThemeToggle,
  themeInitScript,
} from "./theme-toggle";

type MediaListener = () => void;

function mockSystemTheme(prefersDark: boolean) {
  const listeners = new Set<MediaListener>();
  const media = {
    matches: prefersDark,
    addEventListener: (_: string, listener: MediaListener) => listeners.add(listener),
  };
  window.matchMedia = vi.fn().mockReturnValue(media);
  return {
    change(next: boolean) {
      media.matches = next;
      listeners.forEach((listener) => listener());
    },
  };
}

const runInitScript = () => new Function(themeInitScript)();

describe("theme init script", () => {
  beforeEach(() => delete document.documentElement.dataset.theme);

  it.each([
    [true, "dark"],
    [false, "light"],
  ])("follows the browser preference (dark=%s)", (prefersDark, expected) => {
    mockSystemTheme(prefersDark);
    runInitScript();

    expect(document.documentElement.dataset.theme).toBe(expected);
  });

  it("updates when the browser preference changes", () => {
    const system = mockSystemTheme(false);
    runInitScript();
    system.change(true);

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("prefers a saved override over the browser", () => {
    mockSystemTheme(true);
    window.localStorage.setItem(THEME_OVERRIDE_KEY, "light");
    runInitScript();

    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("ignores an invalid override", () => {
    mockSystemTheme(true);
    window.localStorage.setItem(THEME_OVERRIDE_KEY, "purple");
    runInitScript();

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("still works when storage is unavailable", () => {
    mockSystemTheme(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    runInitScript();

    expect(document.documentElement.dataset.theme).toBe("dark");
    vi.restoreAllMocks();
  });
});

describe("ThemeToggle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete document.documentElement.dataset.theme;
  });

  it("offers the opposite theme of the current one", async () => {
    document.documentElement.dataset.theme = "dark";
    render(<ThemeToggle />);

    expect(await screen.findByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
  });

  it("toggles the theme and remembers the choice", async () => {
    document.documentElement.dataset.theme = "light";
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_OVERRIDE_KEY)).toBe("dark");

    await user.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_OVERRIDE_KEY)).toBe("light");
  });

  it("falls back to light when no theme has been set", () => {
    render(<ThemeToggle />);

    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeInTheDocument();
  });

  it("still switches when storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await act(() => user.click(screen.getByRole("button", { name: "Switch to dark theme" })));

    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import App, { ErrorBoundary } from "./root";

const renderBoundary = (error: unknown) =>
  render(<ErrorBoundary {...({ error } as React.ComponentProps<typeof ErrorBoundary>)} />);

describe("App", () => {
  it("renders the active route and the dev theme toggle", async () => {
    const Stub = createRoutesStub([{ path: "/", Component: App, children: [{ index: true, Component: () => <p>Child route</p> }] }]);
    render(<Stub />);

    expect(await screen.findByText("Child route")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Switch to/ })).toBeInTheDocument();
  });
});

describe("ErrorBoundary", () => {
  it("shows a friendly 404 page", () => {
    renderBoundary({ status: 404, statusText: "Not Found", internal: true, data: "" });

    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/");
  });

  it("shows a generic message for other route errors", () => {
    renderBoundary({ status: 500, statusText: "Server Error", internal: true, data: "" });

    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Page not found" })).not.toBeInTheDocument();
  });

  it("shows the error message during development", () => {
    renderBoundary(new Error("kaboom"));

    expect(screen.getByText("kaboom")).toBeInTheDocument();
  });

  it("does not expose details for non-Error values", () => {
    renderBoundary("just a string");

    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.queryByText("just a string")).not.toBeInTheDocument();
  });
});

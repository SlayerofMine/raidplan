import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "./toast";
import { useToast, type ToastKind } from "./toastContext";

function Trigger({ kind }: { kind?: ToastKind }) {
  const { toast } = useToast();
  return <button onClick={() => toast("Saved!", kind)}>fire</button>;
}

const quick = { info: 1000, success: 1000, error: 1000 };

afterEach(() => vi.useRealTimers());

describe("toast", () => {
  it("shows a toast when fired", () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("fire"));
    expect(screen.getByTestId("toast")).toHaveTextContent("Saved!");
  });

  it("announces errors assertively for screen readers", () => {
    render(
      <ToastProvider>
        <Trigger kind="error" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("fire"));
    const toast = screen.getByTestId("toast");
    expect(toast).toHaveAttribute("role", "alert");
    expect(toast).toHaveAttribute("aria-live", "assertive");
  });

  it("uses a polite status for non-errors", () => {
    render(
      <ToastProvider>
        <Trigger kind="success" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("fire"));
    expect(screen.getByTestId("toast")).toHaveAttribute("role", "status");
  });

  it("auto-dismisses after its lifetime", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider durations={quick}>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("fire"));
    expect(screen.getByTestId("toast")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByTestId("toast")).not.toBeInTheDocument();
  });

  it("can be dismissed manually", () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("fire"));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("toast")).not.toBeInTheDocument();
  });

  it("throws if used outside a provider — a wiring bug, not silent no-op", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Trigger />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});

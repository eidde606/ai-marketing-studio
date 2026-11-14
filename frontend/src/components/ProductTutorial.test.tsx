import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProductTutorial from "./ProductTutorial";

afterEach(cleanup);

vi.mock("../app/localization", () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

describe("ProductTutorial", () => {
  it("supports next, back, skip, and keyboard focus containment", () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    render(<ProductTutorial onComplete={onComplete} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("tutorial.dashboardTitle")).toBeTruthy();

    const next = screen.getByRole("button", { name: "tutorial.next" });
    next.focus();
    fireEvent.keyDown(next, { key: "Tab" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "tutorial.skip" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "tutorial.next" }));
    expect(screen.getByText("tutorial.sofiaTitle")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "tutorial.back" }));
    expect(screen.getByText("tutorial.dashboardTitle")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "tutorial.skip" }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("allows Escape to skip and reports persistence failures", async () => {
    const onComplete = vi.fn().mockRejectedValueOnce(new Error("network"));
    render(<ProductTutorial onComplete={onComplete} />);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("tutorial.saveError");
    });
    expect(onComplete).toHaveBeenCalledOnce();
  });
});

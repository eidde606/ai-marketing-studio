import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProductTutorial from "./ProductTutorial";

let guideTarget: HTMLDivElement | null = null;
afterEach(() => {
  cleanup();
  guideTarget?.remove();
  guideTarget = null;
});

vi.mock("../app/localization", () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

function renderTutorial(
  overrides: {
    onComplete?: (step: number) => Promise<void>;
    onNavigate?: (section: string) => void;
    onStepChange?: (step: number) => Promise<void>;
  } = {},
) {
  const onComplete =
    overrides.onComplete ?? vi.fn().mockResolvedValue(undefined);
  const onNavigate = overrides.onNavigate ?? vi.fn();
  const onStepChange =
    overrides.onStepChange ?? vi.fn().mockResolvedValue(undefined);
  render(
    <ProductTutorial
      activeSection="Resumen"
      initialStep={0}
      onComplete={onComplete}
      onNavigate={onNavigate}
      onStepChange={onStepChange}
    />,
  );
  return { onComplete, onNavigate, onStepChange };
}

describe("ProductTutorial", () => {
  it("navigates through actual sections, persists progress, and can be skipped", async () => {
    guideTarget = document.createElement("div");
    guideTarget.dataset.guideTarget = "dashboard-overview";
    document.body.append(guideTarget);
    const { onComplete, onNavigate, onStepChange } = renderTutorial();

    expect(
      screen.getByRole("complementary", { name: "tutorial.title" }),
    ).toBeTruthy();
    expect(screen.getByText("tutorial.dashboardTitle")).toBeTruthy();
    await waitFor(() => {
      expect(guideTarget?.classList.contains("product-guide-highlight")).toBe(
        true,
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "tutorial.next" }));
    expect(await screen.findByText("tutorial.sofiaTitle")).toBeTruthy();
    expect(onStepChange).toHaveBeenCalledWith(1);
    expect(onNavigate).toHaveBeenCalledWith("Equipo IA");

    fireEvent.keyDown(screen.getByRole("complementary"), {
      key: "ArrowRight",
    });
    expect(await screen.findByText("tutorial.leoTitle")).toBeTruthy();
    expect(onStepChange).toHaveBeenCalledWith(2);

    fireEvent.click(screen.getByRole("button", { name: "tutorial.back" }));
    expect(await screen.findByText("tutorial.sofiaTitle")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "tutorial.skip" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(1));
  });

  it("resumes the saved step and reports progress or completion failures", async () => {
    const onComplete = vi.fn().mockRejectedValueOnce(new Error("network"));
    const onStepChange = vi.fn().mockRejectedValueOnce(new Error("offline"));
    render(
      <ProductTutorial
        activeSection="Equipo IA"
        initialStep={2}
        onComplete={onComplete}
        onNavigate={vi.fn()}
        onStepChange={onStepChange}
      />,
    );

    expect(screen.getByText("tutorial.leoTitle")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "tutorial.next" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("tutorial.saveError");
    });
    fireEvent.keyDown(screen.getByRole("complementary"), { key: "Escape" });
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(2));
    expect(screen.getByRole("alert").textContent).toBe("tutorial.saveError");
  });
});

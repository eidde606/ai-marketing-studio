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

vi.mock("../app/useLocalization", () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

function renderTutorial(
  overrides: {
    onComplete?: (step: number) => Promise<void>;
    onDismiss?: () => void;
    onNavigate?: (section: string) => void;
    onPause?: (step: number) => Promise<void>;
    onStepChange?: (step: number) => Promise<void>;
  } = {},
) {
  const onComplete =
    overrides.onComplete ?? vi.fn().mockResolvedValue(undefined);
  const onDismiss = overrides.onDismiss ?? vi.fn();
  const onNavigate = overrides.onNavigate ?? vi.fn();
  const onPause = overrides.onPause ?? vi.fn().mockResolvedValue(undefined);
  const onStepChange =
    overrides.onStepChange ?? vi.fn().mockResolvedValue(undefined);
  render(
    <ProductTutorial
      activeSection="Resumen"
      initialStep={0}
      onComplete={onComplete}
      onDismiss={onDismiss}
      onNavigate={onNavigate}
      onPause={onPause}
      onStepChange={onStepChange}
    />,
  );
  return { onComplete, onDismiss, onNavigate, onPause, onStepChange };
}

describe("ProductTutorial", () => {
  it("navigates through actual sections, persists progress, and can be skipped", async () => {
    guideTarget = document.createElement("div");
    guideTarget.dataset.guideTarget = "dashboard-overview";
    document.body.append(guideTarget);
    const { onComplete, onDismiss, onNavigate, onStepChange } =
      renderTutorial();

    expect(
      screen.getByRole("complementary", { name: "tutorial.title" }),
    ).toBeTruthy();
    expect(screen.getByText("tutorial.welcomeTitle")).toBeTruthy();
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
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("resumes the saved step and reports progress or completion failures", async () => {
    const onComplete = vi.fn().mockRejectedValueOnce(new Error("network"));
    const onPause = vi.fn().mockRejectedValueOnce(new Error("offline"));
    const onStepChange = vi.fn().mockRejectedValueOnce(new Error("offline"));
    render(
      <ProductTutorial
        activeSection="Equipo IA"
        initialStep={2}
        onComplete={onComplete}
        onDismiss={vi.fn()}
        onNavigate={vi.fn()}
        onPause={onPause}
        onStepChange={onStepChange}
      />,
    );

    expect(screen.getByText("tutorial.leoTitle")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "tutorial.next" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("tutorial.saveError");
    });
    fireEvent.keyDown(screen.getByRole("complementary"), { key: "Escape" });
    await waitFor(() => expect(onPause).toHaveBeenCalledWith(2));
    expect(screen.getByRole("alert").textContent).toBe("tutorial.saveError");
  });

  it("saves the current step when the guide is paused", async () => {
    const { onPause } = renderTutorial();
    fireEvent.click(
      screen.getByRole("button", { name: "tutorial.saveAndExit" }),
    );
    await waitFor(() => expect(onPause).toHaveBeenCalledWith(0));
  });

  it("offers subscription plans and dashboard actions after completing the guide", async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const onDismiss = vi.fn();
    const onNavigate = vi.fn();
    render(
      <ProductTutorial
        activeSection="Configuración"
        initialStep={9}
        onComplete={onComplete}
        onDismiss={onDismiss}
        onNavigate={onNavigate}
        onPause={vi.fn().mockResolvedValue(undefined)}
        onStepChange={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "tutorial.finish" }));
    expect(await screen.findByText("tutorial.completeTitle")).toBeTruthy();
    expect(onComplete).toHaveBeenCalledWith(9);
    fireEvent.click(
      screen.getByRole("button", { name: /tutorial.explorePlans/ }),
    );
    expect(onDismiss).toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith("Facturación");
  });
});

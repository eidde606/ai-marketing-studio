import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import UsageIndicator from "./UsageIndicator";

const mocks = vi.hoisted(() => ({
  getHeyGenUsage: vi.fn(),
}));

vi.mock("../services/accountApi", () => ({
  getHeyGenUsage: mocks.getHeyGenUsage,
}));

vi.mock("./useLocalization", () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("UsageIndicator", () => {
  it("shows loading before reporting an unconfigured allowance", async () => {
    let resolveUsage!: (value: {
      business_id: string;
      configured: false;
      limits: null;
      attempts_used: number;
      active_jobs: number;
      remaining_generations: number;
      period: "lifetime";
      unit: "generation_attempts";
    }) => void;
    mocks.getHeyGenUsage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUsage = resolve;
        }),
    );

    render(<UsageIndicator businessId="business-1" />);
    expect(screen.getByRole("status").textContent).toBe("usage.loading");

    await act(async () => {
      resolveUsage({
        business_id: "business-1",
        configured: false,
        limits: null,
        attempts_used: 0,
        active_jobs: 0,
        remaining_generations: 0,
        period: "lifetime",
        unit: "generation_attempts",
      });
    });

    expect(await screen.findByText("usage.unconfigured")).toBeTruthy();
    expect(screen.queryByText(/0 of 0/)).toBeNull();
  });

  it("displays the server-provided allowance and progress", async () => {
    mocks.getHeyGenUsage.mockResolvedValue({
      business_id: "business-1",
      configured: true,
      limits: {
        max_generations: 5,
        max_script_characters: 5000,
        max_concurrent_jobs: 1,
      },
      attempts_used: 2,
      active_jobs: 1,
      remaining_generations: 3,
      period: "lifetime",
      unit: "generation_attempts",
    });

    render(<UsageIndicator businessId="business-1" />);

    expect(await screen.findByText("usage.attempts")).toBeTruthy();
    const meter = screen.getByRole("meter");
    expect(meter.getAttribute("aria-valuemax")).toBe("5");
    expect(meter.getAttribute("aria-valuenow")).toBe("2");
    expect(screen.getByText("usage.active")).toBeTruthy();
    expect(screen.getByText("usage.remaining")).toBeTruthy();
  });

  it("shows an error and retries the usage request", async () => {
    mocks.getHeyGenUsage
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({
        business_id: "business-1",
        configured: false,
        limits: null,
        attempts_used: 0,
        active_jobs: 0,
        remaining_generations: 0,
        period: "lifetime",
        unit: "generation_attempts",
      });

    render(<UsageIndicator businessId="business-1" />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("usage.unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));

    await waitFor(() => expect(mocks.getHeyGenUsage).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("usage.unconfigured")).toBeTruthy();
  });
});

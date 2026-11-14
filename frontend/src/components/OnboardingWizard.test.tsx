import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingWizard from "./OnboardingWizard";
import {
  activateOnboarding,
  getOnboarding,
  saveOnboarding,
} from "../services/onboardingApi";
import type { Business } from "../services/businessesApi";

vi.mock("../app/localization", () => ({
  useLocalization: () => ({
    locale: "en",
    setInterfaceLanguage: vi.fn().mockResolvedValue(undefined),
    t: (key: string) => key,
  }),
}));

vi.mock("../services/onboardingApi", () => ({
  activateOnboarding: vi.fn(),
  getOnboarding: vi.fn(),
  saveOnboarding: vi.fn(),
}));

afterEach(cleanup);

const savedState = {
  current_step: 2,
  business_profile: { name: "Sample business" },
  interface_language: "en" as const,
  conversation_language: "es" as const,
  marketing_content_language: "en" as const,
  social_accounts_skipped: false,
  completed: false,
  tutorial_completed: false,
};

describe("OnboardingWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOnboarding).mockResolvedValue(savedState);
    vi.mocked(saveOnboarding).mockResolvedValue(savedState);
  });

  it("resumes the saved step and persists progress before advancing", async () => {
    render(<OnboardingWizard onCreated={vi.fn()} />);

    expect(await screen.findByText("onboarding.step2Title")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "onboarding.next" }));
    await waitFor(() => {
      expect(saveOnboarding).toHaveBeenCalledWith(
        expect.objectContaining({
          current_step: 3,
          business_profile: expect.objectContaining({
            name: "Sample business",
          }),
          conversation_language: "es",
        }),
      );
    });
    expect(await screen.findByText("onboarding.step3Title")).toBeTruthy();
  });

  it("activates the saved workspace and reports it to the application", async () => {
    vi.mocked(getOnboarding).mockResolvedValue({
      ...savedState,
      current_step: 6,
    });
    const business: Business = {
      id: "business-1",
      name: "Sample business",
      description: null,
      target_audience: null,
      brand_voice: null,
      industry: null,
      products_services: null,
      service_area: null,
      website_url: null,
      marketing_goals: null,
      preferred_platforms: null,
      posting_frequency: null,
      created_at: "2026-01-01T00:00:00Z",
    };
    const onCreated = vi.fn();
    vi.mocked(activateOnboarding).mockResolvedValue(business);

    render(<OnboardingWizard onCreated={onCreated} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "onboarding.finish" }),
    );

    await waitFor(() => {
      expect(activateOnboarding).toHaveBeenCalledWith(
        expect.objectContaining({
          current_step: 6,
          business_profile: expect.objectContaining({
            name: "Sample business",
          }),
        }),
      );
      expect(onCreated).toHaveBeenCalledWith(business);
    });
  });
});

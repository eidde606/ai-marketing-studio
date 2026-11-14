import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LanguagePreferences from "./LanguagePreferences";
import { LocalizationProvider } from "./localization";

const mocks = vi.hoisted(() => ({
  getAccount: vi.fn(),
  updateAccountPreferences: vi.fn(),
  getBusinessPreferences: vi.fn(),
  updateBusinessPreferences: vi.fn(),
}));

vi.mock("../services/accountApi", () => ({
  getAccount: mocks.getAccount,
  updateAccountPreferences: mocks.updateAccountPreferences,
  getBusinessPreferences: mocks.getBusinessPreferences,
  updateBusinessPreferences: mocks.updateBusinessPreferences,
}));

beforeEach(() => {
  mocks.getAccount.mockResolvedValue({
    user_id: "user-1",
    preferences: { interface_language: "en", conversation_language: "en" },
    businesses: [],
    features: {
      public_registration: false,
      facebook_publishing: true,
      tiktok_direct_publishing: false,
      tiktok_manual_export: true,
      instagram_publishing: false,
      instagram_connection: true,
      mia_analysis: false,
      scheduling: false,
    },
  });
  mocks.updateAccountPreferences.mockImplementation(async (preferences) => ({
    interface_language: "en",
    conversation_language: "en",
    ...preferences,
  }));
  mocks.getBusinessPreferences.mockResolvedValue({
    marketing_content_language: "en",
  });
  mocks.updateBusinessPreferences.mockImplementation(
    async (_businessId, preferences) => preferences,
  );
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("saves conversation and content languages independently to their scopes", async () => {
  render(
    <LocalizationProvider userId="user-1">
      <LanguagePreferences businessId="business-a" />
    </LocalizationProvider>,
  );
  await screen.findByLabelText("Marketing content language");

  fireEvent.change(screen.getByLabelText("AI conversation language"), {
    target: { value: "es" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save conversation language" }),
  );
  expect(mocks.updateAccountPreferences).toHaveBeenCalledWith({
    conversation_language: "es",
  });

  fireEvent.change(screen.getByLabelText("Marketing content language"), {
    target: { value: "es" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save content language" }));
  expect(mocks.updateBusinessPreferences).toHaveBeenCalledWith(
    "business-a",
    { marketing_content_language: "es" },
  );
});

it("does not apply an older business preference response after switching", async () => {
  let resolveFirst!: (value: { marketing_content_language: "en" }) => void;
  mocks.getBusinessPreferences.mockImplementation((businessId: string) => {
    if (businessId === "business-a") {
      return new Promise((resolve) => {
        resolveFirst = resolve;
      });
    }
    return Promise.resolve({ marketing_content_language: "es" });
  });
  const view = render(
    <LocalizationProvider userId="user-1">
      <LanguagePreferences businessId="business-a" />
    </LocalizationProvider>,
  );
  view.rerender(
    <LocalizationProvider userId="user-1">
      <LanguagePreferences businessId="business-b" />
    </LocalizationProvider>,
  );
  const contentLanguage = await screen.findByLabelText(
    "Marketing content language",
  );
  expect((contentLanguage as HTMLSelectElement).value).toBe("es");
  await act(async () => {
    resolveFirst({ marketing_content_language: "en" });
  });
  expect((contentLanguage as HTMLSelectElement).value).toBe("es");
});

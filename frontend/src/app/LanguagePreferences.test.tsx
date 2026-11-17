import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
  localStorage.clear();
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
  await waitFor(() =>
    expect(
      (screen.getByLabelText("AI conversation language") as HTMLSelectElement)
        .disabled,
    ).toBe(false),
  );

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
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Save content language",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Save content language" }),
  );
  await waitFor(() =>
    expect(mocks.updateBusinessPreferences).toHaveBeenCalledWith("business-a", {
      marketing_content_language: "es",
    }),
  );
});

it("loads and saves the interface language independently in the customer's locale", async () => {
  render(
    <LocalizationProvider userId="user-1">
      <LanguagePreferences businessId="business-a" />
    </LocalizationProvider>,
  );
  const interfaceSelect = await screen.findByLabelText("Interface language");
  await waitFor(() =>
    expect((interfaceSelect as HTMLSelectElement).value).toBe("en"),
  );

  fireEvent.change(interfaceSelect, { target: { value: "es" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Save interface language" }),
  );

  expect(mocks.updateAccountPreferences).toHaveBeenCalledWith({
    interface_language: "es",
  });
  expect(
    await screen.findByText("Se guardó el idioma de la interfaz."),
  ).toBeTruthy();
  expect(screen.getByLabelText("Idioma de la interfaz")).toBeTruthy();
});

it("shows Spanish explanations and keeps the saved business content language", async () => {
  mocks.getAccount.mockResolvedValue({
    user_id: "user-1",
    preferences: { interface_language: "es", conversation_language: "es" },
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
  mocks.getBusinessPreferences.mockResolvedValue({
    marketing_content_language: "es",
  });

  render(
    <LocalizationProvider userId="user-1">
      <LanguagePreferences businessId="business-a" />
    </LocalizationProvider>,
  );

  const contentLanguage = await screen.findByLabelText(
    "Idioma del contenido de marketing",
  );
  await waitFor(() =>
    expect((contentLanguage as HTMLSelectElement).value).toBe("es"),
  );
  expect(
    screen.getByText(
      "Define el idioma preferido para nuevos textos, guiones y contenido de marketing.",
    ),
  ).toBeTruthy();
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

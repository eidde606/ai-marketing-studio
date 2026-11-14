import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  LocalizationProvider,
  useLocalization,
} from "./localization";

const mocks = vi.hoisted(() => ({
  getAccount: vi.fn(),
  updateAccountPreferences: vi.fn(),
}));

vi.mock("../services/accountApi", () => ({
  getAccount: mocks.getAccount,
  updateAccountPreferences: mocks.updateAccountPreferences,
}));

function Probe() {
  const { locale, preferenceError, setInterfaceLanguage, t } =
    useLocalization();
  return (
    <div>
      <p>{t("nav.home")}</p>
      <output>{locale}</output>
      {preferenceError && <p role="alert">{t("language.saveError")}</p>}
      <button onClick={() => void setInterfaceLanguage("es")}>
        Use Spanish
      </button>
    </div>
  );
}

const englishAccount = {
  user_id: "user-1",
  preferences: {
    interface_language: "en" as const,
    conversation_language: "en" as const,
  },
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
};

beforeEach(() => {
  localStorage.clear();
  mocks.getAccount.mockResolvedValue(englishAccount);
  mocks.updateAccountPreferences.mockResolvedValue(
    englishAccount.preferences,
  );
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("defaults to English before authentication", () => {
  render(
    <LocalizationProvider userId={null}>
      <Probe />
    </LocalizationProvider>,
  );
  expect(screen.getByText("Home")).toBeTruthy();
  expect(screen.getByText("en")).toBeTruthy();
});

it("uses the saved authenticated preference when there is no device override", async () => {
  mocks.getAccount.mockResolvedValue({
    ...englishAccount,
    preferences: { interface_language: "es", conversation_language: "en" },
  });
  render(
    <LocalizationProvider userId="user-1">
      <Probe />
    </LocalizationProvider>,
  );
  expect(await screen.findByText("Resumen")).toBeTruthy();
  expect(localStorage.getItem("ai-marketing-studio:interface-language:user-1"))
    .toBe("es");
});

it("preserves an explicit pre-auth choice and synchronizes it to the account", async () => {
  localStorage.setItem("ai-marketing-studio:interface-language", "es");
  render(
    <LocalizationProvider userId="user-1">
      <Probe />
    </LocalizationProvider>,
  );
  expect(await screen.findByText("Resumen")).toBeTruthy();
  expect(mocks.updateAccountPreferences).toHaveBeenCalledWith({
    interface_language: "es",
  });
});

it("persists a selected language and reports a failed account sync", async () => {
  mocks.updateAccountPreferences.mockRejectedValue(new Error("offline"));
  render(
    <LocalizationProvider userId="user-1">
      <Probe />
    </LocalizationProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Use Spanish" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(localStorage.getItem("ai-marketing-studio:interface-language"))
    .toBe("es");
  expect(localStorage.getItem("ai-marketing-studio:interface-language:user-1"))
    .toBe("es");
});

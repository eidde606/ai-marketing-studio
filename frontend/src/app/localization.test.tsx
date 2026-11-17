import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalizationProvider } from "./localization";
import { useLocalization } from "./useLocalization";

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

function AgentNamesProbe() {
  const { setInterfaceLanguage, t } = useLocalization();
  return (
    <div>
      <p>{t("sofia.agentName")}</p>
      <p>{t("tutorial.leoTitle")}</p>
      <p>{t("tutorial.miaTitle")}</p>
      <button onClick={() => void setInterfaceLanguage("es")}>
        Use Spanish
      </button>
    </div>
  );
}

function SocialConnectionMessagesProbe() {
  const { setInterfaceLanguage, t } = useLocalization();
  return (
    <div>
      <p>{t("facebook.disconnected")}</p>
      <p>{t("facebook.multiplePagesWarning")}</p>
      <p>{t("instagram.disconnected")}</p>
      <p>{t("instagram.facebookMultiplePages")}</p>
      <p>{t("tiktok.disconnected")}</p>
      <p>{t("tiktok.manualOnly")}</p>
      <p>{t("tiktok.directPublishingEnabled")}</p>
      <p>{t("approval.facebookPublishError")}</p>
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
  mocks.updateAccountPreferences.mockResolvedValue(englishAccount.preferences);
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

it("uses the renamed agent names in English and Spanish", async () => {
  render(
    <LocalizationProvider userId={null}>
      <AgentNamesProbe />
    </LocalizationProvider>,
  );

  expect(screen.getByText("Sebastián")).toBeTruthy();
  expect(screen.getByText("Valeria creates content")).toBeTruthy();
  expect(screen.getByText("Edian interprets Facebook engagement")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Use Spanish" }));

  expect(screen.getByText("Sebastián")).toBeTruthy();
  expect(screen.getByText("Valeria crea contenido")).toBeTruthy();
  expect(
    screen.getByText("Edian interpreta la interacción en Facebook"),
  ).toBeTruthy();
});

it("explains local disconnection and publishing account requirements in both languages", () => {
  render(
    <LocalizationProvider userId={null}>
      <SocialConnectionMessagesProbe />
    </LocalizationProvider>,
  );

  expect(
    screen.getByText(
      "Facebook Page disconnected from this business. To revoke Meta access, remove AI Marketing Studio in your Meta account settings.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "Publishing requires exactly one Facebook Page connected to this business. Disconnect extra Pages and keep the intended Page connected.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "Instagram disconnected from this business. To revoke Meta access, remove AI Marketing Studio in your Meta account settings.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "Keep exactly one Facebook Page connected to this business before connecting Instagram, so the linked account is unambiguous.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "TikTok disconnected from this business. To revoke access, remove AI Marketing Studio in your TikTok account settings.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "Direct TikTok posting is disabled for this application. Use manual export until the required Content Posting API permissions and provider audit are in place.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "Direct TikTok publishing is enabled by this application's configuration, but account eligibility, permissions and provider approval still apply.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "Facebook publication could not be completed. Ensure exactly one Facebook Page is connected and that it has the required permissions before retrying.",
    ),
  ).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Use Spanish" }));

  expect(
    screen.getByText(
      "La página de Facebook se desconectó de este negocio. Para revocar el acceso de Meta, elimina AI Marketing Studio en la configuración de tu cuenta de Meta.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "Para publicar, debe haber exactamente una página de Facebook conectada a este negocio. Desconecta las páginas adicionales y deja conectada la que deseas usar.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "Instagram se desconectó de este negocio. Para revocar el acceso de Meta, elimina AI Marketing Studio en la configuración de tu cuenta de Meta.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "Deja conectada exactamente una página de Facebook a este negocio antes de conectar Instagram para que la cuenta vinculada sea inequívoca.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "TikTok se desconectó de este negocio. Para revocar el acceso, elimina AI Marketing Studio en la configuración de tu cuenta de TikTok.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "La publicación directa en TikTok está desactivada en esta aplicación. Usa la exportación manual hasta contar con los permisos necesarios de Content Posting API y la auditoría del proveedor.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "La publicación directa en TikTok está habilitada por la configuración de esta aplicación, pero siguen aplicando la elegibilidad de la cuenta, los permisos y la aprobación del proveedor.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "No se pudo completar la publicación en Facebook. Asegúrate de que haya exactamente una página de Facebook conectada y que tenga los permisos necesarios antes de volver a intentarlo.",
    ),
  ).toBeTruthy();
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
  expect(
    localStorage.getItem("ai-marketing-studio:interface-language:user-1"),
  ).toBe("es");
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
  expect(localStorage.getItem("ai-marketing-studio:interface-language")).toBe(
    "es",
  );
  expect(
    localStorage.getItem("ai-marketing-studio:interface-language:user-1"),
  ).toBe("es");
});

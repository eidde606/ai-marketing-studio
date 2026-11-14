import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AuthPage from "./AuthPage";
import { getPublicConfig } from "../services/accountApi";

const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signInWithOAuth: vi.fn(),
}));

vi.mock("../app/localization", () => ({
  useLocalization: () => ({
    locale: "en",
    setInterfaceLanguage: vi.fn().mockResolvedValue(undefined),
    t: (key: string) => key,
  }),
}));

vi.mock("../services/accountApi", () => ({
  getPublicConfig: vi.fn(),
}));

vi.mock("../services/supabaseClient", () => ({
  supabase: { auth },
}));

afterEach(cleanup);
afterEach(() => {
  window.history.replaceState(null, "", "/");
});
beforeEach(() => {
  vi.resetAllMocks();
});

const unavailableProviders = {
  google_sign_in: false,
  facebook_sign_in: false,
  apple_sign_in: false,
};

describe("AuthPage registration gate", () => {
  it("shows a clear unavailable state when the server keeps registration closed", async () => {
    vi.mocked(getPublicConfig).mockResolvedValue({
      public_registration: false,
      ...unavailableProviders,
      trial_available: false,
    });
    render(<AuthPage />);

    const createAccount = await screen.findByRole("button", {
      name: "auth.createAccount",
    });
    expect(createAccount.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("auth.noAccount")).toBeTruthy();
    expect(screen.getByText("auth.registrationUnavailable")).toBeTruthy();
    expect(screen.getByText("auth.trialUnavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "auth.signIn" })).toBeTruthy();
  });

  it("opens the actual registration form only when the server gate is enabled", async () => {
    vi.mocked(getPublicConfig).mockResolvedValue({
      public_registration: true,
      ...unavailableProviders,
      trial_available: true,
    });
    render(<AuthPage />);

    const createAccount = await screen.findByRole("button", {
      name: "auth.createAccount",
    });
    expect(screen.getByText("auth.noAccount")).toBeTruthy();
    expect(screen.getByText("auth.trialAvailable")).toBeTruthy();
    fireEvent.click(createAccount);
    expect(screen.getByText("auth.registerTrialHelp")).toBeTruthy();
    expect(screen.getByLabelText("auth.email")).toBeTruthy();
    expect(screen.getByLabelText("auth.password")).toBeTruthy();
  });

  it("fails closed with an unavailable state if registration config cannot load", async () => {
    vi.mocked(getPublicConfig).mockRejectedValue(new Error("offline"));
    render(<AuthPage />);

    const createAccount = await screen.findByRole("button", {
      name: "auth.createAccount",
    });
    expect(createAccount.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("auth.registrationCheckFailed")).toBeTruthy();
  });

  it("sends credentials only to Supabase and waits for email verification", async () => {
    vi.mocked(getPublicConfig).mockResolvedValue({
      public_registration: true,
      ...unavailableProviders,
      trial_available: false,
    });
    auth.signUp.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    render(<AuthPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "auth.createAccount" }),
    );
    fireEvent.change(screen.getByLabelText("auth.email"), {
      target: { value: "customer@example.com" },
    });
    fireEvent.change(screen.getByLabelText("auth.password"), {
      target: { value: "a secure customer password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "auth.createAccount" }));

    await waitFor(() => {
      expect(auth.signUp).toHaveBeenCalledWith({
        email: "customer@example.com",
        password: "a secure customer password",
        options: { emailRedirectTo: window.location.origin },
      });
    });
    expect(await screen.findByText("auth.verifyEmail")).toBeTruthy();
  });

  it("offers configured Google sign-in and delegates the redirect to Supabase", async () => {
    vi.mocked(getPublicConfig).mockResolvedValue({
      public_registration: false,
      google_sign_in: true,
      facebook_sign_in: false,
      apple_sign_in: false,
      trial_available: false,
    });
    auth.signInWithOAuth.mockResolvedValue({ data: {}, error: null });
    render(<AuthPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "auth.continueWithGoogle" }),
    );
    await waitFor(() => {
      expect(auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
          queryParams: { prompt: "select_account" },
        },
      });
    });
    expect(
      screen
        .getByRole("button", { name: "auth.continueWithFacebook" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "auth.continueWithApple" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it.each([
    ["facebook", "facebook_sign_in", "auth.continueWithFacebook"],
    ["apple", "apple_sign_in", "auth.continueWithApple"],
  ] as const)(
    "starts configured %s registration through Supabase OAuth",
    async (provider, configKey, buttonName) => {
      vi.mocked(getPublicConfig).mockResolvedValue({
        public_registration: true,
        google_sign_in: false,
        facebook_sign_in: false,
        apple_sign_in: false,
        [configKey]: true,
        trial_available: true,
      });
      auth.signInWithOAuth.mockResolvedValue({ data: {}, error: null });
      render(<AuthPage />);

      fireEvent.click(
        await screen.findByRole("button", { name: "auth.createAccount" }),
      );
      const providerButton = screen.getByRole("button", { name: buttonName });
      expect(providerButton.hasAttribute("disabled")).toBe(false);
      fireEvent.click(providerButton);

      await waitFor(() => {
        expect(auth.signInWithOAuth).toHaveBeenCalledWith({
          provider,
          options: { redirectTo: window.location.origin },
        });
      });
    },
  );

  it("keeps configured OAuth sign-in available for returning users when registration is closed", async () => {
    vi.mocked(getPublicConfig).mockResolvedValue({
      public_registration: false,
      google_sign_in: true,
      facebook_sign_in: true,
      apple_sign_in: true,
      trial_available: false,
    });
    auth.signInWithOAuth.mockResolvedValue({ data: {}, error: null });
    render(<AuthPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "auth.continueWithApple" }),
    );
    expect(auth.signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "apple",
      options: { redirectTo: window.location.origin },
    });
  });

  it("shows loading and a localized error when OAuth initiation fails", async () => {
    vi.mocked(getPublicConfig).mockResolvedValue({
      public_registration: false,
      google_sign_in: true,
      facebook_sign_in: false,
      apple_sign_in: false,
      trial_available: false,
    });
    auth.signInWithOAuth.mockResolvedValue({
      data: {},
      error: new Error("provider unavailable"),
    });
    render(<AuthPage />);

    const google = await screen.findByRole("button", {
      name: "auth.continueWithGoogle",
    });
    fireEvent.click(google);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("auth.oauthSignInError")).toBeTruthy();
    await waitFor(() => expect(google.hasAttribute("disabled")).toBe(false));
  });

  it("surfaces and removes sensitive OAuth callback error parameters", async () => {
    vi.mocked(getPublicConfig).mockResolvedValue({
      public_registration: false,
      ...unavailableProviders,
      trial_available: false,
    });
    window.history.replaceState(
      null,
      "",
      "/?error=access_denied&error_description=provider+details",
    );
    render(<AuthPage />);

    expect(await screen.findByText("auth.oauthCallbackError")).toBeTruthy();
    expect(window.location.search).toBe("");
  });
});

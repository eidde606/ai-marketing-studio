import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AuthPage from "./AuthPage";
import { getPublicConfig, registerAccount } from "../services/accountApi";

const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
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
  registerAccount: vi.fn(),
}));

vi.mock("../services/supabaseClient", () => ({
  supabase: { auth },
}));

afterEach(cleanup);

describe("AuthPage registration gate", () => {
  it("does not offer signup when the server keeps registration closed", async () => {
    vi.mocked(getPublicConfig).mockResolvedValue({
      public_registration: false,
    });
    render(<AuthPage />);

    await waitFor(() => {
      expect(getPublicConfig).toHaveBeenCalledOnce();
    });
    expect(
      screen.queryByRole("button", { name: /auth\.noAccount/ }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "auth.signIn" })).toBeTruthy();
  });

  it("only offers signup when the server advertises the disabled-gate replacement", async () => {
    vi.mocked(getPublicConfig).mockResolvedValue({ public_registration: true });
    render(<AuthPage />);

    expect(
      await screen.findByRole("button", { name: /auth\.noAccount/ }),
    ).toBeTruthy();
  });

  it("sends credentials only to Supabase and waits for email verification", async () => {
    vi.mocked(getPublicConfig).mockResolvedValue({ public_registration: true });
    auth.signUp.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    render(<AuthPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: /auth\.noAccount/ }),
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
    expect(registerAccount).not.toHaveBeenCalled();
    expect(await screen.findByText("auth.verifyEmail")).toBeTruthy();
  });
});

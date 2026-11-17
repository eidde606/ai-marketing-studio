import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { ApiError } from "../../lib/apiClient";
import { submitContactRequest } from "./services/contactApi";

vi.mock("./services/contactApi", () => ({
  submitContactRequest: vi.fn(),
}));

const languageKey = "ai-marketing-studio:interface-language";

beforeEach(() => {
  localStorage.setItem(languageKey, "en");
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  localStorage.removeItem(languageKey);
  vi.resetAllMocks();
});

function renderPublicPage(path: string) {
  window.history.replaceState(null, "", path);
  return render(<App />);
}

describe("public legal pages", () => {
  it.each([
    ["/privacy", "Privacy Policy"],
    ["/terms", "Terms of Service"],
    ["/subscriptions", "Subscription & Cancellation Policy"],
    ["/data-deletion", "Account & Data Deletion"],
  ])("renders %s without requiring application authentication", (path, title) => {
    renderPublicPage(path);

    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    expect(screen.getByText("Draft — not yet effective")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Legal and support" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Contact" }).length).toBeGreaterThan(0);
  });

  it("uses the shared language preference and shows Spanish content", async () => {
    renderPublicPage("/privacy");
    fireEvent.change(screen.getByRole("combobox", { name: "Page language" }), {
      target: { value: "es" },
    });

    expect(
      await screen.findByRole("heading", { name: "Política de Privacidad" }),
    ).toBeTruthy();
    expect(screen.getByText("Borrador — aún no vigente")).toBeTruthy();
    expect(localStorage.getItem(languageKey)).toBe("es");
  });

  it("explains manual deletion review and exposes the Meta instructions URL", () => {
    renderPublicPage("/data-deletion");

    expect(
      screen.getByText(/Requests are handled manually/),
    ).toBeTruthy();
    expect(
      screen.getByText(/verify authority and consider their access/),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /https:\/\/studio\.nazborttech\.com\/data-deletion/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/No automated Meta deletion callback/)).toBeTruthy();
  });

  it("submits all required support fields and reports delivery success", async () => {
    vi.mocked(submitContactRequest).mockResolvedValue({
      status: "submitted",
    });
    renderPublicPage("/contact");

    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Inquiry category"), {
      target: { value: "privacy" },
    });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Please explain how I can request data deletion." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await screen.findByRole("status");
    expect(submitContactRequest).toHaveBeenCalledWith({
      name: "Ada Lovelace",
      email: "ada@example.com",
      category: "privacy",
      message: "Please explain how I can request data deletion.",
      website: "",
    });
    expect(
      screen.getByText(
        "Your message was submitted. Please keep a copy for your records.",
      ),
    ).toBeTruthy();
  });

  it("keeps contact failures visible and distinguishes missing email configuration", async () => {
    vi.mocked(submitContactRequest).mockRejectedValue(
      new ApiError("not configured", 503),
    );
    renderPublicPage("/contact");

    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "I need help with my account." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Support email is not configured",
      ),
    );
    expect(submitContactRequest).toHaveBeenCalledOnce();
  });
});

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./SettingsPage";
import type { Business } from "../services/businessesApi";

afterEach(cleanup);

function business(id: string, name: string): Business {
  return {
    id,
    name,
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
}

describe("SettingsPage", () => {
  it("loads the configured profile name and keeps email read-only", () => {
    render(
      <SettingsPage
        businessId="business-1"
        userDisplayName="María"
        userEmail="user@example.com"
        onSaveDisplayName={vi.fn()}
        facebookConnection={<div>Facebook conexión</div>}
        tiktokConnection={<div>TikTok conexión</div>}
      />,
    );

    expect(
      (screen.getByLabelText("Display name") as HTMLInputElement).value,
    ).toBe("María");
    expect(screen.getByText("user@example.com")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Save changes",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("uses a neutral fallback when no profile name is configured", () => {
    render(
      <SettingsPage
        businessId="business-1"
        userDisplayName="My account"
        userEmail="user@example.com"
        onSaveDisplayName={vi.fn()}
        facebookConnection={<div>Facebook conexión</div>}
        instagramConnection={<div>Instagram conexión</div>}
        tiktokConnection={<div>TikTok conexión</div>}
      />,
    );

    expect(
      (screen.getByLabelText("Display name") as HTMLInputElement).value,
    ).toBe("");
    expect(
      screen.getByLabelText("Display name").getAttribute("placeholder"),
    ).toBe("My account");
  });

  it.each([
    ["", "Enter a display name."],
    ["   ", "Enter a display name."],
    ["n".repeat(81), "Name must be 80 characters or fewer."],
  ])("validates the display name %j", (value, message) => {
    const save = vi.fn(async (name: string) => name);
    render(
      <SettingsPage
        businessId="business-1"
        userDisplayName="María"
        userEmail=""
        onSaveDisplayName={save}
        facebookConnection={<div />}
        tiktokConnection={<div />}
      />,
    );

    const input = screen.getByLabelText("Display name");
    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByRole("alert").textContent).toBe(message);
    expect(save).not.toHaveBeenCalled();
  });

  it("saves a trimmed name once and shows success feedback", async () => {
    let resolve!: (value: string) => void;
    const save = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    render(
      <SettingsPage
        businessId="business-1"
        userDisplayName="María"
        userEmail="user@example.com"
        onSaveDisplayName={save}
        facebookConnection={<div />}
        tiktokConnection={<div />}
      />,
    );

    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "  Ana Pérez  " },
    });
    const button = screen.getByRole("button", { name: "Save changes" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("Ana Pérez");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen
        .getAllByRole("status")
        .some((element) => element.textContent?.includes("Saving")),
    ).toBe(true);
    await act(async () => resolve("Ana Pérez"));

    expect(
      document.querySelector(".settings-profile-feedback[role='status']")
        ?.textContent,
    ).toBe("Display name updated.");
    expect(
      (screen.getByLabelText("Display name") as HTMLInputElement).value,
    ).toBe("Ana Pérez");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("user@example.com")).toBeTruthy();
  });

  it("shows update errors and keeps the unsaved value editable", async () => {
    const save = vi.fn(async () => {
      throw new Error("No se pudo guardar el nombre. Inténtalo de nuevo.");
    });
    render(
      <SettingsPage
        businessId="business-1"
        userDisplayName="My account"
        userEmail=""
        onSaveDisplayName={save}
        facebookConnection={<div />}
        tiktokConnection={<div />}
      />,
    );

    const input = screen.getByLabelText("Display name");
    fireEvent.change(input, { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Name couldn't be saved",
    );
    expect((input as HTMLInputElement).value).toBe("Ana");
    expect(
      (
        screen.getByRole("button", {
          name: "Save changes",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("loads business-scoped social integrations only in the integrations section", () => {
    render(
      <SettingsPage
        businessId="business-1"
        userDisplayName="María"
        userEmail="maria@example.com"
        onSaveDisplayName={vi.fn()}
        canManageConnections
        facebookConnection={<div>Facebook conexión</div>}
        instagramConnection={<div>Instagram conexión</div>}
        tiktokConnection={<div>TikTok conexión</div>}
      />,
    );

    expect(screen.queryByText("Facebook conexión")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Integrations" }));
    expect(screen.getByText("Facebook conexión")).toBeTruthy();
    expect(screen.getByText("Instagram conexión")).toBeTruthy();
    expect(screen.getByText("TikTok conexión")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Social accounts" }),
    ).toBeTruthy();
  });

  it("explains when no business is selected", () => {
    render(
      <SettingsPage
        businessId=""
        userDisplayName="My account"
        userEmail=""
        onSaveDisplayName={vi.fn()}
        facebookConnection={<div>Facebook conexión</div>}
        tiktokConnection={<div>TikTok conexión</div>}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Integrations" }));
    expect(screen.getByText("No business selected.")).toBeTruthy();
  });

  it("does not mount social connection controls for a member", () => {
    render(
      <SettingsPage
        businessId="business-1"
        userDisplayName="Member"
        userEmail="member@example.com"
        onSaveDisplayName={vi.fn()}
        facebookConnection={<button>Connect Facebook</button>}
        tiktokConnection={<button>Connect TikTok</button>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Integrations" }));
    expect(
      screen.queryByRole("button", { name: "Connect Facebook" }),
    ).toBeNull();
    expect(screen.getByText(/can't manage social connections/)).toBeTruthy();
  });

  it("discards unsaved business profile edits when switching tenants", () => {
    const save = vi.fn(async () => {});
    const props = {
      businessId: "business-1",
      userDisplayName: "Owner",
      userEmail: "owner@example.com",
      onSaveDisplayName: vi.fn(async (name: string) => name),
      canEditBusiness: true,
      onSaveBusiness: save,
      facebookConnection: <div />,
      tiktokConnection: <div />,
    };
    const { rerender } = render(
      <SettingsPage {...props} business={business("business-1", "First")} />,
    );
    const name = screen.getByLabelText(/Business name/);
    fireEvent.change(name, { target: { value: "Unsaved first" } });
    expect((name as HTMLInputElement).value).toBe("Unsaved first");

    rerender(
      <SettingsPage {...props} business={business("business-2", "Second")} />,
    );
    expect(
      (screen.getByLabelText(/Business name/) as HTMLInputElement).value,
    ).toBe("Second");
    expect(save).not.toHaveBeenCalled();
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InstagramConnection from "./InstagramConnection";
import {
  getInstagramConnection,
  startInstagramConnection,
} from "../services/instagramApi";

vi.mock("../services/instagramApi", () => ({
  getInstagramConnection: vi.fn(),
  startInstagramConnection: vi.fn(),
}));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", window.location.pathname);
  vi.resetAllMocks();
});

const connection = (
  status:
    | "not_connected"
    | "linked_not_api_authorized"
    | "connected_and_authorized"
    | "reauthorization_required"
    | "permission_error"
    | "discovery_error",
) => ({
  status,
  username: status === "not_connected" ? null : "holacompravibes",
  facebook_page_id: "page-1",
  facebook_page_name: "Hola Compra Vibes",
  granted_permissions:
    status === "connected_and_authorized"
      ? [
          "instagram_basic",
          "instagram_content_publish",
          "pages_show_list",
          "pages_read_engagement",
        ]
      : ["instagram_basic", "pages_show_list", "pages_read_engagement"],
  missing_permissions:
    status === "linked_not_api_authorized"
      ? ["instagram_content_publish"]
      : [],
  message:
    status === "linked_not_api_authorized"
      ? "Falta el permiso de publicación."
      : null,
});

describe("InstagramConnection", () => {
  it("reports an unconnected account and permits connecting", async () => {
    vi.mocked(getInstagramConnection).mockResolvedValue(
      connection("not_connected"),
    );
    vi.mocked(startInstagramConnection).mockRejectedValue(
      new Error("Conecta primero una página de Facebook para este negocio."),
    );
    render(<InstagramConnection businessId="business-1" />);

    expect(await screen.findByText("Not connected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect Instagram" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Conecta primero una página de Facebook",
    );
    expect(startInstagramConnection).toHaveBeenCalledWith("business-1");
  });

  it("shows a verified username and the authorized status without exposing tokens", async () => {
    vi.mocked(getInstagramConnection).mockResolvedValue(
      connection("connected_and_authorized"),
    );
    render(<InstagramConnection businessId="business-1" />);

    expect(await screen.findByText("Connected and authorized")).toBeTruthy();
    expect(screen.getByText("@holacompravibes")).toBeTruthy();
    expect(screen.getByText("Facebook Page: Hola Compra Vibes")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Reconnect Instagram" }),
    ).toBeTruthy();
  });

  it("distinguishes a linked account from one authorized to publish", async () => {
    vi.mocked(getInstagramConnection).mockResolvedValue(
      connection("linked_not_api_authorized"),
    );
    render(<InstagramConnection businessId="business-1" />);

    expect(
      await screen.findByText("Linked · permissions missing"),
    ).toBeTruthy();
    expect(screen.getByText(/Missing permissions: instagram_content_publish/)).toBeTruthy();
    expect(screen.queryByText("Connected and authorized")).toBeNull();
  });

  it.each([
    ["reauthorization_required", "Reauthorization required"],
    ["permission_error", "Insufficient permissions"],
    ["discovery_error", "Could not verify"],
  ] as const)("shows the actionable %s state", async (status, label) => {
    vi.mocked(getInstagramConnection).mockResolvedValue(connection(status));
    render(<InstagramConnection businessId="business-1" />);
    expect(await screen.findByText(label)).toBeTruthy();
  });

  it("surfaces the result of the Meta callback and refreshes saved status", async () => {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}#instagram_result=connected_and_authorized`,
    );
    vi.mocked(getInstagramConnection).mockResolvedValue(
      connection("connected_and_authorized"),
    );
    render(<InstagramConnection businessId="business-1" />);

    expect(
      await screen.findByText("Instagram was connected and authorized by Meta."),
    ).toBeTruthy();
    expect(getInstagramConnection).toHaveBeenCalledWith("business-1");
    expect(window.location.hash).toBe("");
  });

  it("explains when no business is selected", () => {
    render(<InstagramConnection businessId="" />);
    expect(screen.getByText("Select a business to manage Instagram.")).toBeTruthy();
    expect(
      (screen.getByRole("button", {
        name: "Connect Instagram",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(getInstagramConnection).not.toHaveBeenCalled();
  });
});

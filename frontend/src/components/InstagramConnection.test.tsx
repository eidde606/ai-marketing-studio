import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InstagramConnection from "./InstagramConnection";
import {
  disconnectInstagramConnection,
  getInstagramConnection,
  startInstagramConnection,
} from "../services/instagramApi";

vi.mock("../services/instagramApi", () => ({
  disconnectInstagramConnection: vi.fn(),
  getInstagramConnection: vi.fn(),
  startInstagramConnection: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
    status === "linked_not_api_authorized" ? ["instagram_content_publish"] : [],
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
    expect(
      await screen.findByText(
        "Connect a Facebook Page to this business before connecting Instagram.",
      ),
    ).toBeTruthy();
    expect(await screen.findByText("Action needed")).toBeTruthy();
    expect(startInstagramConnection).toHaveBeenCalledWith("business-1");
  });

  it("explains that Instagram must be linked through one selected Facebook Page", async () => {
    vi.mocked(getInstagramConnection).mockResolvedValue(
      connection("not_connected"),
    );
    vi.mocked(startInstagramConnection).mockRejectedValue(
      new Error(
        "Desconecta las páginas adicionales de Facebook de este negocio antes de conectar Instagram.",
      ),
    );
    render(<InstagramConnection businessId="business-1" />);

    await screen.findByText("Not connected");
    fireEvent.click(screen.getByRole("button", { name: "Connect Instagram" }));

    expect(
      await screen.findByText(
        "Keep exactly one Facebook Page connected to this business before connecting Instagram, so the linked account is unambiguous.",
      ),
    ).toBeTruthy();
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

  it("uses the same grouped Reconnect and Disconnect action layout", async () => {
    vi.mocked(getInstagramConnection).mockResolvedValue(
      connection("connected_and_authorized"),
    );
    const { container } = render(<InstagramConnection businessId="business-1" />);

    await screen.findByRole("button", { name: "Reconnect Instagram" });
    const actions = container.querySelector(".social-connection-actions");
    expect(actions).not.toBeNull();
    expect(
      within(actions as HTMLElement).getByRole("button", {
        name: "Reconnect Instagram",
      }),
    ).toBeTruthy();
    expect(
      within(actions as HTMLElement).getByRole("button", { name: "Disconnect" }),
    ).toBeTruthy();
  });

  it("disconnects the account and refreshes the saved business status", async () => {
    vi.mocked(getInstagramConnection).mockResolvedValue(
      connection("connected_and_authorized"),
    );
    vi.mocked(disconnectInstagramConnection).mockResolvedValue(undefined);
    render(<InstagramConnection businessId="business-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Disconnect Instagram account?",
    });
    expect(
      within(dialog).getByText(
        /@holacompravibes.*Hola Compra Vibes/,
      ),
    ).toBeTruthy();
    expect(disconnectInstagramConnection).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Disconnect Instagram" }),
    );

    await waitFor(() =>
      expect(disconnectInstagramConnection).toHaveBeenCalledWith("business-1"),
    );
    expect(
      await screen.findByText(
        "Instagram disconnected from this business. To revoke Meta access, remove AI Marketing Studio in your Meta account settings.",
      ),
    ).toBeTruthy();
    await waitFor(() =>
      expect(getInstagramConnection).toHaveBeenCalledTimes(2),
    );
  });

  it("cancels the Instagram disconnect without calling the backend", async () => {
    vi.mocked(getInstagramConnection).mockResolvedValue(
      connection("connected_and_authorized"),
    );
    render(<InstagramConnection businessId="business-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(disconnectInstagramConnection).not.toHaveBeenCalled();
  });

  it("keeps the Instagram confirmation open when disconnect fails", async () => {
    vi.mocked(getInstagramConnection).mockResolvedValue(
      connection("connected_and_authorized"),
    );
    vi.mocked(disconnectInstagramConnection).mockRejectedValue(
      new Error("offline"),
    );
    render(<InstagramConnection businessId="business-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Disconnect Instagram" }),
    );

    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect(
      within(dialog).getByText("Instagram could not be disconnected."),
    ).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("prevents repeated Instagram disconnect submissions", async () => {
    let finishDisconnect!: () => void;
    vi.mocked(getInstagramConnection).mockResolvedValue(
      connection("connected_and_authorized"),
    );
    vi.mocked(disconnectInstagramConnection).mockReturnValue(
      new Promise<void>((resolve) => {
        finishDisconnect = resolve;
      }),
    );
    render(<InstagramConnection businessId="business-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", {
      name: "Disconnect Instagram",
    });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(disconnectInstagramConnection).toHaveBeenCalledTimes(1);
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);
    finishDisconnect();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("distinguishes a linked account from one authorized to publish", async () => {
    vi.mocked(getInstagramConnection).mockResolvedValue(
      connection("linked_not_api_authorized"),
    );
    render(<InstagramConnection businessId="business-1" />);

    expect(
      await screen.findByText("Linked · permissions missing"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Meta has not granted all access needed to verify this account. Review the connection and try again.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/instagram_content_publish/)).toBeNull();
    expect(screen.queryByText("Connected and authorized")).toBeNull();
  });

  it("explains when Meta connection setup is required", async () => {
    vi.mocked(getInstagramConnection).mockResolvedValue(
      connection("not_connected"),
    );
    vi.mocked(startInstagramConnection).mockRejectedValue(
      new Error("La conexión de Instagram no está configurada en el servidor."),
    );
    render(<InstagramConnection businessId="business-1" />);

    await screen.findByText("Not connected");
    fireEvent.click(screen.getByRole("button", { name: "Connect Instagram" }));

    expect(
      await screen.findByText(
        "Instagram connection setup is incomplete. Ask an administrator to check the Meta configuration.",
      ),
    ).toBeTruthy();
    expect(await screen.findByText("Setup required")).toBeTruthy();
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
      await screen.findByText(
        "Instagram was connected and authorized by Meta.",
      ),
    ).toBeTruthy();
    expect(getInstagramConnection).toHaveBeenCalledWith("business-1");
    expect(window.location.hash).toBe("");
  });

  it("explains when no business is selected", () => {
    render(<InstagramConnection businessId="" />);
    expect(
      screen.getByText("Select a business to manage Instagram."),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Connect Instagram",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(getInstagramConnection).not.toHaveBeenCalled();
  });
});

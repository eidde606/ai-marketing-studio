import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TikTokConnection from "./TikTokConnection";

const mocks = vi.hoisted(() => ({
  disconnectTikTokAccount: vi.fn(),
  getConnectedTikTokAccounts: vi.fn(),
  startTikTokConnection: vi.fn(),
}));

vi.mock("../services/tiktokApi", () => mocks);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe("TikTokConnection", () => {
  it("reports the returned business account status without claiming pending access is connected", async () => {
    mocks.getConnectedTikTokAccounts.mockResolvedValue([
      {
        id: "account-1",
        account_name: "Cuenta de prueba",
        connection_status: "pending",
      },
    ]);

    render(<TikTokConnection businessId="business-1" />);

    expect(await screen.findByText("Review access")).toBeTruthy();
    expect(
      screen.getByText("Cuenta de prueba — Authorization needs review"),
    ).toBeTruthy();
    expect(mocks.getConnectedTikTokAccounts).toHaveBeenCalledWith("business-1");
    expect(screen.getByRole("button", { name: "Connect TikTok" })).toBeTruthy();
    expect(screen.getByText(/Connection availability is checked/)).toBeTruthy();
  });

  it("reports the configured direct-publishing capability without overstating provider approval", async () => {
    mocks.getConnectedTikTokAccounts.mockResolvedValue([]);

    render(
      <TikTokConnection
        businessId="business-1"
        directPublishingEnabled={true}
      />,
    );

    expect(await screen.findByText("Not connected")).toBeTruthy();
    expect(
      screen.getByText(
        "Direct TikTok publishing is enabled by this application's configuration, but account eligibility, permissions and provider approval still apply.",
      ),
    ).toBeTruthy();
  });

  it("does not display another business's connected status when selection changes", async () => {
    mocks.getConnectedTikTokAccounts.mockResolvedValue([
      {
        id: "account-1",
        account_name: "Cuenta de prueba",
        connection_status: "connected",
      },
    ]);
    const view = render(<TikTokConnection businessId="business-1" />);

    expect(await screen.findByText("Connected")).toBeTruthy();
    view.rerender(<TikTokConnection businessId="" />);

    await waitFor(() => {
      expect(screen.queryByText("Connected")).toBeNull();
    });
    expect(screen.queryByText(/Cuenta de prueba/)).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Connect TikTok",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("offers a retry when connection status cannot be verified", async () => {
    mocks.getConnectedTikTokAccounts.mockRejectedValue(new Error("offline"));

    render(<TikTokConnection businessId="business-1" />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      await screen.findByText("Connection status unavailable"),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Retry verification" }),
    ).toBeTruthy();
  });

  it("does not claim TikTok is connected after authorization cannot start", async () => {
    mocks.getConnectedTikTokAccounts.mockResolvedValue([]);
    mocks.startTikTokConnection.mockRejectedValue(new Error("server error"));

    render(<TikTokConnection businessId="business-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect TikTok" }),
    );

    expect(
      await screen.findByText(
        "TikTok authorization could not be started. If the problem continues, ask an administrator to check the TikTok connection setup.",
      ),
    ).toBeTruthy();
    expect(
      await screen.findByText("Connection status unavailable"),
    ).toBeTruthy();
  });

  it("disconnects a selected account from the active business", async () => {
    mocks.getConnectedTikTokAccounts.mockResolvedValue([
      {
        id: "account-1",
        account_name: "TikTok account",
        connection_status: "connected",
      },
    ]);
    mocks.disconnectTikTokAccount.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TikTokConnection businessId="business-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

    await waitFor(() =>
      expect(mocks.disconnectTikTokAccount).toHaveBeenCalledWith(
        "business-1",
        "account-1",
      ),
    );
    expect(
      await screen.findByText(
        "TikTok disconnected from this business. To revoke access, remove AI Marketing Studio in your TikTok account settings.",
      ),
    ).toBeTruthy();
  });
});

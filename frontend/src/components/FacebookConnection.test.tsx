import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FacebookConnection from "./FacebookConnection";
import { FacebookApiError } from "../services/facebookApi";
import type { FacebookHandoffContext } from "../app/facebookOAuthReturn";

const mocks = vi.hoisted(() => {
  class MockFacebookApiError extends Error {
    constructor(
      message: string,
      readonly status?: number,
    ) {
      super(message);
    }
  }
  return {
    disconnectFacebookAccount: vi.fn(),
    FacebookApiError: MockFacebookApiError,
    getConnectedFacebookAccounts: vi.fn(),
    getFacebookHandoff: vi.fn(),
    selectFacebookPage: vi.fn(),
    startFacebookConnection: vi.fn(),
  };
});

vi.mock("../services/facebookApi", () => mocks);
vi.mock("../app/useLocalization", () => ({
  useLocalization: () => ({
    t: (key: string, values?: Record<string, string>) =>
      key === "facebook.disconnectDialogDescription"
        ? `Disconnect ${values?.name}`
        : key,
  }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", window.location.pathname);
  vi.resetAllMocks();
});

const handoff: FacebookHandoffContext = {
  token: "one-time-token",
  businessId: "business-1",
};

function renderConnection(
  props: Partial<React.ComponentProps<typeof FacebookConnection>> = {},
) {
  return render(
    <FacebookConnection
      businessId="business-1"
      handoff={null}
      callbackResult={null}
      canManageConnections
      onHandoffResolved={vi.fn()}
      {...props}
    />,
  );
}

describe("FacebookConnection", () => {
  it("distinguishes a disconnected account", async () => {
    mocks.getConnectedFacebookAccounts.mockResolvedValue([]);

    renderConnection();

    expect(await screen.findByText("facebook.statusDisconnected")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "facebook.connect" }),
    ).toBeTruthy();
  });

  it("shows a connected Page only for the selected business", async () => {
    mocks.getConnectedFacebookAccounts.mockImplementation(
      async (businessId: string) =>
        businessId === "business-1"
          ? [
              {
                id: "account-1",
                platform: "facebook",
                page_id: "page-1",
                page_name: "Business Page",
                connection_status: "connected",
              },
            ]
          : [],
    );
    const view = renderConnection();

    expect(await screen.findByText("facebook.connected")).toBeTruthy();
    expect(screen.getByText(/Business Page/)).toBeTruthy();

    view.rerender(
      <FacebookConnection
        businessId="business-2"
        handoff={null}
        callbackResult={null}
        canManageConnections
        onHandoffResolved={vi.fn()}
      />,
    );
    expect(screen.queryByText("Business Page")).toBeNull();
    expect(await screen.findByText("facebook.statusDisconnected")).toBeTruthy();
  });

  it("warns when more than one Page would make publishing ambiguous", async () => {
    mocks.getConnectedFacebookAccounts.mockResolvedValue([
      {
        id: "account-1",
        platform: "facebook",
        page_id: "page-1",
        page_name: "Business Page",
        connection_status: "connected",
      },
      {
        id: "account-2",
        platform: "facebook",
        page_id: "page-2",
        page_name: "Other Page",
        connection_status: "connected",
      },
    ]);

    renderConnection();

    expect(
      await screen.findByText("facebook.multiplePagesWarning"),
    ).toBeTruthy();
  });

  it("offers a retry when connection status cannot be verified", async () => {
    mocks.getConnectedFacebookAccounts.mockRejectedValue(new Error("offline"));

    renderConnection();

    expect(await screen.findByText("facebook.statusUnavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "facebook.retry" }));
    await waitFor(() =>
      expect(mocks.getConnectedFacebookAccounts).toHaveBeenCalledTimes(2),
    );
  });

  it("shows a clear authorization error without exposing provider details", async () => {
    mocks.getConnectedFacebookAccounts.mockResolvedValue([]);
    mocks.startFacebookConnection.mockRejectedValue(new Error("server error"));

    renderConnection();
    await screen.findByText("facebook.statusDisconnected");
    fireEvent.click(screen.getByRole("button", { name: "facebook.connect" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("facebook.startError")).toBeTruthy();
    expect(screen.getByText("facebook.statusUnavailable")).toBeTruthy();
  });

  it("confirms the Page and disconnects only it through the scoped API", async () => {
    mocks.getConnectedFacebookAccounts.mockResolvedValue([
      {
        id: "account-1",
        platform: "facebook",
        page_id: "page-1",
        page_name: "Business Page",
        connection_status: "connected",
      },
    ]);
    mocks.disconnectFacebookAccount.mockResolvedValue(undefined);
    renderConnection();

    fireEvent.click(
      await screen.findByRole("button", { name: "facebook.disconnect" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "facebook.disconnectDialogTitle",
    });
    expect(within(dialog).getByText("Disconnect Business Page")).toBeTruthy();
    expect(mocks.disconnectFacebookAccount).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "facebook.confirmDisconnect" }),
    );
    await waitFor(() =>
      expect(mocks.disconnectFacebookAccount).toHaveBeenCalledTimes(1),
    );
    expect(mocks.disconnectFacebookAccount).toHaveBeenCalledWith(
      "business-1",
      "account-1",
    );
    expect(await screen.findByText("facebook.disconnected")).toBeTruthy();
    await waitFor(() =>
      expect(mocks.getConnectedFacebookAccounts).toHaveBeenCalledTimes(2),
    );
  });

  it("groups Reconnect and page-specific Disconnect actions together", async () => {
    mocks.getConnectedFacebookAccounts.mockResolvedValue([
      {
        id: "account-1",
        platform: "facebook",
        page_id: "page-1",
        page_name: "Business Page",
        connection_status: "connected",
      },
    ]);
    const { container } = renderConnection();

    await screen.findByRole("button", { name: "facebook.reconnect" });
    const actions = container.querySelector(".social-connection-actions");
    expect(actions).not.toBeNull();
    expect(
      within(actions as HTMLElement).getByRole("button", {
        name: "facebook.reconnect",
      }),
    ).toBeTruthy();
    expect(
      within(actions as HTMLElement).getByRole("button", {
        name: "facebook.disconnect",
      }),
    ).toBeTruthy();
    expect(await screen.findByText(/Business Page/)).toBeTruthy();
  });

  it("cancels the Facebook disconnect without calling the backend", async () => {
    mocks.getConnectedFacebookAccounts.mockResolvedValue([
      {
        id: "account-1",
        platform: "facebook",
        page_id: "page-1",
        page_name: "Business Page",
        connection_status: "connected",
      },
    ]);
    renderConnection();
    fireEvent.click(
      await screen.findByRole("button", { name: "facebook.disconnect" }),
    );

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "common.cancel" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.disconnectFacebookAccount).not.toHaveBeenCalled();
  });

  it("does not offer an active disconnect action without connection-management access", async () => {
    mocks.getConnectedFacebookAccounts.mockResolvedValue([
      {
        id: "account-1",
        platform: "facebook",
        page_id: "page-1",
        page_name: "Business Page",
        connection_status: "connected",
      },
    ]);
    renderConnection({ canManageConnections: false });

    const disconnect = await screen.findByRole("button", {
      name: "facebook.disconnect",
    });
    expect((disconnect as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(disconnect);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.disconnectFacebookAccount).not.toHaveBeenCalled();
  });

  it("keeps the confirmation open after a disconnect failure", async () => {
    mocks.getConnectedFacebookAccounts.mockResolvedValue([
      {
        id: "account-1",
        platform: "facebook",
        page_id: "page-1",
        page_name: "Business Page",
        connection_status: "connected",
      },
    ]);
    mocks.disconnectFacebookAccount.mockRejectedValue(new Error("offline"));
    renderConnection();
    fireEvent.click(
      await screen.findByRole("button", { name: "facebook.disconnect" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "facebook.confirmDisconnect" }),
    );

    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect(
      within(dialog).getByText("facebook.disconnectError"),
    ).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("prevents repeated Facebook disconnect submissions", async () => {
    let finishDisconnect!: () => void;
    mocks.getConnectedFacebookAccounts.mockResolvedValue([
      {
        id: "account-1",
        platform: "facebook",
        page_id: "page-1",
        page_name: "Business Page",
        connection_status: "connected",
      },
    ]);
    mocks.disconnectFacebookAccount.mockReturnValue(
      new Promise<void>((resolve) => {
        finishDisconnect = resolve;
      }),
    );
    renderConnection();
    fireEvent.click(
      await screen.findByRole("button", { name: "facebook.disconnect" }),
    );
    const dialog = await screen.findByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", {
      name: "facebook.confirmDisconnect",
    });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(mocks.disconnectFacebookAccount).toHaveBeenCalledTimes(1);
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);
    finishDisconnect();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("loads and selects a Page only for the handoff business", async () => {
    const resolved = vi.fn();
    mocks.getConnectedFacebookAccounts.mockResolvedValue([]);
    mocks.getFacebookHandoff.mockResolvedValue({
      business_id: "business-1",
      pages: [{ id: "page-1", name: "Business Page" }],
    });
    mocks.selectFacebookPage.mockResolvedValue({
      status: "connected",
      business_id: "business-1",
      page_id: "page-1",
      page_name: "Business Page",
    });

    renderConnection({ handoff, onHandoffResolved: resolved });

    expect(
      await screen.findByRole("button", { name: /Business Page/ }),
    ).toBeTruthy();
    expect(mocks.getFacebookHandoff).toHaveBeenCalledWith(
      "one-time-token",
      "business-1",
    );
    fireEvent.click(screen.getByRole("button", { name: /Business Page/ }));
    await waitFor(() =>
      expect(mocks.selectFacebookPage).toHaveBeenCalledWith(
        "one-time-token",
        "business-1",
        "page-1",
      ),
    );
    await waitFor(() => expect(resolved).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(mocks.getConnectedFacebookAccounts).toHaveBeenCalledWith(
        "business-1",
      ),
    );
  });

  it("preserves the handoff while the authenticated session is unavailable", async () => {
    const resolved = vi.fn();
    mocks.getConnectedFacebookAccounts.mockResolvedValue([]);
    mocks.getFacebookHandoff.mockRejectedValue(
      new FacebookApiError("sign in required", 401),
    );

    renderConnection({ handoff, onHandoffResolved: resolved });

    expect(await screen.findByText("facebook.handoffSignIn")).toBeTruthy();
    expect(resolved).not.toHaveBeenCalled();
  });

  it("clears an expired handoff and reports that the user must reconnect", async () => {
    const resolved = vi.fn();
    mocks.getConnectedFacebookAccounts.mockResolvedValue([]);
    mocks.getFacebookHandoff.mockRejectedValue(
      new FacebookApiError("expired", 400),
    );

    renderConnection({ handoff, onHandoffResolved: resolved });

    expect(await screen.findByText("facebook.handoffExpired")).toBeTruthy();
    expect(resolved).toHaveBeenCalledOnce();
  });

  it("does not claim or display a handoff for a different business", async () => {
    mocks.getConnectedFacebookAccounts.mockResolvedValue([]);

    renderConnection({ businessId: "business-2", handoff });

    expect(await screen.findByText("facebook.wrongBusiness")).toBeTruthy();
    expect(mocks.getFacebookHandoff).not.toHaveBeenCalled();
    expect(screen.queryByText("Business Page")).toBeNull();
  });

  it("rejects pages returned for a business other than the handoff target", async () => {
    mocks.getConnectedFacebookAccounts.mockResolvedValue([]);
    mocks.getFacebookHandoff.mockResolvedValue({
      business_id: "business-2",
      pages: [{ id: "page-2", name: "Other Business Page" }],
    });

    renderConnection({ handoff });

    expect(await screen.findByText("facebook.wrongBusiness")).toBeTruthy();
    expect(screen.queryByText("Other Business Page")).toBeNull();
  });
});

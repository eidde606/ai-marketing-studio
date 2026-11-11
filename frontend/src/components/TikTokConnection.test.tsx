import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TikTokConnection from "./TikTokConnection";

const mocks = vi.hoisted(() => ({
  getConnectedTikTokAccounts: vi.fn(),
  startTikTokConnection: vi.fn(),
}));

vi.mock("../services/tiktokApi", () => mocks);

afterEach(() => {
  cleanup();
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

    expect(await screen.findByText("Revisar acceso")).toBeTruthy();
    expect(screen.getByText("Cuenta de prueba — Estado: pending")).toBeTruthy();
    expect(mocks.getConnectedTikTokAccounts).toHaveBeenCalledWith(
      "business-1",
    );
    expect(screen.getByRole("button", { name: "Conectar TikTok" })).toBeTruthy();
    expect(screen.getByText(/La publicación depende de los permisos/)).toBeTruthy();
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

    expect(await screen.findByText("Conectada")).toBeTruthy();
    view.rerender(<TikTokConnection businessId="" />);

    await waitFor(() => {
      expect(screen.queryByText("Conectada")).toBeNull();
    });
    expect(screen.queryByText(/Cuenta de prueba/)).toBeNull();
    expect(
      (screen.getByRole("button", {
        name: "Conectar TikTok",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("offers a retry when connection status cannot be verified", async () => {
    mocks.getConnectedTikTokAccounts.mockRejectedValue(new Error("offline"));

    render(<TikTokConnection businessId="business-1" />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Reintentar verificación" }),
    ).toBeTruthy();
  });
});

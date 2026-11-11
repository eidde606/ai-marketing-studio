import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateUser: vi.fn(),
}));

vi.mock("./supabaseClient", () => ({
  supabase: { auth: { updateUser: mocks.updateUser } },
}));

import { updateOwnDisplayName } from "./profileApi";

afterEach(() => {
  vi.resetAllMocks();
});

describe("updateOwnDisplayName", () => {
  it("updates display_name through the authenticated user's metadata only", async () => {
    const user = { id: "authenticated-user" };
    mocks.updateUser.mockResolvedValue({ data: { user }, error: null });

    await expect(updateOwnDisplayName("  Ana Pérez  ")).resolves.toEqual({
      displayName: "Ana Pérez",
      user,
    });
    expect(mocks.updateUser).toHaveBeenCalledWith({
      data: { display_name: "Ana Pérez" },
    });
    expect(mocks.updateUser.mock.calls[0]).toHaveLength(1);
  });

  it.each(["", "  ", "x".repeat(81)])(
    "rejects invalid names without calling Supabase: %j",
    async (name) => {
      await expect(updateOwnDisplayName(name)).rejects.toThrow();
      expect(mocks.updateUser).not.toHaveBeenCalled();
    },
  );

  it("surfaces Supabase update failures instead of returning success", async () => {
    mocks.updateUser.mockResolvedValue({
      data: { user: null },
      error: new Error("Supabase unavailable"),
    });

    await expect(updateOwnDisplayName("Ana")).rejects.toThrow(
      "No se pudo guardar el nombre. Inténtalo de nuevo.",
    );
  });

  it("requires a returned user to confirm the metadata update", async () => {
    mocks.updateUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    await expect(updateOwnDisplayName("Ana")).rejects.toThrow(
      "No se pudo confirmar el nombre actualizado.",
    );
  });
});

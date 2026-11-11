import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./SettingsPage";

afterEach(cleanup);

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
      (screen.getByLabelText("Nombre para mostrar") as HTMLInputElement).value,
    ).toBe("María");
    expect(screen.getByText("user@example.com")).toBeTruthy();
    expect(
      (screen.getByRole("button", {
        name: "Guardar cambios",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("uses a neutral fallback when no profile name is configured", () => {
    render(
      <SettingsPage
        businessId="business-1"
        userDisplayName="Mi cuenta"
        userEmail="user@example.com"
        onSaveDisplayName={vi.fn()}
        facebookConnection={<div>Facebook conexión</div>}
        instagramConnection={<div>Instagram conexión</div>}
        tiktokConnection={<div>TikTok conexión</div>}
      />,
    );

    expect(
      (screen.getByLabelText("Nombre para mostrar") as HTMLInputElement).value,
    ).toBe("");
    expect(
      screen.getByLabelText("Nombre para mostrar").getAttribute("placeholder"),
    ).toBe("Mi cuenta");
  });

  it.each([
    ["", "Escribe un nombre para mostrar."],
    ["   ", "Escribe un nombre para mostrar."],
    ["n".repeat(81), "El nombre no puede superar los 80 caracteres."],
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

    const input = screen.getByLabelText("Nombre para mostrar");
    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

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

    fireEvent.change(screen.getByLabelText("Nombre para mostrar"), {
      target: { value: "  Ana Pérez  " },
    });
    const button = screen.getByRole("button", { name: "Guardar cambios" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("Ana Pérez");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Guardando");
    await act(async () => resolve("Ana Pérez"));

    expect(screen.getByRole("status").textContent).toBe(
      "Nombre para mostrar actualizado.",
    );
    expect(
      (screen.getByLabelText("Nombre para mostrar") as HTMLInputElement).value,
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
        userDisplayName="Mi cuenta"
        userEmail=""
        onSaveDisplayName={save}
        facebookConnection={<div />}
        tiktokConnection={<div />}
      />,
    );

    const input = screen.getByLabelText("Nombre para mostrar");
    fireEvent.change(input, { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "No se pudo guardar",
    );
    expect((input as HTMLInputElement).value).toBe("Ana");
    expect(
      (screen.getByRole("button", {
        name: "Guardar cambios",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("loads business-scoped social integrations only in the integrations section", () => {
    render(
      <SettingsPage
        businessId="business-1"
        userDisplayName="María"
        userEmail="maria@example.com"
        onSaveDisplayName={vi.fn()}
        facebookConnection={<div>Facebook conexión</div>}
        instagramConnection={<div>Instagram conexión</div>}
        tiktokConnection={<div>TikTok conexión</div>}
      />,
    );

    expect(screen.queryByText("Facebook conexión")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Integraciones" }));
    expect(screen.getByText("Facebook conexión")).toBeTruthy();
    expect(screen.getByText("Instagram conexión")).toBeTruthy();
    expect(screen.getByText("TikTok conexión")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Redes sociales" })).toBeTruthy();
  });

  it("explains when no business is selected", () => {
    render(
      <SettingsPage
        businessId=""
        userDisplayName="Mi cuenta"
        userEmail=""
        onSaveDisplayName={vi.fn()}
        facebookConnection={<div>Facebook conexión</div>}
        tiktokConnection={<div>TikTok conexión</div>}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Integraciones" }));
    expect(screen.getByText("No hay un negocio seleccionado.")).toBeTruthy();
  });
});

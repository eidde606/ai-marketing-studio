import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CampaignsPage from "./CampaignsPage";
import type { Campaign } from "../services/campaignsApi";
import { getDrafts, type Draft } from "../services/draftsApi";

const campaignApi = vi.hoisted(() => ({
  createCampaign: vi.fn(),
  deleteCampaign: vi.fn(),
  getCampaigns: vi.fn(),
  setCampaignDraft: vi.fn(),
  updateCampaign: vi.fn(),
}));

vi.mock("../services/campaignsApi", () => campaignApi);
vi.mock("../services/draftsApi", () => ({
  getDrafts: vi.fn(),
}));

const campaign: Campaign = {
  id: "campaign-1",
  business_id: "business-1",
  name: "Campaña de verano",
  objective: "Aumentar las visitas",
  status: "active",
  start_date: null,
  end_date: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  total_count: 0,
  published_count: 0,
  pending_count: 0,
  rejected_count: 0,
  progress: 0,
  drafts: [],
};

const associatedDraft: Draft = {
  id: "draft-1",
  business_id: "business-1",
  campaign_id: campaign.id,
  title: "Publicación conservada",
  caption: "Texto original",
  platform: "facebook",
  publish_destinations: ["facebook"],
  status: "approved",
  facebook_post_id: "published-post",
  facebook_publish_status: "published",
  tiktok_publish_id: null,
  tiktok_publish_status: "not_published",
  published_at: "2026-01-02T00:00:00Z",
  deleted_at: null,
  source: "manual",
  created_at: "2026-01-01T00:00:00Z",
  image_prompt: null,
  image_url: null,
  image_status: "not_started",
  media_type: "text",
  video_status: "not_started",
  video_url: null,
};

const remainingCampaign: Campaign = {
  ...campaign,
  id: "campaign-2",
  name: "Campaña de otoño",
};

async function openDeletionForm() {
  render(<CampaignsPage businessId="business-1" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Editar campaña" }),
  );
  return screen.getByRole("button", { name: "Eliminar campaña" });
}

describe("CampaignsPage campaign management", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Unexpected network request: mock the API service.");
      }),
    );
    campaignApi.getCampaigns.mockResolvedValue([campaign]);
    vi.mocked(getDrafts).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    const networkCalls = vi.mocked(fetch).mock.calls.length;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    expect(networkCalls).toBe(0);
  });

  it("makes no changes when deletion confirmation is canceled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<CampaignsPage businessId="business-1" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Editar campaña" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Eliminar campaña" }));

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("Campaña de verano"),
    );
    expect(campaignApi.deleteCampaign).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Editar campaña" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Campaña de verano", { selector: "strong" }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText(/Campaña eliminada correctamente/)).toBeNull();
    });
    confirm.mockRestore();
  });

  it("removes the campaign and makes its preserved content available to another campaign", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    campaignApi.getCampaigns.mockResolvedValue([campaign, remainingCampaign]);
    vi.mocked(getDrafts).mockResolvedValue([associatedDraft]);
    campaignApi.deleteCampaign.mockResolvedValue({
      message: "Campaña eliminada correctamente.",
    });

    const deleteButton = await openDeletionForm();
    expect(
      screen.queryByRole("option", { name: /Publicación conservada/ }),
    ).toBeNull();
    fireEvent.click(deleteButton);

    await screen.findByText(
      "Campaña eliminada correctamente. Su contenido e historial se conservaron.",
    );
    expect(campaignApi.deleteCampaign).toHaveBeenCalledTimes(1);
    expect(campaignApi.deleteCampaign).toHaveBeenCalledWith(
      "business-1",
      "campaign-1",
    );
    expect(
      screen.queryByText(campaign.name, { selector: "strong" }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Editar campaña" }),
    ).toBeNull();
    expect(
      screen.getByRole("heading", { name: remainingCampaign.name }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "Publicación conservada — Aprobado" }),
    ).toBeTruthy();
    expect(campaignApi.setCampaignDraft).not.toHaveBeenCalled();
    expect(campaignApi.updateCampaign).not.toHaveBeenCalled();
    // The API fixture itself was not mutated while updating local UI state.
    expect(associatedDraft.campaign_id).toBe("campaign-1");
    expect(associatedDraft.facebook_post_id).toBe("published-post");
  });

  it("shows the empty state after deleting the last campaign", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    campaignApi.deleteCampaign.mockResolvedValue({
      message: "Campaña eliminada correctamente.",
    });
    fireEvent.click(await openDeletionForm());

    await screen.findByText(/No hay campañas todavía/);
    expect(screen.getByRole("status").textContent).toContain(
      "Campaña eliminada correctamente",
    );
    expect(screen.queryByRole("heading", { name: campaign.name })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Editar campaña" }),
    ).toBeNull();
    expect(campaignApi.deleteCampaign).toHaveBeenCalledTimes(1);
    expect(campaignApi.deleteCampaign).toHaveBeenCalledWith(
      "business-1",
      "campaign-1",
    );
  });

  it("keeps the campaign, form and association when deletion fails, then allows a retry", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(getDrafts).mockResolvedValue([associatedDraft]);
    campaignApi.deleteCampaign
      .mockRejectedValueOnce(
        new Error(
          "No se pudo eliminar la campaña. Comprueba tu conexión e inténtalo de nuevo.",
        ),
      )
      .mockResolvedValueOnce({ message: "Campaña eliminada correctamente." });
    fireEvent.click(await openDeletionForm());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("No se pudo eliminar la campaña");
    expect(
      screen.getByRole("heading", { name: "Editar campaña" }),
    ).toBeTruthy();
    expect(
      screen.getByText(campaign.name, { selector: "strong" }),
    ).toBeTruthy();
    expect((screen.getByLabelText("Nombre *") as HTMLInputElement).value).toBe(
      campaign.name,
    );
    expect(
      screen.queryByRole("option", { name: /Publicación conservada/ }),
    ).toBeNull();
    expect(screen.queryByText(/Campaña eliminada correctamente/)).toBeNull();
    expect(campaignApi.setCampaignDraft).not.toHaveBeenCalled();
    expect(campaignApi.deleteCampaign).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Eliminar campaña" }));
    await screen.findByText(/Campaña eliminada correctamente/);
    expect(campaignApi.deleteCampaign).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("waits for the server response and prevents duplicate submissions while busy", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let finishDeletion!: (value: { message: string }) => void;
    campaignApi.deleteCampaign.mockReturnValue(
      new Promise((resolve) => {
        finishDeletion = resolve;
      }),
    );
    const deleteButton = await openDeletionForm();
    fireEvent.click(deleteButton);
    fireEvent.click(deleteButton);

    expect(campaignApi.deleteCampaign).toHaveBeenCalledTimes(1);
    expect(deleteButton.closest("fieldset")?.disabled).toBe(true);
    expect(
      screen.getByText(campaign.name, { selector: "strong" }),
    ).toBeTruthy();
    expect(screen.queryByText(/Campaña eliminada correctamente/)).toBeNull();

    await act(async () => {
      finishDeletion({ message: "Campaña eliminada correctamente." });
    });
    await screen.findByText(/Campaña eliminada correctamente/);
    expect(
      screen.queryByText(campaign.name, { selector: "strong" }),
    ).toBeNull();
  });

  it("creates a campaign with trimmed text, selected status and dates", async () => {
    const input = {
      name: "Nueva campaña",
      objective: "Más visitas",
      status: "paused",
      start_date: "2026-06-01",
      end_date: "2026-06-30",
    };
    campaignApi.createCampaign.mockResolvedValue({
      ...campaign,
      ...input,
      id: "new-campaign",
    });
    render(<CampaignsPage businessId="business-1" />);
    await screen.findByRole("heading", { name: campaign.name });
    fireEvent.click(screen.getByRole("button", { name: "Nueva campaña" }));
    expect(
      (
        screen.getByRole("button", {
          name: "Guardar campaña",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Nombre *"), {
      target: { value: "  Nueva campaña  " },
    });
    fireEvent.change(screen.getByLabelText("Objetivo *"), {
      target: { value: "  Más visitas  " },
    });
    fireEvent.change(screen.getByLabelText("Estado"), {
      target: { value: "paused" },
    });
    fireEvent.change(screen.getByLabelText("Fecha inicial (opcional)"), {
      target: { value: "2026-06-01" },
    });
    fireEvent.change(screen.getByLabelText("Fecha final (opcional)"), {
      target: { value: "2026-06-30" },
    });
    expect(
      screen.getByLabelText("Fecha final (opcional)").getAttribute("min"),
    ).toBe("2026-06-01");
    fireEvent.click(screen.getByRole("button", { name: "Guardar campaña" }));
    await waitFor(() =>
      expect(campaignApi.createCampaign).toHaveBeenCalledWith(
        "business-1",
        input,
      ),
    );
    await screen.findByRole("heading", { name: "Nueva campaña" });
    expect(screen.queryByLabelText("Nombre *")).toBeNull();
    expect(campaignApi.updateCampaign).not.toHaveBeenCalled();
  });

  it("edits status and clears dates without losing the existing objective", async () => {
    const dated = {
      ...campaign,
      start_date: "2026-06-01",
      end_date: "2026-06-30",
    };
    campaignApi.getCampaigns.mockResolvedValue([dated]);
    campaignApi.updateCampaign.mockResolvedValue({
      ...dated,
      status: "archived",
      start_date: null,
      end_date: null,
    });
    await openDeletionForm();
    fireEvent.change(screen.getByLabelText("Estado"), {
      target: { value: "archived" },
    });
    fireEvent.change(screen.getByLabelText("Fecha inicial (opcional)"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Fecha final (opcional)"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar campaña" }));
    await waitFor(() =>
      expect(campaignApi.updateCampaign).toHaveBeenCalledWith(
        "business-1",
        campaign.id,
        {
          name: campaign.name,
          objective: campaign.objective,
          status: "archived",
          start_date: null,
          end_date: null,
        },
      ),
    );
    await screen.findByRole("heading", { name: campaign.name });
    expect(screen.getAllByText("Archivada").length).toBe(2);
    expect(screen.getByText("Sin fecha → Sin fecha")).toBeTruthy();
    expect(campaignApi.createCampaign).not.toHaveBeenCalled();
  });

  it("cancels an edit without saving or changing the campaign", async () => {
    await openDeletionForm();
    fireEvent.change(screen.getByLabelText("Nombre *"), {
      target: { value: "Cambio sin guardar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("heading", { name: campaign.name })).toBeTruthy();
    expect(screen.queryByLabelText("Nombre *")).toBeNull();
    expect(campaignApi.updateCampaign).not.toHaveBeenCalled();
  });

  it("associates and detaches content while displaying server progress and preserving history labels", async () => {
    const draft = { ...associatedDraft, campaign_id: null };
    vi.mocked(getDrafts).mockResolvedValue([draft]);
    const attached = {
      ...campaign,
      total_count: 1,
      published_count: 1,
      progress: 100,
      drafts: [
        {
          id: draft.id,
          title: draft.title,
          status: draft.status,
          platform: draft.platform,
          published: true,
          deleted_at: null,
        },
      ],
    };
    campaignApi.setCampaignDraft
      .mockResolvedValueOnce(attached)
      .mockResolvedValueOnce(campaign);
    render(<CampaignsPage businessId="business-1" />);
    await screen.findByRole("heading", { name: campaign.name });
    fireEvent.change(screen.getByLabelText("Asociar contenido existente"), {
      target: { value: draft.id },
    });
    fireEvent.click(screen.getByRole("button", { name: "Asociar" }));
    const detach = await screen.findByRole("button", {
      name: `Desvincular ${draft.title}`,
    });
    expect(campaignApi.setCampaignDraft).toHaveBeenNthCalledWith(
      1,
      "business-1",
      campaign.id,
      draft.id,
      true,
    );
    expect(
      screen
        .getByRole("progressbar", { name: "Progreso de publicación" })
        .getAttribute("value"),
    ).toBe("100");
    expect(
      screen
        .getByRole("progressbar", { name: `Progreso de ${campaign.name}` })
        .getAttribute("value"),
    ).toBe("100");
    expect(screen.getByText("Publicado · Aprobado")).toBeTruthy();
    expect(
      screen.queryByRole("option", { name: /Publicación conservada/ }),
    ).toBeNull();
    fireEvent.click(detach);
    await screen.findByRole("option", {
      name: "Publicación conservada — Aprobado",
    });
    expect(campaignApi.setCampaignDraft).toHaveBeenNthCalledWith(
      2,
      "business-1",
      campaign.id,
      draft.id,
      false,
    );
    expect(
      screen
        .getByRole("progressbar", { name: "Progreso de publicación" })
        .getAttribute("value"),
    ).toBe("0");
    expect(
      screen.queryByRole("button", { name: `Desvincular ${draft.title}` }),
    ).toBeNull();
  });

  it("switches campaigns and refreshes the selected campaign's progress", async () => {
    campaignApi.getCampaigns
      .mockResolvedValueOnce([campaign, remainingCampaign])
      .mockResolvedValueOnce([
        campaign,
        {
          ...remainingCampaign,
          progress: 50,
          total_count: 2,
          published_count: 1,
          pending_count: 1,
        },
      ]);
    render(<CampaignsPage businessId="business-1" />);
    const summary = await screen.findByRole("button", {
      name: /Campaña de otoño/,
    });
    fireEvent.click(summary);
    expect(
      screen.getByRole("heading", { name: remainingCampaign.name }),
    ).toBeTruthy();
    expect(summary.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
    await waitFor(() =>
      expect(
        screen
          .getByRole("progressbar", { name: "Progreso de publicación" })
          .getAttribute("value"),
      ).toBe("50"),
    );
    expect(
      screen.getByRole("heading", { name: remainingCampaign.name }),
    ).toBeTruthy();
    expect(campaignApi.getCampaigns).toHaveBeenCalledTimes(2);
    expect(getDrafts).toHaveBeenCalledTimes(2);
  });

  it("retains form values and displays a server error when saving fails", async () => {
    campaignApi.updateCampaign.mockRejectedValue(
      new Error("La fecha final no puede ser anterior a la inicial."),
    );
    await openDeletionForm();
    fireEvent.change(screen.getByLabelText("Nombre *"), {
      target: { value: "Cambio pendiente" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar campaña" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "La fecha final no puede ser anterior a la inicial.",
    );
    expect((screen.getByLabelText("Nombre *") as HTMLInputElement).value).toBe(
      "Cambio pendiente",
    );
    expect(
      screen.getByText(campaign.name, { selector: "strong" }),
    ).toBeTruthy();
  });
});

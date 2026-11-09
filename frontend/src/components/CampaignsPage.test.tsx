import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  fireEvent.click(await screen.findByRole("button", { name: "Editar campaña" }));
  return screen.getByRole("button", { name: "Eliminar campaña" });
}

describe("CampaignsPage campaign deletion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", vi.fn(() => {
      throw new Error("Unexpected network request: mock the API service.");
    }));
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
    campaignApi.deleteCampaign.mockResolvedValue({ message: "Campaña eliminada correctamente." });

    const deleteButton = await openDeletionForm();
    expect(screen.queryByRole("option", { name: /Publicación conservada/ })).toBeNull();
    fireEvent.click(deleteButton);

    await screen.findByText("Campaña eliminada correctamente. Su contenido e historial se conservaron.");
    expect(campaignApi.deleteCampaign).toHaveBeenCalledTimes(1);
    expect(campaignApi.deleteCampaign).toHaveBeenCalledWith("business-1", "campaign-1");
    expect(screen.queryByText(campaign.name, { selector: "strong" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Editar campaña" })).toBeNull();
    expect(screen.getByRole("heading", { name: remainingCampaign.name })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Publicación conservada — Aprobado" })).toBeTruthy();
    expect(campaignApi.setCampaignDraft).not.toHaveBeenCalled();
    expect(campaignApi.updateCampaign).not.toHaveBeenCalled();
    // The API fixture itself was not mutated while updating local UI state.
    expect(associatedDraft.campaign_id).toBe("campaign-1");
    expect(associatedDraft.facebook_post_id).toBe("published-post");
  });

  it("shows the empty state after deleting the last campaign", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    campaignApi.deleteCampaign.mockResolvedValue({ message: "Campaña eliminada correctamente." });
    fireEvent.click(await openDeletionForm());

    await screen.findByText(/No hay campañas todavía/);
    expect(screen.getByRole("status").textContent).toContain("Campaña eliminada correctamente");
    expect(screen.queryByRole("heading", { name: campaign.name })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Editar campaña" })).toBeNull();
    expect(campaignApi.deleteCampaign).toHaveBeenCalledTimes(1);
    expect(campaignApi.deleteCampaign).toHaveBeenCalledWith("business-1", "campaign-1");
  });

  it("keeps the campaign, form and association when deletion fails, then allows a retry", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(getDrafts).mockResolvedValue([associatedDraft]);
    campaignApi.deleteCampaign
      .mockRejectedValueOnce(new Error("No se pudo eliminar la campaña. Comprueba tu conexión e inténtalo de nuevo."))
      .mockResolvedValueOnce({ message: "Campaña eliminada correctamente." });
    fireEvent.click(await openDeletionForm());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("No se pudo eliminar la campaña");
    expect(screen.getByRole("heading", { name: "Editar campaña" })).toBeTruthy();
    expect(screen.getByText(campaign.name, { selector: "strong" })).toBeTruthy();
    expect((screen.getByLabelText("Nombre *") as HTMLInputElement).value).toBe(campaign.name);
    expect(screen.queryByRole("option", { name: /Publicación conservada/ })).toBeNull();
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
    campaignApi.deleteCampaign.mockReturnValue(new Promise((resolve) => {
      finishDeletion = resolve;
    }));
    const deleteButton = await openDeletionForm();
    fireEvent.click(deleteButton);
    fireEvent.click(deleteButton);

    expect(campaignApi.deleteCampaign).toHaveBeenCalledTimes(1);
    expect(deleteButton.closest("fieldset")?.disabled).toBe(true);
    expect(screen.getByText(campaign.name, { selector: "strong" })).toBeTruthy();
    expect(screen.queryByText(/Campaña eliminada correctamente/)).toBeNull();

    await act(async () => {
      finishDeletion({ message: "Campaña eliminada correctamente." });
    });
    await screen.findByText(/Campaña eliminada correctamente/);
    expect(screen.queryByText(campaign.name, { selector: "strong" })).toBeNull();
  });
});

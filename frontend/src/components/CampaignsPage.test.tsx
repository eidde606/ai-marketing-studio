import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CampaignsPage from "./CampaignsPage";
import type { Campaign } from "../services/campaignsApi";

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

describe("CampaignsPage campaign deletion", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    campaignApi.getCampaigns.mockResolvedValue([campaign]);
    const { getDrafts } = await import("../services/draftsApi");
    vi.mocked(getDrafts).mockResolvedValue([]);
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
});

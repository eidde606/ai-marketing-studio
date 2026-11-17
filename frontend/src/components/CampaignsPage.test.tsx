import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
    await screen.findByRole("button", { name: "Edit campaign" }),
  );
  return screen.getByRole("button", { name: "Delete campaign" });
}

async function openDeleteConfirmation() {
  fireEvent.click(await openDeletionForm());
  return screen.findByRole("dialog", { name: "Delete campaign?" });
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

  it("uses a separate outlined danger style for campaign deletion", async () => {
    const deleteButton = await openDeletionForm();
    expect(deleteButton.classList.contains("outline-button")).toBe(true);
    expect(deleteButton.classList.contains("danger-button")).toBe(false);
    expect(
      screen.getByRole("button", { name: "Save campaign" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("shows the campaign and preserves it when deletion is canceled", async () => {
    const dialog = await openDeleteConfirmation();
    expect(
      within(dialog).getByText(
        /Only the campaign "Campaña de verano" will be deleted/,
      ),
    ).toBeTruthy();
    expect(campaignApi.deleteCampaign).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      screen.getByRole("heading", { name: "Edit campaign" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Campaña de verano", { selector: "strong" }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText(/Campaign deleted/)).toBeNull();
    });
  });

  it("removes the campaign and makes its preserved content available to another campaign", async () => {
    campaignApi.getCampaigns.mockResolvedValue([campaign, remainingCampaign]);
    vi.mocked(getDrafts).mockResolvedValue([associatedDraft]);
    campaignApi.deleteCampaign.mockResolvedValue({
      message: "Campaña eliminada correctamente.",
    });

    const dialog = await openDeleteConfirmation();
    expect(
      screen.queryByRole("option", { name: /Publicación conservada/ }),
    ).toBeNull();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete campaign" }),
    );

    await screen.findByText(
      "Campaign deleted. Its content and history have been preserved.",
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
      screen.queryByRole("heading", { name: "Edit campaign" }),
    ).toBeNull();
    expect(
      screen.getByRole("heading", { name: remainingCampaign.name }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "Publicación conservada — Approved" }),
    ).toBeTruthy();
    expect(campaignApi.setCampaignDraft).not.toHaveBeenCalled();
    expect(campaignApi.updateCampaign).not.toHaveBeenCalled();
    // The API fixture itself was not mutated while updating local UI state.
    expect(associatedDraft.campaign_id).toBe("campaign-1");
    expect(associatedDraft.facebook_post_id).toBe("published-post");
  });

  it("shows the empty state after deleting the last campaign", async () => {
    campaignApi.deleteCampaign.mockResolvedValue({
      message: "Campaña eliminada correctamente.",
    });
    const dialog = await openDeleteConfirmation();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete campaign" }),
    );

    await screen.findByText(/No campaigns yet/);
    expect(screen.getByRole("status").textContent).toContain(
      "Campaign deleted",
    );
    expect(screen.queryByRole("heading", { name: campaign.name })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Edit campaign" }),
    ).toBeNull();
    expect(campaignApi.deleteCampaign).toHaveBeenCalledTimes(1);
    expect(campaignApi.deleteCampaign).toHaveBeenCalledWith(
      "business-1",
      "campaign-1",
    );
  });

  it("keeps the campaign, form and association when deletion fails, then allows a retry", async () => {
    vi.mocked(getDrafts).mockResolvedValue([associatedDraft]);
    campaignApi.deleteCampaign
      .mockRejectedValueOnce(
        new Error(
          "No se pudo eliminar la campaña. Comprueba tu conexión e inténtalo de nuevo.",
        ),
      )
      .mockResolvedValueOnce({ message: "Campaña eliminada correctamente." });
    const dialog = await openDeleteConfirmation();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete campaign" }),
    );

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("No se pudo eliminar la campaña");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Edit campaign" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("heading", { name: "Edit campaign" })).toBeTruthy();
    expect(screen.getByText(campaign.name, { selector: "strong" })).toBeTruthy();
    expect((screen.getByLabelText("Name *") as HTMLInputElement).value).toBe(
      campaign.name,
    );
    expect(
      screen.queryByRole("option", { name: /Publicación conservada/ }),
    ).toBeNull();
    expect(screen.queryByText(/Campaign deleted/)).toBeNull();
    expect(campaignApi.setCampaignDraft).not.toHaveBeenCalled();
    expect(campaignApi.deleteCampaign).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Delete campaign" }));
    const retryDialog = await screen.findByRole("dialog", {
      name: "Delete campaign?",
    });
    fireEvent.click(
      within(retryDialog).getByRole("button", { name: "Delete campaign" }),
    );
    await screen.findByText(/Campaign deleted/);
    expect(campaignApi.deleteCampaign).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("waits for the server response and prevents duplicate submissions while busy", async () => {
    let finishDeletion!: (value: { message: string }) => void;
    campaignApi.deleteCampaign.mockReturnValue(
      new Promise((resolve) => {
        finishDeletion = resolve;
      }),
    );
    const dialog = await openDeleteConfirmation();
    const deleteButton = within(dialog).getByRole("button", {
      name: "Delete campaign",
    });
    fireEvent.click(deleteButton);
    fireEvent.click(deleteButton);

    expect(campaignApi.deleteCampaign).toHaveBeenCalledTimes(1);
    expect((deleteButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      screen.getByText(campaign.name, { selector: "strong" }),
    ).toBeTruthy();
    expect(screen.queryByText(/Campaign deleted/)).toBeNull();

    await act(async () => {
      finishDeletion({ message: "Campaña eliminada correctamente." });
    });
    await screen.findByText(/Campaign deleted/);
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
    fireEvent.click(screen.getByRole("button", { name: "New campaign" }));
    expect(
      (
        screen.getByRole("button", {
          name: "Save campaign",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Name *"), {
      target: { value: "  Nueva campaña  " },
    });
    fireEvent.change(screen.getByLabelText("Objective *"), {
      target: { value: "  Más visitas  " },
    });
    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "paused" },
    });
    fireEvent.change(screen.getByLabelText("Start date (optional)"), {
      target: { value: "2026-06-01" },
    });
    fireEvent.change(screen.getByLabelText("End date (optional)"), {
      target: { value: "2026-06-30" },
    });
    expect(
      screen.getByLabelText("End date (optional)").getAttribute("min"),
    ).toBe("2026-06-01");
    fireEvent.click(screen.getByRole("button", { name: "Save campaign" }));
    await waitFor(() =>
      expect(campaignApi.createCampaign).toHaveBeenCalledWith(
        "business-1",
        input,
      ),
    );
    await screen.findByRole("heading", { name: input.name });
    expect(screen.queryByLabelText("Name *")).toBeNull();
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
    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "archived" },
    });
    fireEvent.change(screen.getByLabelText("Start date (optional)"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("End date (optional)"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save campaign" }));
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
    expect(screen.getAllByText("Archived").length).toBe(2);
    expect(screen.getByText("No date → No date")).toBeTruthy();
    expect(campaignApi.createCampaign).not.toHaveBeenCalled();
  });

  it("asks before discarding unsaved edits and leaves the form open if canceled", async () => {
    await openDeletionForm();
    fireEvent.change(screen.getByLabelText("Name *"), {
      target: { value: "Cambio sin guardar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Discard unsaved changes?",
    });
    expect(
      within(dialog).getByText(/changes to "Cambio sin guardar" will be lost/),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect((screen.getByLabelText("Name *") as HTMLInputElement).value).toBe(
      "Cambio sin guardar",
    );
    expect(campaignApi.updateCampaign).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const discardDialog = await screen.findByRole("dialog", {
      name: "Discard unsaved changes?",
    });
    fireEvent.click(
      within(discardDialog).getByRole("button", { name: "Discard changes" }),
    );
    expect(screen.getByRole("heading", { name: campaign.name })).toBeTruthy();
    expect(screen.queryByLabelText("Name *")).toBeNull();
    expect(campaignApi.updateCampaign).not.toHaveBeenCalled();
  });

  it("closes a clean edit form without a confirmation or save", async () => {
    await openDeletionForm();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: campaign.name })).toBeTruthy();
    expect(campaignApi.updateCampaign).not.toHaveBeenCalled();
  });

  it("asks before switching campaigns with unsaved edits", async () => {
    campaignApi.getCampaigns.mockResolvedValue([campaign, remainingCampaign]);
    render(<CampaignsPage businessId="business-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit campaign" }),
    );
    fireEvent.change(screen.getByLabelText("Name *"), {
      target: { value: "Unsaved campaign name" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Campaña de otoño/ }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Discard unsaved changes?",
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Discard changes" }),
    );

    expect(
      await screen.findByRole("heading", { name: remainingCampaign.name }),
    ).toBeTruthy();
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
    fireEvent.change(screen.getByLabelText("Add existing content"), {
      target: { value: draft.id },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to campaign" }));
    const detach = await screen.findByRole("button", {
      name: `Remove ${draft.title} from campaign`,
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
        .getByRole("progressbar", { name: "Publication progress" })
        .getAttribute("value"),
    ).toBe("100");
    expect(
      screen
        .getByRole("progressbar", { name: `Progress for ${campaign.name}` })
        .getAttribute("value"),
    ).toBe("100");
    expect(screen.getByText("Published · Approved")).toBeTruthy();
    expect(
      screen.queryByRole("option", { name: /Publicación conservada/ }),
    ).toBeNull();
    fireEvent.click(detach);
    await screen.findByRole("option", {
      name: "Publicación conservada — Approved",
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
        .getByRole("progressbar", { name: "Publication progress" })
        .getAttribute("value"),
    ).toBe("0");
    expect(
      screen.queryByRole("button", {
        name: `Remove ${draft.title} from campaign`,
      }),
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
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() =>
      expect(
        screen
          .getByRole("progressbar", { name: "Publication progress" })
          .getAttribute("value"),
      ).toBe("50"),
    );
    expect(
      screen.getByRole("heading", { name: remainingCampaign.name }),
    ).toBeTruthy();
    expect(campaignApi.getCampaigns).toHaveBeenCalledTimes(2);
    expect(getDrafts).toHaveBeenCalledTimes(2);
  });

  it("shows refresh progress, prevents repeated reloads, and updates selected details", async () => {
    const refreshedCampaign = {
      ...campaign,
      objective: "Objetivo actualizado",
      progress: 35,
    };
    let finishRefresh!: (items: Campaign[]) => void;
    campaignApi.getCampaigns
      .mockResolvedValueOnce([campaign])
      .mockReturnValueOnce(
        new Promise<Campaign[]>((resolve) => {
          finishRefresh = resolve;
        }),
      );
    render(<CampaignsPage businessId="business-1" />);
    await screen.findByRole("heading", { name: campaign.name });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    const refreshing = screen.getByRole("button", { name: "Refreshing…" });
    expect((refreshing as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(refreshing);
    expect(campaignApi.getCampaigns).toHaveBeenCalledTimes(2);

    await act(async () => {
      finishRefresh([refreshedCampaign]);
    });
    expect(
      screen.getByRole("heading", { name: campaign.name }),
    ).toBeTruthy();
    expect(screen.getByText("Objetivo actualizado")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
  });

  it("shows a refresh error and keeps the selected campaign visible", async () => {
    campaignApi.getCampaigns
      .mockResolvedValueOnce([campaign])
      .mockRejectedValueOnce(new Error("Refresh unavailable"));
    render(<CampaignsPage businessId="business-1" />);
    await screen.findByRole("heading", { name: campaign.name });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Refresh unavailable",
    );
    expect(screen.getByRole("heading", { name: campaign.name })).toBeTruthy();
  });

  it("retains form values and displays a server error when saving fails", async () => {
    campaignApi.updateCampaign.mockRejectedValue(
      new Error("La fecha final no puede ser anterior a la inicial."),
    );
    await openDeletionForm();
    fireEvent.change(screen.getByLabelText("Name *"), {
      target: { value: "Cambio pendiente" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save campaign" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "La fecha final no puede ser anterior a la inicial.",
    );
    expect((screen.getByLabelText("Name *") as HTMLInputElement).value).toBe(
      "Cambio pendiente",
    );
    expect(
      screen.getByText(campaign.name, { selector: "strong" }),
    ).toBeTruthy();
  });
});

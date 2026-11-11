import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Campaign } from "../services/campaignsApi";
import type { Draft } from "../services/draftsApi";
import DashboardOverview from "./DashboardOverview";

const mocks = vi.hoisted(() => ({
  getCampaigns: vi.fn(),
  getFacebookReach: vi.fn(),
}));

vi.mock("../services/campaignsApi", () => ({
  getCampaigns: mocks.getCampaigns,
}));
vi.mock("../services/draftsApi", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getFacebookReach: mocks.getFacebookReach,
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function campaign(status: Campaign["status"], id = "campaign-1") {
  return {
    id,
    business_id: "business-1",
    name: `Campaña ${id}`,
    objective: "Presentar un producto",
    status,
    start_date: null,
    end_date: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    total_count: 2,
    published_count: 1,
    pending_count: 1,
    rejected_count: 0,
    progress: 50,
    drafts: [],
  } as Campaign;
}

function draft(overrides: Partial<Draft> = {}) {
  return {
    id: "draft-1",
    business_id: "business-1",
    title: "Lanzamiento de temporada",
    caption: "Una descripción de campaña",
    platform: "Facebook",
    status: "pending",
    deleted_at: null,
    created_at: "2026-01-02T00:00:00Z",
    published_at: null,
    facebook_post_id: null,
    facebook_publish_status: "not_published",
    tiktok_publish_status: "not_published",
    ...overrides,
  } as Draft;
}

function renderDashboard(drafts: Draft[] = []) {
  return render(
    <DashboardOverview
      selectedBusinessId="business-1"
      generating={false}
      generationError={null}
      loadingDrafts={false}
      loadError={null}
      visibleDrafts={drafts}
      pendingCount={drafts.filter((item) => item.status === "pending").length}
      agents={[
        {
          name: "Sofía",
          role: "Estratega de marketing",
          state: "Disponible",
          activity: "Sin actividad registrada",
        },
      ]}
      userDisplayName="Mi cuenta"
      draftMessages={null}
      approvingIds={[]}
      busyDraftIds={[]}
      imageBusyIds={[]}
      editingId={null}
      formatDraftDate={() => "2 ene 2026"}
      handleGenerateContent={vi.fn(async () => undefined)}
      handleApprove={vi.fn(async () => undefined)}
      handleReject={vi.fn(async () => undefined)}
      startEditing={vi.fn()}
      setActiveSection={vi.fn()}
    />,
  );
}

describe("DashboardOverview", () => {
  it("uses the account name and actual campaign and publication data", async () => {
    mocks.getCampaigns.mockResolvedValue([
      campaign("active"),
      campaign("draft", "campaign-2"),
    ]);
    mocks.getFacebookReach.mockResolvedValue({ unique_media_viewers: 42 });
    const published = draft({
      id: "published-1",
      status: "approved",
      published_at: "2026-02-01T10:00:00Z",
      facebook_post_id: "post-1",
      facebook_publish_status: "published",
    });

    renderDashboard([published]);

    expect(
      await screen.findByRole("heading", { name: "Hola, Mi cuenta" }),
    ).toBeTruthy();
    expect(document.querySelector(".dashboard-kpi strong")?.textContent).toBe(
      "1",
    );
    expect(screen.getByText("Campaña campaign-1")).toBeTruthy();
    expect(
      screen.getAllByText("1 de 2 piezas publicadas · 50%"),
    ).toHaveLength(2);
    await waitFor(() => {
      expect(screen.getByText("42")).toBeTruthy();
    });
    expect(screen.getByText("Facebook · 2 ene 2026")).toBeTruthy();
  });

  it("shows meaningful empty states instead of fabricated metrics", async () => {
    mocks.getCampaigns.mockResolvedValue([]);
    renderDashboard();

    expect(await screen.findByText("Tu primera campaña empieza aquí")).toBeTruthy();
    expect(document.querySelector(".dashboard-kpi strong")?.textContent).toBe(
      "0",
    );
    expect(
      screen.getByText(
        "Las publicaciones aparecerán aquí después de confirmar su publicación.",
      ),
    ).toBeTruthy();
  });

  it("surfaces campaign loading failures without showing a fabricated count", async () => {
    mocks.getCampaigns.mockRejectedValue(new Error("offline"));
    renderDashboard();

    expect((await screen.findByRole("alert")).textContent).toContain(
      "No se pudieron cargar las campañas.",
    );
    expect(document.querySelector(".dashboard-kpi strong")?.textContent).toBe(
      "—",
    );
  });
});

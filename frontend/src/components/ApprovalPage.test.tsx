import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import ApprovalPage from "./ApprovalPage";
import type { Draft } from "../services/draftsApi";
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("../services/supabaseClient", () => ({ supabase: { auth } }));
const draft: Draft = {
  id: "draft/1",
  business_id: "business-1",
  campaign_id: "campaign-1",
  title: "Un café",
  caption: "Texto #café",
  platform: "facebook",
  status: "approved",
  source: "manual",
  created_at: "2026-01-01",
  deleted_at: null,
  published_at: null,
  publish_destinations: ["facebook"],
  facebook_post_id: null,
  facebook_publish_status: "not_published",
  tiktok_publish_id: null,
  tiktok_publish_status: "not_published",
  image_prompt: null,
  image_url: null,
  image_status: "not_started",
  media_type: "video",
  video_status: "completed",
  video_url: "stored-path",
  video_script: "Guion",
};
function props(
  overrides: Partial<ComponentProps<typeof ApprovalPage>> = {},
): ComponentProps<typeof ApprovalPage> {
  return {
    businessId: "business-1",
    visibleDrafts: [draft],
    pendingCount: 0,
    loadingDrafts: false,
    loadError: null,
    draftMessages: null,
    draftDestinations: {},
    setDraftDestinations: vi.fn(),
    approvingIds: [],
    publishingIds: [],
    busyDraftIds: [],
    deletingIds: [],
    editingId: null,
    editTitle: "",
    editCaption: "",
    setEditTitle: vi.fn(),
    setEditCaption: vi.fn(),
    setEditingId: vi.fn(),
    imageUrls: {},
    imageBusyIds: [],
    imageErrors: {},
    imageInstructions: {},
    showImageEditor: {},
    revisions: {},
    revisionBusyIds: [],
    revisionErrors: {},
    formatDraftDate: () => "1 ene 2026",
    handleApprove: vi.fn(),
    handleDelete: vi.fn(),
    handlePublishFacebook: vi.fn(),
    handlePublishTikTok: vi.fn(),
    onVerifyTikTok: vi.fn(),
    onVerifyFacebookVideo: vi.fn(),
    handleReject: vi.fn(),
    handleSaveEdit: vi.fn(),
    handleGenerateImage: vi.fn(),
    handlePreviewImage: vi.fn(),
    handleCreateRevision: vi.fn(),
    handleDecideRevision: vi.fn(),
    refreshRevision: vi.fn(),
    addImageSuggestion: vi.fn(),
    updateImageInstructions: vi.fn(),
    toggleImageEditor: vi.fn(),
    startEditing: vi.fn(),
    ...overrides,
  };
}
beforeEach(() => {
  auth.getSession.mockResolvedValue({
    data: { session: { access_token: "token" } },
    error: null,
  });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it.each([
  ["text", null, "¿Publicar este texto en Facebook?"],
  [
    "image",
    "stored-image",
    "¿Publicar esta imagen y su descripción en Facebook?",
  ],
  [
    "video",
    null,
    "¿Enviar este video y su descripción a Facebook? Puede tardar en procesarse.",
  ],
] as const)(
  "preserves %s publishing confirmation and cancellation",
  (media_type, image_url, message) => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const p = props({ visibleDrafts: [{ ...draft, media_type, image_url }] });
    render(<ApprovalPage {...p} />);
    fireEvent.click(screen.getByText("Publicar en Facebook"));
    expect(confirm).toHaveBeenCalledWith(message);
    expect(p.handlePublishFacebook).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByText("Publicar en Facebook"));
    expect(p.handlePublishFacebook).toHaveBeenCalledWith(draft.id);
    expect(fetch).not.toHaveBeenCalled();
  },
);
it("disables pending publication and retains verification-only UI", () => {
  const p = props({ publishingIds: [draft.id] });
  const view = render(<ApprovalPage {...p} />);
  expect(
    (screen.getByText("Publicando...") as HTMLButtonElement).disabled,
  ).toBe(true);
  view.rerender(
    <ApprovalPage
      {...p}
      publishingIds={[]}
      visibleDrafts={[
        {
          ...draft,
          facebook_publish_status: "needs_review",
          facebook_post_id: "post",
        },
      ]}
    />,
  );
  expect(screen.queryByText("Publicar en Facebook")).toBeNull();
  fireEvent.click(screen.getByText("Verificar publicación en Facebook"));
  expect(p.onVerifyFacebookVideo).toHaveBeenCalledWith(draft.id);
});
it("shows empty/loading/error states without displaying obsolete drafts", () => {
  const view = render(<ApprovalPage {...props({ visibleDrafts: [] })} />);
  expect(
    screen.getByText("Todavía no hay borradores para revisar."),
  ).toBeTruthy();
  view.rerender(
    <ApprovalPage
      {...props({
        loadingDrafts: true,
        draftMessages: <p role="status">Cargando borradores...</p>,
      })}
    />,
  );
  expect(screen.queryByText(draft.title)).toBeNull();
  expect(screen.getByText("— pendientes")).toBeTruthy();
  view.rerender(
    <ApprovalPage
      {...props({
        loadError: "Error",
        draftMessages: <p role="alert">Error</p>,
      })}
    />,
  );
  expect(screen.getByRole("alert").textContent).toBe("Error");
  expect(screen.queryByText(draft.title)).toBeNull();
});
it("previews and closes video using the authenticated preview endpoint", async () => {
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => ({ video_url: "https://example.test/signed.mp4" }),
  } as Response);
  const view = render(<ApprovalPage {...props()} />);
  fireEvent.click(screen.getByText("🎬 Ver video"));
  await screen.findByText("Cerrar video");
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/drafts/draft%2F1/video-preview"),
    { headers: { Authorization: "Bearer token" } },
  );
  expect(view.container.querySelector("video")?.getAttribute("src")).toBe(
    "https://example.test/signed.mp4",
  );
  expect(view.container.querySelector("video")?.classList.contains(
    "approval-video-player",
  )).toBe(true);
  expect((view.container.querySelector("video") as HTMLVideoElement).controls).toBe(
    true,
  );
  fireEvent.click(screen.getByText("Cerrar video"));
  expect(view.container.querySelector("video")).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("keeps approval information, media, scripts, platform and actions in separate regions", () => {
  const p = props({
    visibleDrafts: [
      {
        ...draft,
        status: "pending",
        video_script: "Guion largo ".repeat(80),
      },
    ],
  });
  const { container } = render(<ApprovalPage {...p} />);
  const card = container.querySelector(".approval-card");
  expect(card).toBeTruthy();

  const regions = Array.from(card!.children);
  expect(regions.map((region) => region.className)).toEqual([
    "approval-card-top",
    "approval-card-information",
    "draft-image-section",
    "approval-card-caption",
    "approval-card-controls",
  ]);
  expect(
    container.querySelector(".approval-card-caption")?.textContent,
  ).toContain(draft.caption);
  expect(
    container.querySelector(".approval-card-controls .approval-platform-selection"),
  ).toBeTruthy();
  expect(
    container.querySelector(".approval-card-controls .approval-card-decisions"),
  ).toBeTruthy();
  expect(
    container.querySelector(".approval-card-controls .approval-card-secondary"),
  ).toBeTruthy();
  expect(container.querySelector(".heygen-script-text")?.textContent).toBe(
    "Guion largo ".repeat(80),
  );
});
it("shows preview failure without retrying", async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);
  render(<ApprovalPage {...props()} />);
  fireEvent.click(screen.getByText("🎬 Ver video"));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "No se pudo cargar el video (503).",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("downloads a blob, removes the anchor and revokes its URL after 60 seconds", async () => {
  vi.useFakeTimers();
  const blob = new Blob(["video"], { type: "video/mp4" });
  const create = vi.fn(() => "blob:test-video");
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  let downloaded = "";
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloaded = this.download;
  });
  vi.mocked(fetch)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ video_url: "https://example.test/video" }),
    } as Response)
    .mockResolvedValueOnce({ ok: true, blob: async () => blob } as Response);
  render(<ApprovalPage {...props()} />);
  await act(async () =>
    fireEvent.click(screen.getByText("⬇ Descargar video para TikTok")),
  );
  expect(fetch).toHaveBeenNthCalledWith(2, "https://example.test/video");
  expect(create).toHaveBeenCalledWith(blob);
  expect(downloaded).toBe("tiktok-draft/1.mp4");
  expect(document.querySelector('a[href="blob:test-video"]')).toBeNull();
  expect(revoke).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(60000));
  expect(revoke).toHaveBeenCalledWith("blob:test-video");
});
it("blocks unauthenticated downloads and reports the original Spanish error", async () => {
  auth.getSession.mockResolvedValue({ data: { session: null } });
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
  render(<ApprovalPage {...props()} />);
  await act(async () =>
    fireEvent.click(screen.getByText("⬇ Descargar video para TikTok")),
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith("Debes iniciar sesión.");
});
it("preserves the known late-video-preview behavior across business prop changes", async () => {
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const p = props();
  const view = render(<ApprovalPage {...p} />);
  fireEvent.click(screen.getByText("🎬 Ver video"));
  await act(async () => {});
  view.rerender(
    <ApprovalPage {...p} businessId="business-2" visibleDrafts={[]} />,
  );
  await act(async () =>
    finish({
      ok: true,
      json: async () => ({ video_url: "https://example.test/late" }),
    } as Response),
  );
  view.rerender(<ApprovalPage {...p} />);
  expect(view.container.querySelector("video")?.getAttribute("src")).toBe(
    "https://example.test/late",
  );
});

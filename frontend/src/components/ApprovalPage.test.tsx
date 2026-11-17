import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
    canApprove: true,
    canPublish: true,
    facebookPublisher: "Test Page",
    instagramPublisher: null,
    publisherStatusLoading: false,
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
    handlePublishInstagram: vi.fn(),
    handlePublishTikTok: vi.fn(),
    onVerifyTikTok: vi.fn(),
    onVerifyFacebookVideo: vi.fn(),
    handleReject: vi.fn(),
    handleSaveEdit: vi.fn(),
    handleGenerateImage: vi.fn(),
    handleUploadImage: vi.fn().mockResolvedValue(true),
    handleReuseImage: vi.fn().mockResolvedValue(true),
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
function pendingImageDraft(
  image_url: string | null,
  image_status: Draft["image_status"] = "completed",
): Draft {
  return {
    ...draft,
    status: "pending",
    media_type: "image",
    image_status,
    image_url,
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
  ["text", null, "Publish this text to Facebook?"],
  ["image", "stored-image", "Publish this image and its caption to Facebook?"],
  [
    "video",
    null,
    "Send this video and its caption to Facebook? Processing may take a few minutes.",
  ],
] as const)(
  "preserves %s publishing confirmation and cancellation",
  (media_type, image_url, message) => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const p = props({ visibleDrafts: [{ ...draft, media_type, image_url }] });
    render(<ApprovalPage {...p} />);
    fireEvent.click(screen.getByText("Publish to Facebook"));
    expect(confirm).toHaveBeenCalledWith(message);
    expect(p.handlePublishFacebook).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByText("Publish to Facebook"));
    expect(p.handlePublishFacebook).toHaveBeenCalledWith(draft.id);
    expect(fetch).not.toHaveBeenCalled();
  },
);
it("disables pending publication and retains verification-only UI", () => {
  const p = props({ publishingIds: [draft.id] });
  const view = render(<ApprovalPage {...p} />);
  expect((screen.getByText("Publishing…") as HTMLButtonElement).disabled).toBe(
    true,
  );
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
  expect(screen.queryByText("Publish to Facebook")).toBeNull();
  fireEvent.click(screen.getByText("Verify Facebook post"));
  expect(p.onVerifyFacebookVideo).toHaveBeenCalledWith(draft.id);
});
it("requires confirmation for an approved Instagram image and shows its published link", () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const instagramDraft: Draft = {
    ...draft,
    media_type: "image",
    image_status: "completed",
    image_url: "approved-image.jpeg",
    publish_destinations: ["instagram"],
  };
  const p = props({
    visibleDrafts: [instagramDraft],
    instagramPublisher: "nazborttech",
  });
  const view = render(<ApprovalPage {...p} />);
  fireEvent.click(screen.getByText("Publish to Instagram"));
  expect(confirm).toHaveBeenCalledWith(
    "Publish this approved JPEG image and caption to the connected Instagram account?",
  );
  expect(p.handlePublishInstagram).not.toHaveBeenCalled();

  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByText("Publish to Instagram"));
  expect(p.handlePublishInstagram).toHaveBeenCalledWith(instagramDraft.id);

  view.rerender(
    <ApprovalPage
      {...p}
      visibleDrafts={[
        {
          ...instagramDraft,
          instagram_publish_status: "published",
          instagram_permalink: "https://www.instagram.com/p/example/",
        },
      ]}
    />,
  );
  const link = screen.getByText("View Instagram post") as HTMLAnchorElement;
  expect(link.href).toBe("https://www.instagram.com/p/example/");
  expect(link.target).toBe("_blank");
});
it("does not offer an Instagram publish action for unsupported media or ambiguous results", () => {
  const p = props({
    instagramPublisher: "nazborttech",
    visibleDrafts: [
      {
        ...draft,
        media_type: "video",
        publish_destinations: ["instagram"],
      },
    ],
  });
  const view = render(<ApprovalPage {...p} />);
  expect(screen.queryByText("Publish to Instagram")).toBeNull();
  view.rerender(
    <ApprovalPage
      {...p}
      visibleDrafts={[
        {
          ...draft,
          media_type: "image",
          image_status: "completed",
          image_url: "approved-image.jpg",
          publish_destinations: ["instagram"],
          instagram_publish_status: "needs_review",
        },
      ]}
    />,
  );
  expect(screen.queryByText("Retry Instagram")).toBeNull();
  expect(
    screen.getByText(
      "Instagram may have published this post. Check the account before taking further action.",
    ),
  ).toBeTruthy();
});
it.each([".jpg", ".jpeg"])(
  "enables Instagram selection for completed JPEG images (%s)",
  (extension) => {
    render(
      <ApprovalPage
        {...props({
          visibleDrafts: [
            pendingImageDraft(`businesses/example/image${extension}`),
          ],
          instagramPublisher: "nazborttech",
        })}
      />,
    );
    expect(
      (
        screen.getByRole("checkbox", {
          name: /Instagram/,
        }) as HTMLInputElement
      ).disabled,
    ).toBe(false);
    expect(
      screen.getByText(
        "Instagram supports completed JPEG images up to 8 MB and captions up to 2,200 characters.",
      ),
    ).toBeTruthy();
  },
);
it.each([
  [".png", "This image is .png; Instagram requires a JPEG (.jpg or .jpeg)."],
  [".webp", "This image is .webp; Instagram requires a JPEG (.jpg or .jpeg)."],
])(
  "keeps Instagram selection disabled for unsupported image formats (%s)",
  (extension, reason) => {
    render(
      <ApprovalPage
        {...props({
          visibleDrafts: [
            pendingImageDraft(`businesses/example/image${extension}`),
          ],
          instagramPublisher: "nazborttech",
        })}
      />,
    );
    expect(
      (
        screen.getByRole("checkbox", {
          name: /Instagram/,
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByRole("status").textContent).toBe(reason);
  },
);
it("explains missing image files and incomplete image generation", () => {
  const view = render(
    <ApprovalPage
      {...props({
        visibleDrafts: [pendingImageDraft(null)],
        instagramPublisher: "nazborttech",
      })}
    />,
  );
  expect(
    (
      screen.getByRole("checkbox", {
        name: /Instagram/,
      }) as HTMLInputElement
    ).disabled,
  ).toBe(true);
  expect(
    screen.getByText(
      "The completed image file is missing. Generate or attach an image first.",
    ),
  ).toBeTruthy();

  view.rerender(
    <ApprovalPage
      {...props({
        visibleDrafts: [pendingImageDraft(null, "not_started")],
        instagramPublisher: "nazborttech",
      })}
    />,
  );
  expect(
    screen.getByText(
      "Image generation has not started. Generate an image before selecting Instagram.",
    ),
  ).toBeTruthy();
  expect(
    (
      screen.getByRole("checkbox", {
        name: /Instagram/,
      }) as HTMLInputElement
    ).disabled,
  ).toBe(true);
});
it("explains when a text draft cannot be selected for Instagram", () => {
  render(
    <ApprovalPage
      {...props({
        visibleDrafts: [{ ...draft, status: "pending", media_type: "text" }],
        instagramPublisher: "nazborttech",
      })}
    />,
  );
  expect(
    (
      screen.getByRole("checkbox", {
        name: /Instagram/,
      }) as HTMLInputElement
    ).disabled,
  ).toBe(true);
  expect(
    screen.getByText(
      "This is a text draft. Instagram publishing requires an image draft.",
    ),
  ).toBeTruthy();
});
it("offers an authenticated upload for a pending image-free draft", async () => {
  const pending = {
    ...draft,
    status: "pending",
    media_type: "text" as const,
    image_status: "not_started" as const,
    video_status: "not_started" as const,
    video_url: null,
  };
  const p = props({ visibleDrafts: [pending] });
  render(<ApprovalPage {...p} />);
  fireEvent.click(screen.getByText("Upload an image"));
  const file = new File(["image bytes"], "customer.png", {
    type: "image/png",
  });
  fireEvent.change(document.querySelector('input[type="file"]')!, {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByText("Upload image"));
  await act(async () => {});
  expect(p.handleUploadImage).toHaveBeenCalledWith(pending, file);
});
it("keeps image media actions on approval cards and does not change video drafts", () => {
  const imageDraft: Draft = {
    ...draft,
    id: "image-draft",
    status: "pending",
    source: "ai",
    media_type: "image",
    image_prompt: "A welcoming cafe",
    image_url: null,
    image_status: "not_started",
    video_status: "not_started",
    video_url: null,
    video_script: null,
  };
  render(<ApprovalPage {...props({ visibleDrafts: [imageDraft, draft] })} />);

  expect(screen.getByText("✦ Generate image")).toBeTruthy();
  expect(screen.getByText("Upload an image")).toBeTruthy();
  expect(screen.getByText("Choose an existing image")).toBeTruthy();
  expect(screen.getByText("Guion")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Create Image Post" }),
  ).toBeNull();
});
it("offers tenant-scoped existing images for a pending image-free draft", async () => {
  const pending = {
    ...draft,
    status: "pending",
    media_type: "text" as const,
    image_status: "not_started" as const,
    video_status: "not_started" as const,
    video_url: null,
  };
  const p = props({ visibleDrafts: [pending] });
  vi.mocked(fetch).mockResolvedValue(
    new Response(
      JSON.stringify([
        {
          draft_id: "source-1",
          title: "Earlier image",
          image_url: "https://storage.example.com/source.jpg",
        },
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
  render(<ApprovalPage {...p} />);
  fireEvent.click(screen.getByText("Choose an existing image"));
  fireEvent.click(await screen.findByText("Use this image"));
  await waitFor(() => {
    expect(p.handleReuseImage).toHaveBeenCalledWith(pending, "source-1");
  });
});
it("keeps member review available without approval, rejection, or publishing controls", () => {
  const pending = { ...draft, status: "pending" as const };
  const view = render(
    <ApprovalPage
      {...props({
        canApprove: false,
        canPublish: false,
        visibleDrafts: [pending],
      })}
    />,
  );
  expect(screen.queryByText("✓ Approve")).toBeNull();
  expect(screen.queryByText("Reject")).toBeNull();
  expect(
    view.container.querySelector(".approval-platform-selection"),
  ).toBeNull();
  expect(screen.getByText("Edit")).toBeTruthy();

  view.rerender(
    <ApprovalPage
      {...props({
        canApprove: false,
        canPublish: false,
        visibleDrafts: [draft],
      })}
    />,
  );
  expect(screen.queryByText("Publish to Facebook")).toBeNull();
  expect(screen.getByText("⬇ Download video for TikTok")).toBeTruthy();
});
it("shows empty/loading/error states without displaying obsolete drafts", () => {
  const view = render(<ApprovalPage {...props({ visibleDrafts: [] })} />);
  expect(screen.getByText("There are no drafts to review yet.")).toBeTruthy();
  view.rerender(
    <ApprovalPage
      {...props({
        loadingDrafts: true,
        draftMessages: <p role="status">Cargando borradores...</p>,
      })}
    />,
  );
  expect(screen.queryByText(draft.title)).toBeNull();
  expect(screen.getByText("—")).toBeTruthy();
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
  fireEvent.click(screen.getByText("🎬 Preview video"));
  await screen.findByText("Close video");
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/drafts/draft%2F1/video-preview"),
    { headers: { Authorization: "Bearer token" } },
  );
  expect(view.container.querySelector("video")?.getAttribute("src")).toBe(
    "https://example.test/signed.mp4",
  );
  expect(
    view.container
      .querySelector("video")
      ?.classList.contains("approval-video-player"),
  ).toBe(true);
  expect(
    (view.container.querySelector("video") as HTMLVideoElement).controls,
  ).toBe(true);
  fireEvent.click(screen.getByText("Close video"));
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
    container.querySelector(
      ".approval-card-controls .approval-platform-selection",
    ),
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
  fireEvent.click(screen.getByText("🎬 Preview video"));
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
    fireEvent.click(screen.getByText("⬇ Download video for TikTok")),
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
    fireEvent.click(screen.getByText("⬇ Download video for TikTok")),
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
  fireEvent.click(screen.getByText("🎬 Preview video"));
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

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Draft } from "../services/draftsApi";
import ContentPage from "./ContentPage";

const mocks = vi.hoisted(() => ({
  getDraftImage: vi.fn(),
  getFacebookAnalytics: vi.fn(),
  fetchVideoPreview: vi.fn(),
}));

vi.mock("../services/draftsApi", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDraftImage: mocks.getDraftImage,
  getFacebookAnalytics: mocks.getFacebookAnalytics,
}));
vi.mock("../features/media/services/videoApi", () => ({
  fetchVideoPreview: mocks.fetchVideoPreview,
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function draft(overrides: Partial<Draft> = {}) {
  return {
    id: "draft-1",
    title: "Lanzamiento de producto",
    caption: "Presentamos nuestra nueva colección",
    platform: "Facebook",
    status: "pending",
    facebook_publish_status: "not_published",
    tiktok_publish_status: "not_published",
    facebook_post_id: null,
    deleted_at: null,
    source: "ai",
    media_type: "image",
    image_url: "private-image-path",
    image_status: "completed",
    video_url: null,
    ...overrides,
  } as Draft;
}

describe("ContentPage", () => {
  it("searches and filters the loaded library without changing server data", () => {
    render(
      <ContentPage
        drafts={[
          draft(),
          draft({
            id: "draft-2",
            title: "Texto para el equipo",
            caption: "Un mensaje interno sin coincidencias",
            media_type: "text",
            image_url: null,
            status: "approved",
          }),
          draft({
            id: "draft-deleted",
            title: "Contenido eliminado",
            deleted_at: "2026-01-01",
          }),
        ]}
        loading={false}
        error={null}
      />,
    );

    expect(screen.getByText("Lanzamiento de producto")).toBeTruthy();
    expect(screen.getByText("Texto para el equipo")).toBeTruthy();
    expect(screen.queryByText("Contenido eliminado")).toBeNull();
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search content" }),
      { target: { value: "colección" } },
    );
    expect(screen.getByText("Lanzamiento de producto")).toBeTruthy();
    expect(screen.queryByText("Texto para el equipo")).toBeNull();
    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "approved" },
    });
    expect(screen.getByText("No results found")).toBeTruthy();
  });

  it("loads private image previews only after explicit selection", async () => {
    mocks.getDraftImage.mockResolvedValue({ image_url: "https://private.test/image" });
    render(<ContentPage drafts={[draft()]} loading={false} error={null} />);

    fireEvent.click(screen.getByRole("button", { name: "View preview" }));

    expect(mocks.getDraftImage).toHaveBeenCalledWith("draft-1");
    expect(
      await screen.findByRole("img", { name: "Preview of Lanzamiento de producto" }),
    ).toHaveProperty("src", "https://private.test/image");
  });

  it("uses the private video-preview route and surfaces preview errors", async () => {
    mocks.fetchVideoPreview.mockRejectedValue(new Error("No disponible"));
    render(
      <ContentPage
        drafts={[
          draft({
            media_type: "video",
            video_url: "private-video-path",
            image_url: null,
          }),
        ]}
        loading={false}
        error={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View preview" }));
    await waitFor(() => {
      expect(mocks.fetchVideoPreview).toHaveBeenCalledWith("draft-1");
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "No disponible",
    );
  });

  it("keeps the signed portrait-video source and native playback controls intact", async () => {
    mocks.fetchVideoPreview.mockResolvedValue({
      video_url: "https://private.test/portrait-original.mp4",
    });
    render(
      <ContentPage
        drafts={[
          draft({
            media_type: "video",
            video_url: "private-video-path",
            image_url: null,
          }),
        ]}
        loading={false}
        error={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View preview" }));

    const video = await screen.findByLabelText(
      "Preview of Lanzamiento de producto",
    );
    expect(video.tagName).toBe("VIDEO");
    expect((video as HTMLVideoElement).src).toBe(
      "https://private.test/portrait-original.mp4",
    );
    expect((video as HTMLVideoElement).controls).toBe(true);
    expect((video as HTMLVideoElement).playsInline).toBe(true);
    expect(video.parentElement?.classList.contains("content-library-card__media")).toBe(
      true,
    );
  });
});

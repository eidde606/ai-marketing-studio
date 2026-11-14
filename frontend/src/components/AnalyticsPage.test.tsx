import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Draft } from "../services/draftsApi";
import AnalyticsPage from "./AnalyticsPage";

const mocks = vi.hoisted(() => ({
  getFacebookAnalytics: vi.fn(),
}));

vi.mock("../services/draftsApi", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getFacebookAnalytics: mocks.getFacebookAnalytics,
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function draft(overrides: Partial<Draft> = {}) {
  return {
    id: "draft-1",
    title: "Lanzamiento de temporada",
    status: "approved",
    facebook_publish_status: "published",
    facebook_post_id: "post-1",
    deleted_at: null,
    ...overrides,
  } as Draft;
}

describe("AnalyticsPage", () => {
  it("shows only returned Facebook metrics and explains their source", async () => {
    mocks.getFacebookAnalytics.mockResolvedValue({
      draft_id: "draft-1",
      platform: "Facebook",
      reactions: 12,
      comments: 3,
      shares: 2,
      permalink_url: "https://facebook.test/post",
    });

    render(
      <AnalyticsPage drafts={[draft()]} loading={false} error={null} />,
    );

    expect(await screen.findByText("12")).toBeTruthy();
    expect(screen.getByText("3 comments")).toBeTruthy();
    expect(screen.getByText("2 shares")).toBeTruthy();
    expect(
      screen.getByText(/TikTok trends and metrics are not available/),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "View post" })).toHaveProperty(
      "href",
      "https://facebook.test/post",
    );
  });

  it("shows a real empty state without fabricating engagement totals", async () => {
    render(<AnalyticsPage drafts={[]} loading={false} error={null} />);

    expect(
      await screen.findByText("No Facebook posts yet"),
    ).toBeTruthy();
    expect(screen.getAllByText("—")).toHaveLength(3);
  });

  it("explains when Facebook metrics are inaccessible", async () => {
    mocks.getFacebookAnalytics.mockRejectedValue(new Error("forbidden"));

    render(
      <AnalyticsPage
        drafts={[draft()]}
        loading={false}
        error={null}
      />,
    );

    expect(
      await screen.findByText(/post has no available metrics/),
    ).toBeTruthy();
    expect(screen.getByText("No metrics available")).toBeTruthy();
  });
});

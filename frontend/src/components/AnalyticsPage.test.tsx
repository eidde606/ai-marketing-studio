import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Draft } from "../services/draftsApi";
import type { EdianAnalysis } from "../services/edianAnalyticsApi";
import AnalyticsPage from "./AnalyticsPage";
import { LocalizationProvider } from "../app/localization";
import { useLocalization } from "../app/useLocalization";
import { ApiError } from "../lib/apiClient";

const mocks = vi.hoisted(() => ({
  getFacebookAnalytics: vi.fn(),
  analyzeWithEdian: vi.fn(),
}));

vi.mock("../services/draftsApi", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getFacebookAnalytics: mocks.getFacebookAnalytics,
}));
vi.mock("../services/edianAnalyticsApi", () => ({
  analyzeWithEdian: mocks.analyzeWithEdian,
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

function LocaleToggle() {
  const { setInterfaceLanguage } = useLocalization();
  return (
    <button type="button" onClick={() => void setInterfaceLanguage("es")}>
      Use Spanish
    </button>
  );
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
      <AnalyticsPage
        businessId="business-1"
        drafts={[draft()]}
        loading={false}
        error={null}
      />,
    );

    expect(await screen.findByText("12")).toBeTruthy();
    expect(screen.getByText("3 comments")).toBeTruthy();
    expect(screen.getByText("2 shares")).toBeTruthy();
    expect(
      screen.getByText(/Instagram and TikTok analytics are not available/),
    ).toBeTruthy();
    expect(mocks.analyzeWithEdian).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "View post" })).toHaveProperty(
      "href",
      "https://facebook.test/post",
    );
  });

  it("shows a real empty state without fabricating engagement totals", async () => {
    render(
      <AnalyticsPage
        businessId="business-1"
        drafts={[]}
        loading={false}
        error={null}
      />,
    );

    expect(await screen.findByText("No Facebook posts yet")).toBeTruthy();
    expect(screen.getAllByText("—")).toHaveLength(3);
  });

  it("explains when Facebook metrics are inaccessible", async () => {
    mocks.getFacebookAnalytics.mockRejectedValue(new Error("forbidden"));

    render(
      <AnalyticsPage
        businessId="business-1"
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

  it("only requests Edian analysis after the customer explicitly asks", async () => {
    const onDiscussWithSebastian = vi.fn();
    mocks.getFacebookAnalytics.mockResolvedValue({
      draft_id: "draft-1",
      platform: "facebook",
      reactions: 12,
      comments: 3,
      shares: 2,
      permalink_url: null,
    });
    mocks.analyzeWithEdian.mockResolvedValue({
      status: "ready",
      locale: "en",
      source: "Facebook",
      posts_analyzed: 1,
      observed: {
        platform: "Facebook",
        posts_analyzed: 1,
        posts_with_any_data: 1,
        metrics: {
          reactions: { total: 12, posts_with_data: 1 },
          comments: { total: 3, posts_with_data: 1 },
          shares: { total: 2, posts_with_data: 1 },
        },
      },
      interpretation: {
        summary: "The post received 12 reactions.",
        recommendations: ["Test a different posting time."],
      },
      reused: false,
    });
    render(
      <AnalyticsPage
        businessId="business-1"
        drafts={[draft()]}
        loading={false}
        error={null}
        onDiscussWithSebastian={onDiscussWithSebastian}
      />,
    );
    expect(await screen.findByText("12")).toBeTruthy();
    expect(mocks.analyzeWithEdian).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Analyze with Edian" }));

    expect(
      await screen.findByText("The post received 12 reactions."),
    ).toBeTruthy();
    expect(screen.getByText("Edian recommendations")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Turn insights into action" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Bring these observed results to Sebastián and decide what to do next.",
      ),
    ).toBeTruthy();
    expect(screen.getAllByText("Available for 1 of 1 posts")).toHaveLength(3);
    fireEvent.click(
      screen.getByRole("button", { name: "Discuss with Sebastián" }),
    );
    const handoff = onDiscussWithSebastian.mock.calls[0][0] as string;
    expect(handoff).toContain(
      "Please review these Facebook metrics for this business.",
    );
    expect(handoff).toContain("- Reactions: 12 (Available for 1 of 1 posts)");
    expect(handoff).toContain("Edian's observed summary");
    expect(handoff).toContain("Test a different posting time.");
    expect(handoff).not.toContain("business-1");
    expect(mocks.analyzeWithEdian).toHaveBeenCalledTimes(1);
    expect(mocks.analyzeWithEdian).toHaveBeenCalledWith(
      "business-1",
      "en",
      expect.any(String),
    );
  });

  it("sends the selected Spanish locale to Edian and presents localized controls", async () => {
    const onDiscussWithSebastian = vi.fn();
    mocks.getFacebookAnalytics.mockResolvedValue({
      draft_id: "draft-1",
      platform: "facebook",
      reactions: 1,
      comments: null,
      shares: null,
      permalink_url: null,
    });
    mocks.analyzeWithEdian.mockResolvedValue({
      status: "ready",
      locale: "es",
      source: "Facebook",
      posts_analyzed: 1,
      observed: {
        platform: "Facebook",
        posts_analyzed: 1,
        posts_with_any_data: 1,
        metrics: {
          reactions: { total: 1, posts_with_data: 1 },
          comments: { total: 0, posts_with_data: 1 },
          shares: { total: 0, posts_with_data: 1 },
        },
      },
      interpretation: {
        summary: "La publicación recibió una reacción.",
        recommendations: ["Prueba otro horario de publicación."],
      },
      reused: false,
    });
    render(
      <LocalizationProvider userId={null}>
        <LocaleToggle />
        <AnalyticsPage
          businessId="business-1"
          drafts={[draft()]}
          loading={false}
          error={null}
          onDiscussWithSebastian={onDiscussWithSebastian}
        />
      </LocalizationProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use Spanish" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Analizar con Edian" }),
    );

    expect(
      await screen.findByText("La publicación recibió una reacción."),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "Convierte los hallazgos en acciones",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Comparte estos resultados observados con Sebastián y decide qué hacer después.",
      ),
    ).toBeTruthy();
    expect(
      screen.getAllByText("Disponible en 1 de 1 publicaciones"),
    ).toHaveLength(3);
    fireEvent.click(
      screen.getByRole("button", { name: "Conversar con Sebastián" }),
    );
    const handoff = onDiscussWithSebastian.mock.calls[0][0] as string;
    expect(handoff).toContain(
      "Revisa estas métricas de Facebook de este negocio.",
    );
    expect(handoff).toContain(
      "- Reacciones: 1 (Disponible en 1 de 1 publicaciones)",
    );
    expect(handoff).toContain("¿Qué siguiente paso recomendarías");
    expect(handoff).not.toContain("business-1");
    expect(mocks.analyzeWithEdian).toHaveBeenCalledWith(
      "business-1",
      "es",
      expect.any(String),
    );
  });

  it("keeps unavailable metrics distinct from a measured zero", async () => {
    mocks.getFacebookAnalytics.mockResolvedValue({
      draft_id: "draft-1",
      platform: "facebook",
      reactions: null,
      comments: 0,
      shares: null,
      permalink_url: null,
    });
    render(
      <AnalyticsPage
        businessId="business-1"
        drafts={[draft()]}
        loading={false}
        error={null}
      />,
    );
    await screen.findByText("0");
    const reactionsCard = screen.getByText("Reactions").parentElement;
    const commentsCard = screen.getByText("Comments").parentElement;
    expect(reactionsCard?.querySelector("strong")?.textContent).toBe("—");
    expect(commentsCard?.querySelector("strong")?.textContent).toBe("0");
  });

  it("explains missing Facebook permissions in Spanish", async () => {
    mocks.getFacebookAnalytics.mockResolvedValue({
      draft_id: "draft-1",
      platform: "facebook",
      reactions: null,
      comments: 2,
      shares: null,
      permalink_url: null,
      post_status: "available",
      authorization_status: "permission_required",
      metric_status: {
        reactions: "permission_required",
        comments: "available",
        shares: "unavailable",
      },
    });
    render(
      <LocalizationProvider userId={null}>
        <LocaleToggle />
        <AnalyticsPage
          businessId="business-1"
          drafts={[draft()]}
          loading={false}
          error={null}
        />
      </LocalizationProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Use Spanish" }));

    expect(
      await screen.findByText(/Facebook no tiene permiso para leer/),
    ).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(mocks.analyzeWithEdian).not.toHaveBeenCalled();
  });

  it("distinguishes expired Facebook authorization from unavailable data", async () => {
    mocks.getFacebookAnalytics.mockResolvedValue({
      draft_id: "draft-1",
      platform: "facebook",
      reactions: null,
      comments: null,
      shares: null,
      permalink_url: null,
      post_status: "available",
      authorization_status: "reauthorization_required",
      metric_status: {
        reactions: "unavailable",
        comments: "unavailable",
        shares: "unavailable",
      },
    });
    render(
      <AnalyticsPage
        businessId="business-1"
        drafts={[draft()]}
        loading={false}
        error={null}
      />,
    );

    expect(await screen.findByText(/authorization has expired/i)).toBeTruthy();
  });

  it("shows a retryable provider message and refreshes metrics on demand", async () => {
    mocks.getFacebookAnalytics.mockRejectedValue(
      new ApiError("provider failure", 502, "facebook_provider_error"),
    );
    render(
      <AnalyticsPage
        businessId="business-1"
        drafts={[draft()]}
        loading={false}
        error={null}
      />,
    );

    expect(
      await screen.findByText(/Facebook could not provide metrics right now/),
    ).toBeTruthy();
    expect(mocks.getFacebookAnalytics).toHaveBeenCalledTimes(1);
    mocks.getFacebookAnalytics.mockResolvedValue({
      draft_id: "draft-1",
      platform: "facebook",
      reactions: 2,
      comments: 0,
      shares: 0,
      permalink_url: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh metrics" }));

    const reactionsLabel = await screen.findByText("Reactions");
    await waitFor(() => {
      expect(
        reactionsLabel.parentElement?.querySelector("strong")?.textContent,
      ).toBe("2");
    });
    expect(mocks.getFacebookAnalytics).toHaveBeenCalledTimes(2);
  });

  it("does not label a Facebook response with missing metrics as data", async () => {
    mocks.getFacebookAnalytics.mockResolvedValue({
      draft_id: "draft-1",
      platform: "facebook",
      reactions: null,
      comments: null,
      shares: null,
      permalink_url: null,
    });
    render(
      <AnalyticsPage
        businessId="business-1"
        drafts={[draft()]}
        loading={false}
        error={null}
      />,
    );

    expect(await screen.findByText("No metrics available")).toBeTruthy();
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.getByText("0 with data")).toBeTruthy();
  });

  it("announces Edian's loading and quota-denial states", async () => {
    let finishAnalysis!: (value: EdianAnalysis) => void;
    mocks.getFacebookAnalytics.mockResolvedValue({
      draft_id: "draft-1",
      platform: "facebook",
      reactions: 1,
      comments: 0,
      shares: 0,
      permalink_url: null,
    });
    mocks.analyzeWithEdian.mockReturnValue(
      new Promise<EdianAnalysis>((resolve) => {
        finishAnalysis = resolve;
      }),
    );
    render(
      <AnalyticsPage
        businessId="business-1"
        drafts={[draft()]}
        loading={false}
        error={null}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Analyze with Edian" }),
    );
    const loading = await screen.findByText(
      "Edian is analyzing Facebook metrics…",
      { selector: "p[role='status']" },
    );
    expect(loading.getAttribute("role")).toBe("status");

    finishAnalysis({
      status: "no_data",
      locale: "en",
      source: "Facebook",
      posts_analyzed: 1,
      observed: null,
      interpretation: null,
      reused: false,
    });
    expect(
      await screen.findByText(/no accessible engagement metrics/),
    ).toBeTruthy();

    mocks.analyzeWithEdian.mockRejectedValue(new ApiError("quota", 429));
    fireEvent.click(screen.getByRole("button", { name: "Analyze with Edian" }));
    expect(
      await screen.findByText(
        "The Edian analysis allowance for this customer is exhausted.",
      ),
    ).toBeTruthy();
  });

  it("submits only one Edian request for rapid duplicate clicks", async () => {
    mocks.getFacebookAnalytics.mockResolvedValue({
      draft_id: "draft-1",
      platform: "facebook",
      reactions: 1,
      comments: 0,
      shares: 0,
      permalink_url: null,
    });
    let finishAnalysis!: (value: EdianAnalysis) => void;
    mocks.analyzeWithEdian.mockReturnValue(
      new Promise<EdianAnalysis>((resolve) => {
        finishAnalysis = resolve;
      }),
    );
    render(
      <AnalyticsPage
        businessId="business-1"
        drafts={[draft()]}
        loading={false}
        error={null}
      />,
    );

    const button = await screen.findByRole("button", {
      name: "Analyze with Edian",
    });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(mocks.analyzeWithEdian).toHaveBeenCalledTimes(1);

    finishAnalysis({
      status: "ready",
      locale: "en",
      source: "Facebook",
      posts_analyzed: 1,
      observed: null,
      interpretation: {
        summary: "Engagement was observed.",
        recommendations: [],
      },
      reused: false,
    });
    await screen.findByText("Engagement was observed.");
  });
});

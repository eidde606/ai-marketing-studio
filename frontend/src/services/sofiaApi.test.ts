import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("./supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
    },
  },
}));

import {
  generateDraftWithLeo,
  sendMessageToSofia,
  SofiaApiError,
} from "./sofiaApi";

describe("sendMessageToSofia", () => {
  beforeEach(() => {
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: "test-token" } },
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("reads the machine-readable error code without exposing the response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ detail: "This trial usage allowance is exhausted" }),
          {
            status: 429,
            headers: { "X-Error-Code": "ai_quota_exhausted" },
          },
        ),
      ),
    );

    await expect(
      sendMessageToSofia("business-1", "Help me plan", null, "request-1"),
    ).rejects.toMatchObject({
      name: "SofiaApiError",
      status: 429,
      code: "ai_quota_exhausted",
      detail: "ai_quota_exhausted",
    } satisfies Partial<SofiaApiError>);
  });

  it("preserves safe HTTP 400 detail and X-Error-Code for draft generation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: "The conversation has no campaign instructions",
          }),
          {
            status: 400,
            headers: { "X-Error-Code": "invalid_input" },
          },
        ),
      ),
    );

    await expect(
      generateDraftWithLeo("business-1", "conversation-1", "request-1"),
    ).rejects.toMatchObject({
      name: "SofiaApiError",
      status: 400,
      code: "invalid_input",
      detail: "conversation_instructions_missing",
    } satisfies Partial<SofiaApiError>);
  });

  it("does not preserve unknown diagnostics or expose customer data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: "private conversation text and internal database diagnostics",
          }),
          {
            status: 400,
            headers: { "X-Error-Code": "internal_db_error" },
          },
        ),
      ),
    );

    let caught: unknown;
    try {
      await generateDraftWithLeo("business-1", "conversation-1", "request-1");
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      status: 400,
      code: null,
      detail: null,
    });
    expect((caught as Error).message).not.toContain("private conversation");
    expect((caught as Error).message).not.toContain("database diagnostics");
  });
});

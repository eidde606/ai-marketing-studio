import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SofiaChat from "./SofiaChat";
import { LocalizationProvider } from "../app/localization";

const mocks = vi.hoisted(() => {
  class SofiaApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string | null = null,
      readonly detail: string | null = null,
    ) {
      super(`Sebastián request failed: ${status}`);
    }
  }

  return {
    SofiaApiError,
    getBillingOverview: vi.fn(),
    generateDraftWithLeo: vi.fn(),
    getLatestSofiaConversation: vi.fn(),
    getSofiaConversation: vi.fn(),
    getSofiaConversations: vi.fn(),
    sendMessageToSofia: vi.fn(),
  };
});

vi.mock("../services/sofiaApi", () => mocks);
vi.mock("../services/billingApi", () => ({
  getBillingOverview: mocks.getBillingOverview,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  localStorage.clear();
});

function billingOverview({
  status = "trialing",
  sofiaUsed = 5,
  sofiaLimit = 5,
  valeriaUsed = 2,
  valeriaLimit = 20,
} = {}) {
  return {
    status,
    provider_status: null,
    trial_started_at: "2026-08-07T00:00:00Z",
    trial_expires_at: "2026-08-21T00:00:00Z",
    days_remaining: 14,
    current_period_end: null,
    cancel_at_period_end: false,
    usage: {
      sofia_requests: { used: sofiaUsed, limit: sofiaLimit },
      leo_generations: { used: valeriaUsed, limit: valeriaLimit },
    },
    plan_name: "Trial",
    price_display: null,
    checkout_available: false,
    portal_available: false,
    can_manage: false,
  };
}

describe("SofiaChat", () => {
  it("shows a Valeria generation error in the chat workflow", async () => {
    const generationError =
      "This business has too much saved context for content generation.";
    mocks.getLatestSofiaConversation.mockResolvedValue(null);
    mocks.getSofiaConversations.mockResolvedValue([]);

    render(
      <LocalizationProvider userId={null}>
        <SofiaChat
          businessId="business-1"
          onDraftCreated={vi.fn()}
          generationError={generationError}
        />
      </LocalizationProvider>,
    );

    expect((await screen.findByRole("alert")).textContent).toBe(
      generationError,
    );
  });

  it("prefills the Edian handoff without sending it until the customer submits", async () => {
    const initialMessage =
      "Review these Facebook metrics for this business:\n- Reactions: 12";
    const onInitialMessageConsumed = vi.fn();
    mocks.getLatestSofiaConversation.mockResolvedValue(null);
    mocks.getSofiaConversations.mockResolvedValue([]);
    mocks.sendMessageToSofia.mockResolvedValue({
      conversation_id: "conversation-1",
      reply: "Let's review those results.",
    });

    render(
      <SofiaChat
        businessId="business-1"
        initialMessage={initialMessage}
        onInitialMessageConsumed={onInitialMessageConsumed}
        onDraftCreated={vi.fn()}
      />,
    );

    const input = (await screen.findByRole("textbox", {
      name: "Message for Sebastián",
    })) as HTMLTextAreaElement;
    expect(input.value).toBe(initialMessage);
    expect(onInitialMessageConsumed).toHaveBeenCalledOnce();
    expect(mocks.sendMessageToSofia).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Let's review those results.")).toBeTruthy();
    expect(mocks.sendMessageToSofia).toHaveBeenCalledWith(
      "business-1",
      initialMessage,
      null,
    );
  });

  it("preserves a prepared Edian handoff and shows quota guidance after denial", async () => {
    const initialMessage =
      "Review these Facebook metrics for this business:\n- Reactions: 12";
    const onDraftChange = vi.fn();
    const onContinueWithValeria = vi.fn();
    mocks.getLatestSofiaConversation.mockResolvedValue(null);
    mocks.getSofiaConversations.mockResolvedValue([]);
    mocks.sendMessageToSofia.mockRejectedValue(
      new mocks.SofiaApiError(429, "ai_quota_exhausted"),
    );
    mocks.getBillingOverview.mockResolvedValue(
      billingOverview({ valeriaUsed: 5 }),
    );

    render(
      <SofiaChat
        businessId="business-1"
        initialMessage={initialMessage}
        onDraftCreated={vi.fn()}
        onDraftChange={onDraftChange}
        onContinueWithValeria={onContinueWithValeria}
      />,
    );

    const input = (await screen.findByRole("textbox", {
      name: "Message for Sebastián",
    })) as HTMLTextAreaElement;
    expect(input.value).toBe(initialMessage);
    expect(mocks.sendMessageToSofia).not.toHaveBeenCalled();

    const sendButton = screen.getByRole("button", { name: "Send" });
    await waitFor(() =>
      expect(sendButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(sendButton);

    expect(
      await screen.findByRole("heading", {
        name: "Sebastián's request allowance has been reached",
      }),
    ).toBeTruthy();
    expect(
      await screen.findByText(
        "Valeria has 15 content generations available to create a draft independently.",
      ),
    ).toBeTruthy();
    expect(input.value).toBe(initialMessage);
    expect(onDraftChange).toHaveBeenLastCalledWith(initialMessage);
    expect(mocks.sendMessageToSofia).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "Continue with Valeria" }),
    ).toBeTruthy();
    expect(onContinueWithValeria).not.toHaveBeenCalled();
  });

  it("retries loading the conversation after an initial history error", async () => {
    mocks.getLatestSofiaConversation
      .mockRejectedValueOnce(new Error("Sin conexión"))
      .mockResolvedValue(null);
    mocks.getSofiaConversations.mockResolvedValue([]);

    render(<SofiaChat businessId="business-1" onDraftCreated={vi.fn()} />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Sin conexión",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));

    expect(await screen.findByText(/I'm Sebastián/)).toBeTruthy();
    expect(mocks.getLatestSofiaConversation).toHaveBeenCalledTimes(2);
  });

  it("restores a failed message and allows retrying it", async () => {
    mocks.getLatestSofiaConversation.mockResolvedValue(null);
    mocks.getSofiaConversations.mockResolvedValue([]);
    mocks.sendMessageToSofia
      .mockRejectedValueOnce(new Error("Temporary"))
      .mockResolvedValue({
        conversation_id: "conversation-1",
        reply: "Vamos a definir el objetivo.",
      });

    render(<SofiaChat businessId="business-1" onDraftCreated={vi.fn()} />);

    const input = await screen.findByRole("textbox", {
      name: "Message for Sebastián",
    });
    fireEvent.change(input, {
      target: { value: "Quiero promocionar mi tienda" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Sebastián is temporarily unavailable.",
    );
    expect((input as HTMLTextAreaElement).value).toBe(
      "Quiero promocionar mi tienda",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry message" }));

    expect(
      await screen.findByText("Vamos a definir el objetivo."),
    ).toBeTruthy();
    expect(mocks.sendMessageToSofia).toHaveBeenCalledTimes(2);
    expect(mocks.sendMessageToSofia).toHaveBeenLastCalledWith(
      "business-1",
      "Quiero promocionar mi tienda",
      null,
    );
  });

  it("shows a safe localized error for provider authentication failures", async () => {
    mocks.getLatestSofiaConversation.mockResolvedValue(null);
    mocks.getSofiaConversations.mockResolvedValue([]);
    mocks.sendMessageToSofia.mockRejectedValue(new mocks.SofiaApiError(502));

    render(<SofiaChat businessId="business-1" onDraftCreated={vi.fn()} />);

    const input = await screen.findByRole("textbox", {
      name: "Message for Sebastián",
    });
    fireEvent.change(input, { target: { value: "Help me plan" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Sebastián is temporarily unavailable. Please try again later.",
    );
    expect(alert.textContent).not.toContain("502");
    expect(alert.textContent).not.toContain("AuthenticationError");
    expect((input as HTMLTextAreaElement).value).toBe("Help me plan");
  });

  it("shows authoritative quota details, preserves the draft, and offers real next steps", async () => {
    const onViewPlans = vi.fn();
    const onContinueWithValeria = vi.fn();
    mocks.getLatestSofiaConversation.mockResolvedValue(null);
    mocks.getSofiaConversations.mockResolvedValue([]);
    mocks.sendMessageToSofia.mockRejectedValue(
      new mocks.SofiaApiError(429, "ai_quota_exhausted"),
    );
    mocks.getBillingOverview.mockResolvedValue(billingOverview());

    render(
      <SofiaChat
        businessId="business-1"
        onDraftCreated={vi.fn()}
        onViewPlans={onViewPlans}
        onContinueWithValeria={onContinueWithValeria}
      />,
    );

    const input = (await screen.findByRole("textbox", {
      name: "Message for Sebastián",
    })) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Help me plan a launch" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByRole("heading", {
        name: "Sebastián's request allowance has been reached",
      }),
    ).toBeTruthy();
    expect(screen.getByText(/used 5 of 5 Sebastián requests/)).toBeTruthy();
    expect(screen.getByText(/14-day trial/)).toBeTruthy();
    expect(input.value).toBe("Help me plan a launch");
    expect(
      (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Retry message" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "View plans" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Valeria" }),
    );
    expect(onViewPlans).toHaveBeenCalledOnce();
    expect(onContinueWithValeria).toHaveBeenCalledOnce();
    expect(mocks.sendMessageToSofia).toHaveBeenCalledOnce();
  });

  it("does not mistake an unrelated 429 for exhausted quota", async () => {
    mocks.getLatestSofiaConversation.mockResolvedValue(null);
    mocks.getSofiaConversations.mockResolvedValue([]);
    mocks.sendMessageToSofia.mockRejectedValue(
      new mocks.SofiaApiError(429, "limit_exceeded"),
    );

    render(<SofiaChat businessId="business-1" onDraftCreated={vi.fn()} />);

    const input = (await screen.findByRole("textbox", {
      name: "Message for Sebastián",
    })) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Try again later" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Too many requests were received.",
    );
    expect(
      screen.queryByText(/request allowance has been reached/i),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry message" })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(mocks.getBillingOverview).not.toHaveBeenCalled();
  });

  it("offers a manual retry for provider throttling without showing quota actions", async () => {
    mocks.getLatestSofiaConversation.mockResolvedValue(null);
    mocks.getSofiaConversations.mockResolvedValue([]);
    mocks.sendMessageToSofia.mockRejectedValue(
      new mocks.SofiaApiError(502, "provider_rate_limited"),
    );

    render(<SofiaChat businessId="business-1" onDraftCreated={vi.fn()} />);

    const input = (await screen.findByRole("textbox", {
      name: "Message for Sebastián",
    })) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Help me plan" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Sebastián is handling many requests right now.",
    );
    expect(screen.getByRole("button", { name: "Retry message" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View plans" })).toBeNull();
    expect(mocks.getBillingOverview).not.toHaveBeenCalled();
  });

  it("hides Valeria when her own generation allowance is exhausted", async () => {
    mocks.getLatestSofiaConversation.mockResolvedValue(null);
    mocks.getSofiaConversations.mockResolvedValue([]);
    mocks.sendMessageToSofia.mockRejectedValue(
      new mocks.SofiaApiError(429, "ai_quota_exhausted"),
    );
    mocks.getBillingOverview.mockResolvedValue(
      billingOverview({ valeriaUsed: 20, valeriaLimit: 20 }),
    );

    render(
      <SofiaChat
        businessId="business-1"
        onDraftCreated={vi.fn()}
        onContinueWithValeria={vi.fn()}
      />,
    );

    const input = await screen.findByRole("textbox", {
      name: "Message for Sebastián",
    });
    fireEvent.change(input, { target: { value: "Help me plan" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByRole("heading", {
      name: "Sebastián's request allowance has been reached",
    });
    expect(
      screen.queryByRole("button", { name: "Continue with Valeria" }),
    ).toBeNull();
  });

  it("localizes quota details and actions in Spanish", async () => {
    localStorage.setItem("ai-marketing-studio:interface-language", "es");
    mocks.getLatestSofiaConversation.mockResolvedValue(null);
    mocks.getSofiaConversations.mockResolvedValue([]);
    mocks.sendMessageToSofia.mockRejectedValue(
      new mocks.SofiaApiError(429, "ai_quota_exhausted"),
    );
    mocks.getBillingOverview.mockResolvedValue(billingOverview());

    render(
      <LocalizationProvider userId={null}>
        <SofiaChat
          businessId="business-1"
          onDraftCreated={vi.fn()}
          onViewPlans={vi.fn()}
          onContinueWithValeria={vi.fn()}
        />
      </LocalizationProvider>,
    );

    const input = await screen.findByRole("textbox", {
      name: "Mensaje para Sebastián",
    });
    fireEvent.change(input, { target: { value: "Ayúdame a planear" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect(
      await screen.findByRole("heading", {
        name: "Se alcanzó el límite de solicitudes de Sebastián",
      }),
    ).toBeTruthy();
    expect(screen.getByText(/Has usado 5 de 5 solicitudes/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ver planes" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Continuar con Valeria" }),
    ).toBeTruthy();
    expect((input as HTMLTextAreaElement).value).toBe("Ayúdame a planear");
  });

  it("keeps history, conversation messages, composer, and Valeria handoff in document order", async () => {
    mocks.getLatestSofiaConversation.mockResolvedValue({
      conversation_id: "conversation-1",
      messages: [
        { role: "user", content: "Quiero presentar mi producto" },
        { role: "assistant", content: "Empecemos por tu audiencia." },
      ],
    });
    mocks.getSofiaConversations.mockResolvedValue([
      {
        id: "conversation-1",
        title: "Lanzamiento",
        created_at: "2026-01-01T10:00:00Z",
      },
    ]);

    const { container } = render(
      <SofiaChat businessId="business-1" onDraftCreated={vi.fn()} />,
    );

    expect(await screen.findByText("Empecemos por tu audiencia.")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Talk with Sebastián" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /History/ })).toBeTruthy();
    const chat = container.querySelector(".sofia-chat")!;
    const toolbar = chat.querySelector(".sofia-conversation-toolbar")!;
    const messages = chat.querySelector(".sofia-messages")!;
    const composer = chat.querySelector("form")!;
    const handoff = chat.querySelector(".sofia-draft-actions")!;
    expect(
      toolbar.compareDocumentPosition(messages) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      messages.compareDocumentPosition(composer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      composer.compareDocumentPosition(handoff) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("creates a Valeria draft from the selected Sebastián conversation", async () => {
    const generatedDraft = {
      id: "draft-1",
      business_id: "business-1",
      title: "Cafe launch",
      caption: "Visit us this week",
      platform: "instagram",
      status: "pending",
      media_type: "image" as const,
      image_prompt: "A welcoming cafe",
      image_url: null,
      image_status: "not_started" as const,
      video_status: "not_started" as const,
      video_url: null,
    };
    const onDraftCreated = vi.fn();
    mocks.getLatestSofiaConversation.mockResolvedValue({
      conversation_id: "conversation-1",
      messages: [
        { role: "user", content: "Promote our cafe" },
        { role: "assistant", content: "Let's focus on the new menu." },
      ],
    });
    mocks.getSofiaConversations.mockResolvedValue([
      {
        id: "conversation-1",
        title: "Cafe launch",
        created_at: "2026-01-01T10:00:00Z",
      },
    ]);
    mocks.generateDraftWithLeo.mockResolvedValue(generatedDraft);

    render(
      <SofiaChat businessId="business-1" onDraftCreated={onDraftCreated} />,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Create a draft with Valeria",
      }),
    );

    expect(
      await screen.findByText(
        "Draft created: Cafe launch. Review it in the Review section.",
      ),
    ).toBeTruthy();
    expect(mocks.generateDraftWithLeo).toHaveBeenCalledWith(
      "business-1",
      "conversation-1",
    );
    expect(onDraftCreated).toHaveBeenCalledWith(generatedDraft);
  });

  it.each([
    [
      "en",
      "This conversation has too much context to create a draft. Start a new conversation with a shorter brief and try again.",
      "Create a draft with Valeria",
    ],
    [
      "es",
      "Esta conversación tiene demasiado contexto para crear un borrador. Inicia una conversación nueva con instrucciones más breves.",
      "Crear borrador con Valeria",
    ],
  ])(
    "shows a localized, safe draft error in %s",
    async (language, expectedError, createButton) => {
      localStorage.setItem("ai-marketing-studio:interface-language", language);
      mocks.getLatestSofiaConversation.mockResolvedValue({
        conversation_id: "conversation-1",
        messages: [{ role: "user", content: "PRIVATE CUSTOMER CONTENT" }],
      });
      mocks.getSofiaConversations.mockResolvedValue([]);
      mocks.generateDraftWithLeo.mockRejectedValue(
        new mocks.SofiaApiError(400, "invalid_input", "context_too_large"),
      );
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      render(
        <LocalizationProvider userId={null}>
          <SofiaChat businessId="business-1" onDraftCreated={vi.fn()} />
        </LocalizationProvider>,
      );

      fireEvent.click(
        await screen.findByRole("button", { name: createButton }),
      );

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(expectedError);
      expect(warn).toHaveBeenCalledWith("[Valeria] draft generation failed", {
        status: 400,
        code: "invalid_input",
        detail: "context_too_large",
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain(
        "PRIVATE CUSTOMER CONTENT",
      );
    },
  );

  it("uses a safe fallback for unknown draft errors", async () => {
    mocks.getLatestSofiaConversation.mockResolvedValue({
      conversation_id: "conversation-1",
      messages: [{ role: "user", content: "PRIVATE CUSTOMER CONTENT" }],
    });
    mocks.getSofiaConversations.mockResolvedValue([]);
    mocks.generateDraftWithLeo.mockRejectedValue(
      new mocks.SofiaApiError(400, "invalid_input", null),
    );

    render(
      <LocalizationProvider userId={null}>
        <SofiaChat businessId="business-1" onDraftCreated={vi.fn()} />
      </LocalizationProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Create a draft with Valeria",
      }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Valeria couldn't create this draft. Please try again.",
    );
    expect(alert.textContent).not.toContain("PRIVATE CUSTOMER CONTENT");
    expect(alert.textContent).not.toContain("400");
  });

  it("offers billing details when Valeria's generation allowance is exhausted", async () => {
    const onViewPlans = vi.fn();
    mocks.getLatestSofiaConversation.mockResolvedValue({
      conversation_id: "conversation-1",
      messages: [{ role: "user", content: "Promote our cafe" }],
    });
    mocks.getSofiaConversations.mockResolvedValue([]);
    mocks.generateDraftWithLeo.mockRejectedValue(
      new mocks.SofiaApiError(429, "ai_quota_exhausted", "ai_quota_exhausted"),
    );

    render(
      <LocalizationProvider userId={null}>
        <SofiaChat
          businessId="business-1"
          onDraftCreated={vi.fn()}
          onViewPlans={onViewPlans}
        />
      </LocalizationProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Create a draft with Valeria",
      }),
    );

    expect(
      await screen.findByText(/Valeria's content-generation allowance/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View plans" }));
    expect(onViewPlans).toHaveBeenCalledOnce();
  });
});

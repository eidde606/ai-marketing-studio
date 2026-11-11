import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SofiaChat from "./SofiaChat";

const mocks = vi.hoisted(() => ({
  generateDraftWithLeo: vi.fn(),
  getLatestSofiaConversation: vi.fn(),
  getSofiaConversation: vi.fn(),
  getSofiaConversations: vi.fn(),
  sendMessageToSofia: vi.fn(),
}));

vi.mock("../services/sofiaApi", () => mocks);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("SofiaChat", () => {
  it("retries loading the conversation after an initial history error", async () => {
    mocks.getLatestSofiaConversation
      .mockRejectedValueOnce(new Error("Sin conexión"))
      .mockResolvedValue(null);
    mocks.getSofiaConversations.mockResolvedValue([]);

    render(<SofiaChat businessId="business-1" onDraftCreated={vi.fn()} />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Sin conexión",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reintentar carga" }));

    expect(
      await screen.findByText(/Soy Sofía/),
    ).toBeTruthy();
    expect(mocks.getLatestSofiaConversation).toHaveBeenCalledTimes(2);
  });

  it("restores a failed message and allows retrying it", async () => {
    mocks.getLatestSofiaConversation.mockResolvedValue(null);
    mocks.getSofiaConversations.mockResolvedValue([]);
    mocks.sendMessageToSofia
      .mockRejectedValueOnce(new Error("Temporal"))
      .mockResolvedValue({
        conversation_id: "conversation-1",
        reply: "Vamos a definir el objetivo.",
      });

    render(<SofiaChat businessId="business-1" onDraftCreated={vi.fn()} />);

    const input = await screen.findByRole("textbox", {
      name: "Mensaje para Sofía",
    });
    fireEvent.change(input, { target: { value: "Quiero promocionar mi tienda" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Temporal",
    );
    expect((input as HTMLTextAreaElement).value).toBe(
      "Quiero promocionar mi tienda",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Reintentar mensaje" }),
    );

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

  it("keeps history, conversation messages, composer, and Leo handoff in document order", async () => {
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
    expect(screen.getByRole("heading", { name: "Hablar con Sofía" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Historial/ })).toBeTruthy();
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
});

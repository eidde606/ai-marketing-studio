import { useEffect, useRef, useState } from "react";
import {
  generateDraftWithLeo,
  getLatestSofiaConversation,
  getSofiaConversation,
  getSofiaConversations,
  sendMessageToSofia,
  type SofiaConversationSummary,
  type SofiaGeneratedDraft,
  type SofiaMessage,
} from "../services/sofiaApi";

type SofiaChatProps = {
  businessId: string;
  onDraftCreated: (draft: SofiaGeneratedDraft) => void;
};

function formatConversationDate(value: string): string {
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
    ? value
    : `${value}Z`;

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return "Fecha no disponible";
  }

  return new Intl.DateTimeFormat("es-US", {
    timeZone: "America/New_York",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function conversationTitle(conversation: SofiaConversationSummary): string {
  return conversation.title?.trim() || "Nueva campaña";
}

export default function SofiaChat({
  businessId,
  onDraftCreated,
}: SofiaChatProps) {
  const [messages, setMessages] = useState<SofiaMessage[]>([]);
  const [message, setMessage] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<
    SofiaConversationSummary[]
  >([]);

  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [switchingConversation, setSwitchingConversation] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [generatedDraftTitle, setGeneratedDraftTitle] = useState<string | null>(
    null,
  );

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadConversation() {
      setLoadingHistory(true);
      setError(null);
      setMessages([]);
      setMessage("");
      setConversationId(null);
      setConversations([]);
      setGeneratedDraftTitle(null);
      setShowHistory(false);

      try {
        const [latest, history] = await Promise.all([
          getLatestSofiaConversation(businessId),
          getSofiaConversations(businessId),
        ]);

        if (cancelled) return;

        setConversations(history);

        if (latest) {
          setConversationId(latest.conversation_id);
          setMessages(latest.messages);
        }
      } catch (err) {
        if (cancelled) return;

        setError(
          err instanceof Error
            ? err.message
            : "No se pudo cargar la conversación.",
        );
      } finally {
        if (!cancelled) {
          setLoadingHistory(false);
        }
      }
    }

    void loadConversation();

    return () => {
      cancelled = true;
    };
  }, [businessId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [messages, loading, loadingHistory, switchingConversation]);

  async function refreshConversations() {
    try {
      const history = await getSofiaConversations(businessId);
      setConversations(history);
    } catch (err) {
      console.error("Failed to refresh conversations:", err);
    }
  }

  async function handleSelectConversation(id: string) {
    if (chatDisabled || id === conversationId) return;

    setSwitchingConversation(true);
    setError(null);
    setGeneratedDraftTitle(null);

    try {
      const conversation = await getSofiaConversation(businessId, id);

      setConversationId(conversation.conversation_id);
      setMessages(conversation.messages);
      setMessage("");
      setShowHistory(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo cargar la conversación.",
      );
    } finally {
      setSwitchingConversation(false);
    }
  }

  function handleNewConversation() {
    if (chatDisabled) return;

    setConversationId(null);
    setMessages([]);
    setMessage("");
    setError(null);
    setGeneratedDraftTitle(null);
    setShowHistory(false);
  }

  async function handleSend() {
    const text = message.trim();

    if (!text || chatDisabled) return;

    setLoading(true);
    setError(null);
    setGeneratedDraftTitle(null);
    setMessage("");

    setMessages((previous) => [...previous, { role: "user", content: text }]);

    try {
      const response = await sendMessageToSofia(
        businessId,
        text,
        conversationId,
      );

      setConversationId(response.conversation_id);

      setMessages((previous) => [
        ...previous,
        { role: "assistant", content: response.reply },
      ]);

      void refreshConversations();
    } catch (err) {
      setMessage(text);
      setMessages((previous) => previous.slice(0, -1));

      setError(
        err instanceof Error ? err.message : "No se pudo contactar a Sofía.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateDraft() {
    if (!conversationId || chatDisabled) return;

    setGeneratingDraft(true);
    setGeneratedDraftTitle(null);
    setError(null);

    try {
      const draft = await generateDraftWithLeo(businessId, conversationId);

      setGeneratedDraftTitle(draft.title);
      onDraftCreated(draft);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo generar el borrador.",
      );
    } finally {
      setGeneratingDraft(false);
    }
  }

  const chatDisabled =
    loading ||
    loadingHistory ||
    switchingConversation ||
    generatingDraft ||
    Boolean(error);

  const currentConversation = conversations.find(
    (item) => item.id === conversationId,
  );

  const currentTitle = currentConversation
    ? conversationTitle(currentConversation)
    : conversationId
      ? "Conversación actual"
      : "Nueva conversación";

  return (
    <section className="sofia-chat">
      <header>
        <h2>Hablar con Sofía</h2>
        <p>Tu estratega de marketing con inteligencia artificial.</p>
      </header>

      <div className="sofia-conversation-toolbar">
        <div className="sofia-conversation-heading">
          <div className="sofia-conversation-heading-text">
            <span className="sofia-conversation-label">
              CONVERSACIÓN ACTUAL
            </span>

            <strong>{currentTitle}</strong>

            {currentConversation && (
              <small>
                {formatConversationDate(currentConversation.created_at)}
              </small>
            )}
          </div>

          <span className="sofia-conversation-status">
            {conversationId ? "Activa" : "Sin iniciar"}
          </span>
        </div>

        <div className="sofia-conversation-buttons">
          <button
            type="button"
            className="sofia-new-conversation"
            onClick={handleNewConversation}
            disabled={chatDisabled}
          >
            <span aria-hidden="true">＋</span>
            Nueva conversación
          </button>

          <button
            type="button"
            className="sofia-history-button"
            onClick={() => setShowHistory((current) => !current)}
            disabled={
              loading ||
              loadingHistory ||
              switchingConversation ||
              generatingDraft
            }
            aria-expanded={showHistory}
          >
            <span aria-hidden="true">◷</span>
            Historial
            <span aria-hidden="true">{showHistory ? "⌃" : "⌄"}</span>
          </button>
        </div>

        {showHistory && (
          <div className="sofia-history-panel">
            <div className="sofia-history-heading">
              <strong>Conversaciones anteriores</strong>
              <span>{conversations.length}</span>
            </div>

            {conversations.length === 0 ? (
              <p>Todavía no hay conversaciones guardadas.</p>
            ) : (
              <div className="sofia-history-list">
                {conversations.map((conversation) => (
                  <button
                    type="button"
                    key={conversation.id}
                    className={`sofia-history-item ${
                      conversation.id === conversationId
                        ? "sofia-history-item--active"
                        : ""
                    }`}
                    onClick={() =>
                      void handleSelectConversation(conversation.id)
                    }
                    disabled={chatDisabled}
                  >
                    <span className="sofia-history-item-icon">◉</span>

                    <span className="sofia-history-item-details">
                      <strong>{conversationTitle(conversation)}</strong>
                      <small>
                        {formatConversationDate(conversation.created_at)}
                      </small>
                    </span>

                    {conversation.id === conversationId && (
                      <span className="sofia-history-current">Actual</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sofia-messages">
        {loadingHistory && <p>Cargando conversación...</p>}

        {switchingConversation && <p>Cargando conversación...</p>}

        {!loadingHistory &&
          !switchingConversation &&
          messages.length === 0 &&
          !error && (
            <p>
              ¡Hola! Soy Sofía. Cuéntame qué producto quieres promocionar o qué
              idea tienes para tu negocio.
            </p>
          )}

        {messages.map((item, index) => (
          <div
            key={index}
            className={`sofia-message sofia-message--${item.role}`}
          >
            <strong>{item.role === "user" ? "Tú" : "Sofía"}</strong>
            <p>{item.content}</p>
          </div>
        ))}

        {loading && <p>Sofía está escribiendo...</p>}

        <div ref={messagesEndRef} />
      </div>

      {error && (
        <p role="alert">
          {error}{" "}
          <button type="button" onClick={() => window.location.reload()}>
            Reintentar
          </button>
        </p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSend();
        }}
      >
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();

              if (!chatDisabled && message.trim()) {
                void handleSend();
              }
            }
          }}
          placeholder={
            loadingHistory
              ? "Cargando conversación..."
              : "Escribe tu mensaje para Sofía..."
          }
          disabled={chatDisabled}
          maxLength={4000}
          rows={2}
        />

        <button type="submit" disabled={chatDisabled || !message.trim()}>
          {loading ? "Enviando..." : "Enviar"}
        </button>
      </form>

      <div className="sofia-draft-actions">
        <button
          type="button"
          className="primary-button"
          onClick={() => void handleGenerateDraft()}
          disabled={!conversationId || chatDisabled}
        >
          {generatingDraft
            ? "Sofía y Leo están trabajando..."
            : "Crear borrador con Leo"}
        </button>

        {generatedDraftTitle && (
          <p role="status">
            Borrador creado: <strong>{generatedDraftTitle}</strong>. Puedes
            revisarlo en Aprobaciones.
          </p>
        )}
      </div>
    </section>
  );
}

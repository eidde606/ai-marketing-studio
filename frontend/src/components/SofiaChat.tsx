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
import { useLocalization } from "../app/localization";

type SofiaChatProps = {
  businessId: string;
  onDraftCreated: (draft: SofiaGeneratedDraft) => void;
};

function formatConversationDate(value: string, locale: string): string {
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
    ? value
    : `${value}Z`;

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", {
    timeZone: "America/New_York",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: locale !== "es",
  }).format(date);
}

function conversationTitle(
  conversation: SofiaConversationSummary,
  fallback: string,
): string {
  return conversation.title?.trim() || fallback;
}

export default function SofiaChat({
  businessId,
  onDraftCreated,
}: SofiaChatProps) {
  const { locale, t } = useLocalization();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
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
  const [historyRetry, setHistoryRetry] = useState(0);
  const [errorAction, setErrorAction] = useState<
    "history" | "send" | "conversation" | "draft" | null
  >(null);
  const [retryConversationId, setRetryConversationId] = useState<string | null>(
    null,
  );

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
      setErrorAction(null);
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
            : tRef.current("sofia.conversationLoadError"),
        );
        setErrorAction("history");
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
  }, [businessId, historyRetry]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({
      behavior: "smooth",
      block: "nearest",
    });
  }, [messages, loading, loadingHistory, switchingConversation]);

  async function refreshConversations() {
    try {
      const history = await getSofiaConversations(businessId);
      setConversations(history);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : tRef.current("sofia.historyLoadError"),
      );
      setErrorAction("history");
    }
  }

  async function handleSelectConversation(id: string) {
    if (chatDisabled || id === conversationId) return;

    setSwitchingConversation(true);
    setError(null);
    setErrorAction(null);
    setRetryConversationId(null);
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
          : tRef.current("sofia.conversationLoadError"),
      );
      setErrorAction("conversation");
      setRetryConversationId(id);
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
    setErrorAction(null);
    setRetryConversationId(null);
    setGeneratedDraftTitle(null);
    setShowHistory(false);
  }

  async function handleSend() {
    const text = message.trim();

    if (!text || chatDisabled) return;

    setLoading(true);
    setError(null);
    setErrorAction(null);
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
        err instanceof Error ? err.message : tRef.current("sofia.contactError"),
      );
      setErrorAction("send");
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
        err instanceof Error ? err.message : tRef.current("sofia.draftError"),
      );
      setErrorAction("draft");
    } finally {
      setGeneratingDraft(false);
    }
  }

  const chatDisabled =
    loading ||
    loadingHistory ||
    switchingConversation ||
    generatingDraft;

  function retryFailedAction() {
    const action = errorAction;
    setError(null);
    setErrorAction(null);
    if (action === "history") {
      setHistoryRetry((count) => count + 1);
    } else if (action === "send") {
      void handleSend();
    } else if (action === "conversation" && retryConversationId) {
      void handleSelectConversation(retryConversationId);
    } else if (action === "draft" && conversationId) {
      void handleGenerateDraft();
    }
  }

  const currentConversation = conversations.find(
    (item) => item.id === conversationId,
  );

  const currentTitle = currentConversation
    ? conversationTitle(currentConversation, t("sofia.newCampaign"))
    : conversationId
      ? t("sofia.currentTitle")
      : t("sofia.newConversationTitle");

  return (
    <section className="sofia-chat" data-guide-target="leo-generation">
      <header>
        <h2>{t("sofia.title")}</h2>
        <p>{t("sofia.description")}</p>
      </header>

      <div className="sofia-conversation-toolbar">
        <div className="sofia-conversation-heading">
          <div className="sofia-conversation-heading-text">
            <span className="sofia-conversation-label">
              {t("sofia.currentConversation")}
            </span>

            <strong>{currentTitle}</strong>

            {currentConversation && (
              <small>
                {formatConversationDate(currentConversation.created_at, locale) ||
                  t("sofia.dateUnavailable")}
              </small>
            )}
          </div>

          <span className="sofia-conversation-status">
            {conversationId ? t("sofia.active") : t("sofia.notStarted")}
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
            {t("sofia.newConversation")}
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
            {t("sofia.history")}
            <span aria-hidden="true">{showHistory ? "⌃" : "⌄"}</span>
          </button>
        </div>

        {showHistory && (
          <div
            className="sofia-history-panel"
            aria-label={t("sofia.history")}
          >
            <div className="sofia-history-heading">
              <strong>{t("sofia.previousConversations")}</strong>
              <span>{conversations.length}</span>
            </div>

            {conversations.length === 0 ? (
              <p>{t("sofia.noConversations")}</p>
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
                      <strong>
                        {conversationTitle(
                          conversation,
                          t("sofia.newCampaign"),
                        )}
                      </strong>
                      <small>
                        {formatConversationDate(
                          conversation.created_at,
                          locale,
                        ) || t("sofia.dateUnavailable")}
                      </small>
                    </span>

                    {conversation.id === conversationId && (
                      <span className="sofia-history-current">
                        {t("sofia.current")}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div
        className="sofia-messages"
        role="log"
        aria-label={t("sofia.messages")}
        aria-live="polite"
        aria-relevant="additions text"
      >
        {loadingHistory && (
          <p role="status">{t("sofia.loadingConversation")}</p>
        )}

        {switchingConversation && (
          <p role="status">{t("sofia.loadingConversation")}</p>
        )}

        {!loadingHistory &&
          !switchingConversation &&
          messages.length === 0 &&
          !error && (
            <p>{t("sofia.greeting")}</p>
          )}

        {messages.map((item, index) => (
          <div
            key={index}
            className={`sofia-message sofia-message--${item.role}`}
          >
            <strong>{item.role === "user" ? t("sofia.you") : "Sofia"}</strong>
            <p>{item.content}</p>
          </div>
        ))}

        {loading && <p role="status">{t("sofia.thinking")}</p>}

        <div ref={messagesEndRef} />
      </div>

      {error && (
        <p role="alert">
          {error}
          <button type="button" onClick={retryFailedAction}>
            {errorAction === "send"
              ? t("sofia.retryMessage")
              : errorAction === "draft"
                ? t("sofia.retryDraft")
                : t("sofia.retryLoad")}
          </button>
        </p>
      )}

      <form
        data-guide-target="sofia-guided"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSend();
        }}
      >
        <textarea
          aria-label={t("sofia.messageLabel")}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value);
            if (errorAction === "send") {
              setError(null);
              setErrorAction(null);
            }
          }}
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
              ? t("sofia.loadingPlaceholder")
              : t("sofia.messagePlaceholder")
          }
          disabled={chatDisabled}
          maxLength={4000}
          rows={2}
        />

        <button type="submit" disabled={chatDisabled || !message.trim()}>
          {loading ? t("sofia.sending") : t("sofia.send")}
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
            ? t("sofia.generating")
            : t("sofia.createDraft")}
        </button>

        {generatedDraftTitle && (
          <p role="status">
            {t("sofia.draftCreated", { title: generatedDraftTitle })}
          </p>
        )}
      </div>
    </section>
  );
}

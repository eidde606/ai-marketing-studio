import { useEffect, useRef, useState } from "react";
import {
  generateDraftWithLeo,
  getLatestSofiaConversation,
  getSofiaConversation,
  getSofiaConversations,
  SofiaApiError,
  sendMessageToSofia,
  type SofiaConversationSummary,
  type SofiaGeneratedDraft,
  type SofiaMessage,
} from "../services/sofiaApi";
import {
  getBillingOverview,
  type BillingOverview,
} from "../services/billingApi";
import { useLocalization } from "../app/useLocalization";

type SofiaChatProps = {
  businessId: string;
  initialMessage?: string | null;
  draftMessage?: string;
  onDraftChange?: (message: string) => void;
  onInitialMessageConsumed?: () => void;
  onDraftCreated: (draft: SofiaGeneratedDraft) => void;
  onViewPlans?: () => void;
  onContinueWithValeria?: () => void;
  generationError?: string | null;
};

type QuotaNotice = {
  overview: BillingOverview | null;
  loading: boolean;
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
  initialMessage,
  draftMessage,
  onDraftChange,
  onInitialMessageConsumed,
  onDraftCreated,
  onViewPlans,
  onContinueWithValeria,
  generationError,
}: SofiaChatProps) {
  const { locale, t } = useLocalization();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [messages, setMessages] = useState<SofiaMessage[]>([]);
  const [message, setMessage] = useState(
    initialMessage ?? draftMessage ?? "",
  );
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
    "history" | "send" | "conversation" | "draft" | "billing" | null
  >(null);
  const [retryConversationId, setRetryConversationId] = useState<string | null>(
    null,
  );

  const [error, setError] = useState<string | null>(null);
  const [quotaNotice, setQuotaNotice] = useState<QuotaNotice | null>(null);
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
    if (!initialMessage) return;
    onDraftChange?.(initialMessage);
    onInitialMessageConsumed?.();
  }, [initialMessage, onDraftChange, onInitialMessageConsumed]);

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
    setQuotaNotice(null);

    try {
      const conversation = await getSofiaConversation(businessId, id);

      setConversationId(conversation.conversation_id);
      setMessages(conversation.messages);
      setMessage("");
      onDraftChange?.("");
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
    onDraftChange?.("");
    setError(null);
    setErrorAction(null);
    setQuotaNotice(null);
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
    onDraftChange?.("");

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
      onDraftChange?.(text);
      setMessages((previous) => previous.slice(0, -1));

      if (err instanceof SofiaApiError && err.code === "ai_quota_exhausted") {
        setError(null);
        setErrorAction(null);
        setQuotaNotice({ overview: null, loading: true });
        void getBillingOverview(businessId)
          .then((overview) => {
            setQuotaNotice({ overview, loading: false });
          })
          .catch(() => {
            setQuotaNotice({ overview: null, loading: false });
          });
      } else {
        setQuotaNotice(null);
        const code = err instanceof SofiaApiError ? err.code : null;
        if (
          code === "ai_entitlement_required" ||
          code === "ai_subscription_required"
        ) {
          setError(tRef.current("sofia.accessRequired"));
          setErrorAction("billing");
        } else if (code === "provider_rate_limited") {
          setError(tRef.current("sofia.providerThrottled"));
          setErrorAction("send");
        } else if (err instanceof SofiaApiError && err.status === 429) {
          setError(tRef.current("sofia.requestLimited"));
          setErrorAction(null);
        } else if (
          code === "upstream_failure" ||
          !(err instanceof SofiaApiError) ||
          err.status >= 500
        ) {
          setError(tRef.current("sofia.providerUnavailable"));
          setErrorAction("send");
        } else {
          setError(tRef.current("sofia.contactError"));
          setErrorAction(null);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateDraft() {
    if (!conversationId || chatDisabled) return;

    setGeneratingDraft(true);
    setGeneratedDraftTitle(null);
    setError(null);
    setErrorAction(null);
    setQuotaNotice(null);

    try {
      const draft = await generateDraftWithLeo(businessId, conversationId);

      setGeneratedDraftTitle(draft.title);
      onDraftCreated(draft);
    } catch (err) {
      if (err instanceof SofiaApiError) {
        if (import.meta.env.DEV) {
          console.warn("[Valeria] draft generation failed", {
            status: err.status,
            code: err.code,
            detail: err.detail,
          });
        }

        if (
          err.code === "ai_quota_exhausted" ||
          err.detail === "ai_quota_exhausted"
        ) {
          setError(tRef.current("sofia.draftQuotaExceeded"));
          setErrorAction("billing");
        } else if (
          err.code === "ai_entitlement_required" ||
          err.code === "ai_subscription_required" ||
          err.detail === "ai_entitlement_required" ||
          err.detail === "ai_subscription_required"
        ) {
          setError(tRef.current("sofia.accessRequired"));
          setErrorAction("billing");
        } else if (
          err.detail === "conversation_instructions_missing"
        ) {
          setError(tRef.current("sofia.draftConversationMissing"));
          setErrorAction(null);
        } else if (err.detail === "context_too_large") {
          setError(tRef.current("sofia.draftContextTooLarge"));
          setErrorAction(null);
        } else if (err.detail === "invalid_idempotency_key") {
          setError(tRef.current("sofia.draftRequestInvalid"));
          setErrorAction("draft");
        } else if (err.code === "provider_rate_limited") {
          setError(tRef.current("sofia.draftProviderThrottled"));
          setErrorAction("draft");
        } else if (err.code === "upstream_failure" || err.status >= 500) {
          setError(tRef.current("sofia.providerUnavailable"));
          setErrorAction("draft");
        } else {
          setError(tRef.current("sofia.draftError"));
          setErrorAction(null);
        }
      } else {
        setError(tRef.current("sofia.draftError"));
        setErrorAction(null);
      }
    } finally {
      setGeneratingDraft(false);
    }
  }

  const chatDisabled =
    loading || loadingHistory || switchingConversation || generatingDraft;
  const quotaUsage =
    quotaNotice?.overview?.usage?.sofia_requests;
  const valeriaUsage =
    quotaNotice?.overview?.usage?.leo_generations;
  const valeriaAvailable = Boolean(
    onContinueWithValeria &&
      quotaNotice?.overview &&
      ["trialing", "active"].includes(quotaNotice.overview.status) &&
      valeriaUsage &&
      valeriaUsage.limit > valeriaUsage.used,
  );

  function quotaPeriodDescription(): string {
    const overview = quotaNotice?.overview;
    if (!overview) return "";
    const periodKey: "sofia.trialPeriod" | "sofia.billingPeriod" =
      overview.status === "trialing"
        ? "sofia.trialPeriod"
        : "sofia.billingPeriod";
    const endDate =
      overview.status === "trialing"
        ? overview.trial_expires_at
        : overview.current_period_end;
    const formattedDate = endDate
      ? new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", {
          dateStyle: "medium",
        }).format(new Date(endDate))
      : "";
    if (formattedDate) {
      return t(
        overview.status === "trialing"
          ? "sofia.trialPeriodEnding"
          : "sofia.billingPeriodEnding",
        { date: formattedDate },
      );
    }
    return t(periodKey);
  }

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
                {formatConversationDate(
                  currentConversation.created_at,
                  locale,
                ) || t("sofia.dateUnavailable")}
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
          <div className="sofia-history-panel" aria-label={t("sofia.history")}>
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
          !error && <p>{t("sofia.greeting")}</p>}

        {messages.map((item, index) => (
          <div
            key={index}
            className={`sofia-message sofia-message--${item.role}`}
          >
            <strong>
              {item.role === "user" ? t("sofia.you") : t("sofia.agentName")}
            </strong>
            <p>{item.content}</p>
          </div>
        ))}

        {loading && <p role="status">{t("sofia.thinking")}</p>}

        <div ref={messagesEndRef} />
      </div>

      {quotaNotice && (
        <section
          className="sofia-quota-notice"
          role="status"
          aria-labelledby="sofia-quota-title"
        >
          <div className="sofia-quota-notice__content">
            <h3 id="sofia-quota-title">{t("sofia.quotaTitle")}</h3>
            {quotaUsage ? (
              <p>
                {t("sofia.quotaUsage", {
                  used: quotaUsage.used,
                  limit: quotaUsage.limit,
                  period: quotaPeriodDescription(),
                })}
              </p>
            ) : (
              <p>
                {quotaNotice.loading
                  ? t("sofia.quotaChecking")
                  : t("sofia.quotaUsageUnavailable")}
              </p>
            )}
            {valeriaAvailable && valeriaUsage && (
              <p className="sofia-quota-notice__secondary">
                {t("sofia.valeriaAvailable", {
                  remaining: valeriaUsage.limit - valeriaUsage.used,
                })}
              </p>
            )}
          </div>
          <div className="sofia-quota-notice__actions">
            {onViewPlans && (
              <button type="button" onClick={onViewPlans}>
                {t("sofia.viewPlans")}
              </button>
            )}
            {valeriaAvailable && (
              <button
                type="button"
                className="sofia-quota-notice__secondary-action"
                onClick={onContinueWithValeria}
              >
                {t("sofia.continueWithValeria")}
              </button>
            )}
          </div>
        </section>
      )}

      {generationError && (
        <p className="workspace-message--error" role="alert">
          {generationError}
        </p>
      )}

      {error && (
        <p role="alert">
          {error}
          {errorAction && errorAction !== "billing" && (
            <button type="button" onClick={retryFailedAction}>
              {errorAction === "send"
                ? t("sofia.retryMessage")
                : errorAction === "draft"
                  ? t("sofia.retryDraft")
                  : t("sofia.retryLoad")}
            </button>
          )}
          {errorAction === "billing" && onViewPlans && (
            <button type="button" onClick={onViewPlans}>
              {t("sofia.viewPlans")}
            </button>
          )}
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
            const value = event.target.value;
            setMessage(value);
            onDraftChange?.(value);
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

        <button
          type="submit"
          disabled={chatDisabled || Boolean(quotaNotice) || !message.trim()}
        >
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
          {generatingDraft ? t("sofia.generating") : t("sofia.createDraft")}
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

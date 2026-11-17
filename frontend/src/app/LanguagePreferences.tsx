import { useEffect, useRef, useState, type FormEvent } from "react";
import { FileText, Languages, MessageCircle } from "lucide-react";
import { useLocalization } from "./useLocalization";
import {
  getBusinessPreferences,
  updateBusinessPreferences,
  type Language,
} from "../services/accountApi";

type LanguageDraft = { userId: string; language: Language };
type Feedback = {
  scope: string;
  preference: "interface" | "conversation" | "content";
  result: "saved" | "error";
};

export default function LanguagePreferences({
  businessId,
}: {
  businessId: string;
}) {
  const {
    account,
    accountError,
    accountLoading,
    refreshAccount,
    saveAccountPreferences,
    setInterfaceLanguage,
    t,
  } = useLocalization();
  const [interfaceDraft, setInterfaceDraft] = useState<LanguageDraft | null>(
    null,
  );
  const [conversationDraft, setConversationDraft] =
    useState<LanguageDraft | null>(null);
  const [contentLanguage, setContentLanguage] = useState<Language>("en");
  const [contentError, setContentError] = useState(false);
  const [loadedContentBusinessId, setLoadedContentBusinessId] = useState("");
  const [savingPreference, setSavingPreference] = useState<
    "interface" | "conversation" | "content" | null
  >(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const activeBusinessId = useRef(businessId);
  const contentRequest = useRef(0);

  useEffect(() => {
    activeBusinessId.current = businessId;
  }, [businessId]);

  const userId = account?.user_id ?? "";
  const interfaceLanguage =
    interfaceDraft?.userId === userId
      ? interfaceDraft.language
      : (account?.preferences.interface_language ?? "en");
  const conversationLanguage =
    conversationDraft?.userId === userId
      ? conversationDraft.language
      : (account?.preferences.conversation_language ?? "en");
  const contentLoading =
    Boolean(businessId) && loadedContentBusinessId !== businessId;

  useEffect(() => {
    if (!businessId) return;
    const requestId = ++contentRequest.current;
    getBusinessPreferences(businessId)
      .then((preferences) => {
        if (requestId !== contentRequest.current) return;
        setContentLanguage(preferences.marketing_content_language);
        setContentError(false);
        setLoadedContentBusinessId(businessId);
      })
      .catch(() => {
        if (requestId === contentRequest.current) {
          setContentError(true);
          setLoadedContentBusinessId(businessId);
        }
      });
    return () => {
      contentRequest.current += 1;
    };
  }, [businessId, refreshVersion]);

  function showFeedback(
    preference: Feedback["preference"],
    result: Feedback["result"],
    scope = userId,
  ) {
    setFeedback({ scope, preference, result });
  }

  async function saveInterface(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId || savingPreference) return;
    setSavingPreference("interface");
    setFeedback(null);
    try {
      const saved = await setInterfaceLanguage(interfaceLanguage);
      if (saved) {
        setInterfaceDraft(null);
        showFeedback("interface", "saved");
      } else {
        showFeedback("interface", "error");
      }
    } catch {
      showFeedback("interface", "error");
    } finally {
      setSavingPreference(null);
    }
  }

  async function saveConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId || savingPreference) return;
    setSavingPreference("conversation");
    setFeedback(null);
    try {
      await saveAccountPreferences({
        conversation_language: conversationLanguage,
      });
      setConversationDraft(null);
      showFeedback("conversation", "saved");
    } catch {
      showFeedback("conversation", "error");
    } finally {
      setSavingPreference(null);
    }
  }

  async function saveContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessId || contentError || savingPreference) return;
    const targetBusinessId = businessId;
    setSavingPreference("content");
    setFeedback(null);
    try {
      const preferences = await updateBusinessPreferences(targetBusinessId, {
        marketing_content_language: contentLanguage,
      });
      if (activeBusinessId.current === targetBusinessId) {
        setContentLanguage(preferences.marketing_content_language);
        showFeedback("content", "saved", targetBusinessId);
      }
    } catch {
      if (activeBusinessId.current === targetBusinessId) {
        showFeedback("content", "error", targetBusinessId);
      }
    } finally {
      setSavingPreference(null);
    }
  }

  function retryContent() {
    setLoadedContentBusinessId("");
    setContentError(false);
    setRefreshVersion((value) => value + 1);
  }

  function feedbackFor(preference: Feedback["preference"], scope: string) {
    if (
      !feedback ||
      feedback.preference !== preference ||
      feedback.scope !== scope
    ) {
      return null;
    }
    const key =
      feedback.result === "error"
        ? "language.preferenceError"
        : preference === "interface"
          ? "language.interfaceSaved"
          : preference === "conversation"
            ? "language.conversationSaved"
            : "language.contentSaved";
    return (
      <p
        className={`settings-language__feedback settings-language__feedback--${feedback.result}`}
        role={feedback.result === "error" ? "alert" : "status"}
      >
        {t(key)}
      </p>
    );
  }

  const accountUnavailable =
    accountLoading || !account || Boolean(accountError);

  return (
    <section
      className="settings-language panel"
      aria-labelledby="language-preferences-title"
    >
      <div className="settings-section-heading">
        <div>
          <h3 id="language-preferences-title">{t("language.settingsTitle")}</h3>
          <p>{t("language.settingsHelp")}</p>
        </div>
      </div>

      {accountLoading && (
        <p className="settings-language__notice" role="status">
          {t("language.accountLoading")}
        </p>
      )}
      {accountError && (
        <div className="settings-language__notice" role="alert">
          <p>{t("language.accountError")}</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void refreshAccount()}
          >
            {t("common.retry")}
          </button>
        </div>
      )}

      <div className="settings-language__grid">
        <form
          className="settings-language__card"
          onSubmit={(event) => void saveInterface(event)}
        >
          <span className="settings-language__icon" aria-hidden="true">
            <Languages size={20} />
          </span>
          <div className="settings-language__copy">
            <label htmlFor="interface-language">
              {t("language.interface")}
            </label>
            <p id="interface-language-help">{t("language.interfaceHelp")}</p>
          </div>
          <select
            id="interface-language"
            value={interfaceLanguage}
            onChange={(event) =>
              userId &&
              setInterfaceDraft({
                userId,
                language: event.target.value as Language,
              })
            }
            disabled={accountUnavailable || savingPreference !== null}
            aria-describedby="interface-language-help"
          >
            <option value="en">{t("common.english")}</option>
            <option value="es">{t("common.spanish")}</option>
          </select>
          <button
            type="submit"
            className="primary-button"
            disabled={
              accountUnavailable ||
              savingPreference !== null ||
              interfaceLanguage === account?.preferences.interface_language
            }
          >
            {savingPreference === "interface"
              ? t("common.saving")
              : t("language.saveInterface")}
          </button>
          {feedbackFor("interface", userId)}
        </form>

        <form
          className="settings-language__card"
          onSubmit={(event) => void saveConversation(event)}
        >
          <span className="settings-language__icon" aria-hidden="true">
            <MessageCircle size={20} />
          </span>
          <div className="settings-language__copy">
            <label htmlFor="conversation-language">
              {t("language.conversation")}
            </label>
            <p id="conversation-language-help">
              {t("language.conversationHelp")}
            </p>
          </div>
          <select
            id="conversation-language"
            value={conversationLanguage}
            onChange={(event) =>
              userId &&
              setConversationDraft({
                userId,
                language: event.target.value as Language,
              })
            }
            disabled={accountUnavailable || savingPreference !== null}
            aria-describedby="conversation-language-help"
          >
            <option value="en">{t("common.english")}</option>
            <option value="es">{t("common.spanish")}</option>
          </select>
          <button
            type="submit"
            className="primary-button"
            disabled={
              accountUnavailable ||
              savingPreference !== null ||
              conversationLanguage ===
                account?.preferences.conversation_language
            }
          >
            {savingPreference === "conversation"
              ? t("common.saving")
              : t("language.saveConversation")}
          </button>
          {feedbackFor("conversation", userId)}
        </form>

        <form
          className="settings-language__card"
          onSubmit={(event) => void saveContent(event)}
        >
          <span className="settings-language__icon" aria-hidden="true">
            <FileText size={20} />
          </span>
          <div className="settings-language__copy">
            <label htmlFor="content-language">{t("language.content")}</label>
            <p id="content-language-help">{t("language.contentHelp")}</p>
          </div>
          {contentLoading ? (
            <p className="settings-language__notice" role="status">
              {t("language.loadingBusiness")}
            </p>
          ) : businessId ? (
            <>
              <select
                id="content-language"
                value={contentLanguage}
                onChange={(event) =>
                  setContentLanguage(event.target.value as Language)
                }
                disabled={contentError || savingPreference !== null}
                aria-describedby="content-language-help"
                aria-invalid={contentError}
              >
                <option value="en">{t("common.english")}</option>
                <option value="es">{t("common.spanish")}</option>
              </select>
              {contentError ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={retryContent}
                >
                  {t("common.retry")}
                </button>
              ) : (
                <button
                  type="submit"
                  className="primary-button"
                  disabled={savingPreference !== null}
                >
                  {savingPreference === "content"
                    ? t("common.saving")
                    : t("language.saveContent")}
                </button>
              )}
              {feedbackFor("content", businessId)}
            </>
          ) : (
            <p className="settings-language__notice" role="status">
              {t("language.noBusiness")}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}

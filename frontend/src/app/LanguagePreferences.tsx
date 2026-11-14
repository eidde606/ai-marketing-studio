import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocalization } from "./localization";
import {
  getBusinessPreferences,
  updateBusinessPreferences,
  type Language,
} from "../services/accountApi";

export default function LanguagePreferences({
  businessId,
}: {
  businessId: string;
}) {
  const { account, saveAccountPreferences, t } = useLocalization();
  const [conversationPreference, setConversationPreference] = useState<{
    userId: string;
    language: Language;
  } | null>(null);
  const [contentLanguage, setContentLanguage] = useState<Language>("en");
  const [contentError, setContentError] = useState(false);
  const [loadedContentBusinessId, setLoadedContentBusinessId] = useState("");
  const [savingConversation, setSavingConversation] = useState(false);
  const [savingContent, setSavingContent] = useState(false);
  const [feedback, setFeedback] = useState<{
    businessId: string;
    message: string;
  } | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const activeBusinessId = useRef(businessId);
  const contentRequest = useRef(0);

  useEffect(() => {
    activeBusinessId.current = businessId;
  }, [businessId]);

  const conversationLanguage =
    conversationPreference && conversationPreference.userId === account?.user_id
      ? conversationPreference.language
      : (account?.preferences.conversation_language ?? "en");
  const contentLoading =
    Boolean(businessId) && loadedContentBusinessId !== businessId;
  const currentFeedback =
    feedback?.businessId === businessId ? feedback.message : "";

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

  async function saveConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingConversation(true);
    setFeedback(null);
    try {
      await saveAccountPreferences({
        conversation_language: conversationLanguage,
      });
      setFeedback({
        businessId,
        message: t("language.conversationSaved"),
      });
    } catch {
      setFeedback({ businessId, message: t("language.preferenceError") });
    } finally {
      setSavingConversation(false);
    }
  }

  async function saveContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessId) return;
    setSavingContent(true);
    setFeedback(null);
    try {
      const preferences = await updateBusinessPreferences(businessId, {
        marketing_content_language: contentLanguage,
      });
      if (activeBusinessId.current === businessId) {
        setContentLanguage(preferences.marketing_content_language);
        setFeedback({
          businessId,
          message: t("language.contentSaved"),
        });
      }
    } catch {
      if (activeBusinessId.current === businessId) {
        setFeedback({ businessId, message: t("language.preferenceError") });
      }
    } finally {
      setSavingContent(false);
    }
  }

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

      <form className="settings-language__form" onSubmit={saveConversation}>
        <label htmlFor="conversation-language">
          {t("language.conversation")}
        </label>
        <select
          id="conversation-language"
          value={conversationLanguage}
          onChange={(event) =>
            account &&
            setConversationPreference({
              userId: account.user_id,
              language: event.target.value as Language,
            })
          }
          disabled={savingConversation}
        >
          <option value="en">{t("common.english")}</option>
          <option value="es">{t("common.spanish")}</option>
        </select>
        <button type="submit" disabled={savingConversation}>
          {savingConversation
            ? t("common.saving")
            : t("language.saveConversation")}
        </button>
      </form>

      <form className="settings-language__form" onSubmit={saveContent}>
        <label htmlFor="content-language">{t("language.content")}</label>
        {contentLoading || loadedContentBusinessId !== businessId ? (
          <p role="status">{t("language.loadingBusiness")}</p>
        ) : businessId ? (
          <>
            <select
              id="content-language"
              value={contentLanguage}
              onChange={(event) =>
                setContentLanguage(event.target.value as Language)
              }
              disabled={contentError || savingContent}
              aria-invalid={contentError}
            >
              <option value="en">{t("common.english")}</option>
              <option value="es">{t("common.spanish")}</option>
            </select>
            {contentError ? (
              <div role="alert">
                <span>{t("language.preferenceError")}</span>
                <button
                  type="button"
                  onClick={() => {
                    setLoadedContentBusinessId("");
                    setContentError(false);
                    setRefreshVersion((value) => value + 1);
                  }}
                >
                  {t("common.retry")}
                </button>
              </div>
            ) : (
              <button type="submit" disabled={savingContent}>
                {savingContent ? t("common.saving") : t("language.saveContent")}
              </button>
            )}
          </>
        ) : (
          <p role="status">{t("language.noBusiness")}</p>
        )}
      </form>

      {currentFeedback && (
        <p
          className="settings-profile-feedback"
          role={
            currentFeedback === t("language.preferenceError")
              ? "alert"
              : "status"
          }
        >
          {currentFeedback}
        </p>
      )}
    </section>
  );
}

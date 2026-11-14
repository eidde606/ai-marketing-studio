import { useEffect, useState, type FormEvent } from "react";
import { useLocalization } from "../app/localization";
import {
  activateOnboarding,
  getOnboarding,
  saveOnboarding,
} from "../services/onboardingApi";
import type { Business, BusinessCreate } from "../services/businessesApi";

type Props = {
  onCreated: (business: Business) => void;
};

const initialProfile: BusinessCreate = {
  name: "",
  industry: "",
  description: "",
  website_url: "",
  service_area: "",
  products_services: "",
  target_audience: "",
  brand_voice: "",
  marketing_goals: "",
  preferred_platforms: "",
};

const goals = [
  ["awareness", "onboarding.goalAwareness"],
  ["products", "onboarding.goalProducts"],
  ["leads", "onboarding.goalLeads"],
  ["engagement", "onboarding.goalEngagement"],
  ["services", "onboarding.goalServices"],
] as const;

const platforms = [
  ["facebook", "Facebook"],
  ["instagram", "Instagram"],
  ["tiktok", "TikTok"],
] as const;

const stepMessages = [
  ["onboarding.step1Title", "onboarding.step1Description"],
  ["onboarding.step2Title", "onboarding.step2Description"],
  ["onboarding.step3Title", "onboarding.step3Description"],
  ["onboarding.step4Title", "onboarding.step4Description"],
  ["onboarding.step5Title", "onboarding.step5Description"],
  ["onboarding.step6Title", "onboarding.step6Description"],
] as const;

export default function OnboardingWizard({ onCreated }: Props) {
  const { locale, setInterfaceLanguage, t } = useLocalization();
  const [step, setStep] = useState(1);
  const [profile, setProfile] = useState<BusinessCreate>(initialProfile);
  const [conversationLanguage, setConversationLanguage] = useState<"en" | "es">(
    locale,
  );
  const [contentLanguage, setContentLanguage] = useState<"en" | "es">(locale);
  const [socialSkipped, setSocialSkipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getOnboarding()
      .then((saved) => {
        if (!active) return;
        setStep(saved.current_step);
        setProfile({ ...initialProfile, ...saved.business_profile });
        setConversationLanguage(saved.conversation_language);
        setContentLanguage(saved.marketing_content_language);
        setSocialSkipped(saved.social_accounts_skipped);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadAttempt]);

  function updateProfile<K extends keyof BusinessCreate>(
    key: K,
    value: BusinessCreate[K],
  ) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  async function saveStep(nextStep: number, skipped = socialSkipped) {
    setSaving(true);
    setError(null);
    try {
      await saveOnboarding({
        current_step: nextStep,
        business_profile: profile,
        interface_language: locale,
        conversation_language: conversationLanguage,
        marketing_content_language: contentLanguage,
        social_accounts_skipped: skipped,
      });
      setSocialSkipped(skipped);
      setStep(nextStep);
    } catch {
      setError(t("onboarding.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile.name?.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const business = await activateOnboarding({
        current_step: 6,
        business_profile: { ...profile, name: profile.name.trim() },
        interface_language: locale,
        conversation_language: conversationLanguage,
        marketing_content_language: contentLanguage,
        social_accounts_skipped: socialSkipped,
      });
      onCreated(business);
    } catch {
      setError(t("onboarding.activateError"));
    } finally {
      setSaving(false);
    }
  }

  function toggleList(
    field: "marketing_goals" | "preferred_platforms",
    value: string,
  ) {
    const current = (profile[field] ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
    updateProfile(field, next.join(", "));
  }

  if (loading) {
    return (
      <p className="panel" role="status">
        {t("onboarding.loading")}
      </p>
    );
  }
  if (loadFailed) {
    return (
      <main className="onboarding-page">
        <section
          className="panel onboarding-panel"
          aria-labelledby="onboarding-title"
        >
          <h1 id="onboarding-title">{t("onboarding.step1Title")}</h1>
          <p role="alert">{t("onboarding.loadError")}</p>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              setLoading(true);
              setLoadFailed(false);
              setError(null);
              setLoadAttempt((attempt) => attempt + 1);
            }}
          >
            {t("onboarding.retry")}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="onboarding-page">
      <section
        className="panel onboarding-panel"
        aria-labelledby="onboarding-title"
      >
        <p className="eyebrow">
          {t("onboarding.stepCount", { step, total: 6 })}
        </p>
        <h1 id="onboarding-title">{t(stepMessages[step - 1][0])}</h1>
        <p>{t(stepMessages[step - 1][1])}</p>

        {step === 1 && (
          <div className="onboarding-fields">
            <label htmlFor="onboarding-language">
              {t("language.interface")}
            </label>
            <select
              id="onboarding-language"
              value={locale}
              onChange={(event) => {
                const next = event.target.value as "en" | "es";
                void setInterfaceLanguage(next).catch(() =>
                  setError(t("language.updateError")),
                );
              }}
            >
              <option value="en">{t("common.english")}</option>
              <option value="es">{t("common.spanish")}</option>
            </select>
            <label htmlFor="onboarding-conversation-language">
              {t("language.conversation")}
            </label>
            <select
              id="onboarding-conversation-language"
              value={conversationLanguage}
              onChange={(event) =>
                setConversationLanguage(event.target.value as "en" | "es")
              }
            >
              <option value="en">{t("common.english")}</option>
              <option value="es">{t("common.spanish")}</option>
            </select>
            <label htmlFor="onboarding-content-language">
              {t("language.content")}
            </label>
            <select
              id="onboarding-content-language"
              value={contentLanguage}
              onChange={(event) =>
                setContentLanguage(event.target.value as "en" | "es")
              }
            >
              <option value="en">{t("common.english")}</option>
              <option value="es">{t("common.spanish")}</option>
            </select>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-fields">
            <label htmlFor="onboarding-business-name">
              {t("businessForm.name")} *
            </label>
            <input
              id="onboarding-business-name"
              required
              maxLength={120}
              value={profile.name ?? ""}
              onChange={(event) => updateProfile("name", event.target.value)}
            />
            <label htmlFor="onboarding-industry">
              {t("businessForm.industry")}
            </label>
            <input
              id="onboarding-industry"
              value={profile.industry ?? ""}
              onChange={(event) =>
                updateProfile("industry", event.target.value)
              }
            />
            <label htmlFor="onboarding-description">
              {t("businessForm.descriptionLabel")}
            </label>
            <textarea
              id="onboarding-description"
              value={profile.description ?? ""}
              onChange={(event) =>
                updateProfile("description", event.target.value)
              }
            />
            <label htmlFor="onboarding-website">
              {t("businessForm.website")}
            </label>
            <input
              id="onboarding-website"
              type="url"
              value={profile.website_url ?? ""}
              onChange={(event) =>
                updateProfile("website_url", event.target.value)
              }
            />
            <label htmlFor="onboarding-market">{t("businessForm.area")}</label>
            <input
              id="onboarding-market"
              value={profile.service_area ?? ""}
              onChange={(event) =>
                updateProfile("service_area", event.target.value)
              }
            />
          </div>
        )}

        {step === 3 && (
          <fieldset className="onboarding-choice-list">
            <legend>{t("onboarding.goalsLegend")}</legend>
            {goals.map(([value, key]) => (
              <label key={value}>
                <input
                  type="checkbox"
                  checked={(profile.marketing_goals ?? "")
                    .split(", ")
                    .includes(value)}
                  onChange={() => toggleList("marketing_goals", value)}
                />
                {t(key)}
              </label>
            ))}
          </fieldset>
        )}

        {step === 4 && (
          <div className="onboarding-fields">
            <label htmlFor="onboarding-audience">
              {t("businessForm.audience")}
            </label>
            <textarea
              id="onboarding-audience"
              value={profile.target_audience ?? ""}
              onChange={(event) =>
                updateProfile("target_audience", event.target.value)
              }
            />
            <fieldset className="onboarding-choice-list">
              <legend>{t("onboarding.platformsLegend")}</legend>
              {platforms.map(([value, label]) => (
                <label key={value}>
                  <input
                    type="checkbox"
                    checked={(profile.preferred_platforms ?? "")
                      .split(", ")
                      .includes(value)}
                    onChange={() => toggleList("preferred_platforms", value)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          </div>
        )}

        {step === 5 && (
          <div className="onboarding-social-note">
            <p>{t("onboarding.socialCapabilities")}</p>
            <ul>
              <li>{t("onboarding.socialFacebook")}</li>
              <li>{t("onboarding.socialInstagram")}</li>
              <li>{t("onboarding.socialTikTok")}</li>
            </ul>
            <p>{t("onboarding.socialSkipHelp")}</p>
          </div>
        )}

        {step === 6 && (
          <form onSubmit={handleActivate} className="onboarding-finish">
            <h2>{profile.name || t("onboarding.businessNameFallback")}</h2>
            <p>{t("onboarding.trialDisclosure")}</p>
            <button
              type="submit"
              className="primary-button"
              disabled={saving || !profile.name?.trim()}
            >
              {saving ? t("common.saving") : t("onboarding.finish")}
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className="onboarding-error">
            {error}
          </p>
        )}

        <div className="onboarding-actions">
          {step > 1 && (
            <button
              type="button"
              className="reject-button"
              disabled={saving}
              onClick={() => void saveStep(step - 1)}
            >
              {t("onboarding.back")}
            </button>
          )}
          {step < 5 && (
            <button
              type="button"
              className="primary-button"
              disabled={saving || (step === 2 && !profile.name?.trim())}
              onClick={() => void saveStep(step + 1)}
            >
              {saving ? t("common.saving") : t("onboarding.next")}
            </button>
          )}
          {step === 5 && (
            <>
              <button
                type="button"
                className="reject-button"
                disabled={saving}
                onClick={() => void saveStep(6, true)}
              >
                {t("onboarding.skipSocial")}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={saving}
                onClick={() => void saveStep(6, false)}
              >
                {t("onboarding.continue")}
              </button>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Facebook, Settings2, UserRound } from "lucide-react";
import { useLocalization } from "../app/localization";
import {
  AccountStatusNotice,
  CapabilityStatus,
} from "../app/ProductStatus";
import type { FeatureAvailability } from "../services/accountApi";

type SettingsTab = "account" | "integrations";

type Props = {
  businessId: string;
  userDisplayName: string;
  userEmail: string;
  onSaveDisplayName: (displayName: string) => Promise<string>;
  canManageConnections?: boolean;
  languagePreferences?: ReactNode;
  features?: FeatureAvailability;
  facebookConnection: ReactNode;
  instagramConnection?: ReactNode;
  tiktokConnection: ReactNode;
};

export default function SettingsPage({
  businessId,
  userDisplayName,
  userEmail,
  onSaveDisplayName,
  canManageConnections = false,
  languagePreferences,
  features,
  facebookConnection,
  instagramConnection,
  tiktokConnection,
}: Props) {
  const { t } = useLocalization();
  const [activeTab, setActiveTab] = useState<SettingsTab>("account");
  const initialName =
    userDisplayName === t("shell.myAccount") ? "" : userDisplayName;
  const [displayName, setDisplayName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "error" | "success";
    message: string;
  } | null>(null);
  const savingRef = useRef(false);
  const changed = displayName !== savedName;
  const maxNameLength = 80;

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || !changed) return;

    const normalized = displayName.trim();
    if (!normalized) {
      setFeedback({ type: "error", message: t("settings.displayNameRequired") });
      return;
    }
    if (normalized.length > maxNameLength) {
      setFeedback({
        type: "error",
        message: t("settings.displayNameTooLong"),
      });
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setFeedback(null);
    try {
      const saved = await onSaveDisplayName(normalized);
      setDisplayName(saved);
      setSavedName(saved);
      setFeedback({
        type: "success",
        message: t("settings.displayNameSaved"),
      });
    } catch {
      setFeedback({
        type: "error",
        message: t("settings.displayNameSaveError"),
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="settings-workspace">
      <section className="page-intro">
        <div>
          <span className="eyebrow">{t("settings.introEyebrow")}</span>
          <h2>{t("settings.introTitle")}</h2>
          <p>{t("settings.introDescription")}</p>
        </div>
      </section>

      <div className="settings-layout">
        <nav
          className="settings-nav"
          aria-label={t("settings.integrationNavigation")}
        >
          <button
            type="button"
            className={activeTab === "account" ? "is-active" : ""}
            aria-current={activeTab === "account" ? "page" : undefined}
            onClick={() => setActiveTab("account")}
          >
            <UserRound size={18} aria-hidden="true" />
            {t("settings.accountTab")}
          </button>
          <button
            type="button"
            className={activeTab === "integrations" ? "is-active" : ""}
            aria-current={activeTab === "integrations" ? "page" : undefined}
            onClick={() => setActiveTab("integrations")}
          >
            <Settings2 size={18} aria-hidden="true" />
            {t("settings.integrationsTab")}
          </button>
        </nav>

        {activeTab === "account" ? (
          <section className="settings-account panel" aria-labelledby="account-title">
            <div className="settings-section-heading">
              <span className="settings-section-icon" aria-hidden="true">
                <UserRound size={20} />
              </span>
              <div>
                <h3 id="account-title">{t("settings.accountTitle")}</h3>
                <p>{t("settings.accountDescription")}</p>
              </div>
            </div>
            <AccountStatusNotice
              title={t("account.statusActive")}
              description={t("account.statusActiveHelp")}
            />
            <form className="settings-profile-form" onSubmit={handleSave}>
              <label htmlFor="account-display-name">
                {t("settings.displayName")}
              </label>
              <input
                id="account-display-name"
                name="displayName"
                type="text"
                autoComplete="nickname"
                placeholder={t("settings.displayNamePlaceholder")}
                value={displayName}
                maxLength={maxNameLength}
                aria-invalid={feedback?.type === "error"}
                aria-describedby="account-display-name-help"
                disabled={saving}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  setFeedback(null);
                }}
              />
              <small id="account-display-name-help">
                {t("settings.displayNameHelp")}
              </small>
              <button
                type="submit"
                className="primary-button"
                disabled={!changed || saving}
              >
                {saving ? t("common.saving") : t("common.save")}
              </button>
              {saving && (
                <p className="settings-profile-feedback" role="status">
                  {t("common.saving")}
                </p>
              )}
              {feedback && (
                <p
                  className={`settings-profile-feedback settings-profile-feedback--${feedback.type}`}
                  role={feedback.type === "error" ? "alert" : "status"}
                >
                  {feedback.message}
                </p>
              )}
            </form>
            <dl className="settings-account-details">
              <div>
                <dt>{t("settings.email")}</dt>
                <dd>{userEmail || t("settings.emailUnavailable")}</dd>
              </div>
            </dl>
            <p className="settings-note" role="note">
              {t("settings.profileNote")}
            </p>
            {languagePreferences}
          </section>
        ) : (
          <section className="settings-integrations" aria-labelledby="integrations-title">
            <header className="settings-integrations-heading">
              <div className="settings-section-icon" aria-hidden="true">
                <Facebook size={20} />
              </div>
              <div>
                <h3 id="integrations-title">{t("settings.socialTitle")}</h3>
                <p>
                  {t("settings.socialDescription")}
                  {businessId ? "" : ` ${t("settings.selectBusiness")}`}
                </p>
              </div>
            </header>
            {!businessId && (
              <p className="settings-note" role="status">
                {t("settings.noBusiness")}
              </p>
            )}
            {features && (
              <section
                className="settings-capabilities"
                aria-labelledby="feature-availability-title"
              >
                <h4 id="feature-availability-title">
                  {t("settings.featuresTitle")}
                </h4>
                <ul>
                  <CapabilityStatus
                    label={t("settings.facebookPublishing")}
                    available={features.facebook_publishing}
                    availableText={t("capability.available")}
                    unavailableText={t("capability.unavailable")}
                  />
                  <CapabilityStatus
                    label={t("settings.tiktokDirect")}
                    available={features.tiktok_direct_publishing}
                    availableText={t("capability.available")}
                    unavailableText={t("capability.unavailable")}
                  />
                  <CapabilityStatus
                    label={t("settings.tiktokManual")}
                    available={features.tiktok_manual_export}
                    availableText={t("capability.available")}
                    unavailableText={t("capability.unavailable")}
                  />
                  <CapabilityStatus
                    label={t("settings.instagramConnection")}
                    available={features.instagram_connection}
                    availableText={t("capability.available")}
                    unavailableText={t("capability.unavailable")}
                  />
                  <CapabilityStatus
                    label={t("settings.instagramPublishing")}
                    available={features.instagram_publishing}
                    availableText={t("capability.available")}
                    unavailableText={t("capability.unavailable")}
                  />
                  <CapabilityStatus
                    label={t("settings.miaAnalysis")}
                    available={features.mia_analysis}
                    availableText={t("capability.available")}
                    unavailableText={t("capability.unavailable")}
                  />
                </ul>
              </section>
            )}
            {canManageConnections ? (
              <div className="settings-integration-list">
                {facebookConnection}
                {instagramConnection}
                {tiktokConnection}
              </div>
            ) : (
              <p className="settings-note" role="note">
                {t("settings.connectionsRestricted")}
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

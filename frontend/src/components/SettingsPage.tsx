import { useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  BookOpen,
  Building2,
  Facebook,
  Settings2,
  UserRound,
} from "lucide-react";
import { useLocalization } from "../app/localization";
import { AccountStatusNotice, CapabilityStatus } from "../app/ProductStatus";
import type { FeatureAvailability } from "../services/accountApi";
import type { Business, BusinessUpdate } from "../services/businessesApi";

type SettingsTab = "account" | "integrations";
type BusinessProfileState = {
  businessId: string;
  values: BusinessUpdate;
};
type BusinessErrorState = {
  businessId: string;
  message: string;
};

type Props = {
  businessId: string;
  userDisplayName: string;
  userEmail: string;
  onSaveDisplayName: (displayName: string) => Promise<string>;
  business?: Business | null;
  membershipRole?: "owner" | "admin" | "member" | null;
  canEditBusiness?: boolean;
  onSaveBusiness?: (values: BusinessUpdate) => Promise<void>;
  onReplayTutorial?: () => void;
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
  business = null,
  membershipRole = null,
  canEditBusiness = false,
  onSaveBusiness = async () => {},
  onReplayTutorial = () => {},
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
  const [businessProfileState, setBusinessProfileState] =
    useState<BusinessProfileState | null>(null);
  const [businessSaving, setBusinessSaving] = useState(false);
  const [businessErrorState, setBusinessErrorState] =
    useState<BusinessErrorState | null>(null);
  const [businessSavedFor, setBusinessSavedFor] = useState<string | null>(null);
  const initialBusinessProfile: BusinessUpdate = business
    ? {
        name: business.name,
        industry: business.industry,
        description: business.description,
        website_url: business.website_url,
        service_area: business.service_area,
        products_services: business.products_services,
        target_audience: business.target_audience,
        marketing_goals: business.marketing_goals,
        preferred_platforms: business.preferred_platforms,
        brand_voice: business.brand_voice,
      }
    : {};
  const businessProfile =
    businessProfileState && businessProfileState.businessId === business?.id
      ? businessProfileState.values
      : initialBusinessProfile;
  const businessError =
    businessErrorState && businessErrorState.businessId === business?.id
      ? businessErrorState.message
      : "";
  const businessSaved = !!business && businessSavedFor === business.id;

  function updateBusinessProfile<K extends keyof BusinessUpdate>(
    key: K,
    value: BusinessUpdate[K],
  ) {
    if (!business) return;
    setBusinessProfileState((current) => ({
      businessId: business.id,
      values: {
        ...(current?.businessId === business.id
          ? current.values
          : initialBusinessProfile),
        [key]: value,
      },
    }));
    setBusinessErrorState(null);
    setBusinessSavedFor(null);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || !changed) return;

    const normalized = displayName.trim();
    if (!normalized) {
      setFeedback({
        type: "error",
        message: t("settings.displayNameRequired"),
      });
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

  async function handleBusinessSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (businessSaving || !business || !canEditBusiness) return;
    if (!businessProfile.name?.trim()) {
      setBusinessErrorState({
        businessId: business.id,
        message: t("settings.businessNameRequired"),
      });
      return;
    }
    setBusinessSaving(true);
    setBusinessErrorState(null);
    setBusinessSavedFor(null);
    try {
      await onSaveBusiness({
        ...businessProfile,
        name: businessProfile.name.trim(),
      });
      setBusinessSavedFor(business.id);
    } catch {
      setBusinessErrorState({
        businessId: business.id,
        message: t("settings.businessSaveError"),
      });
    } finally {
      setBusinessSaving(false);
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
          <section
            className="settings-account panel"
            aria-labelledby="account-title"
          >
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
              {membershipRole && (
                <div>
                  <dt>{t("settings.membershipRole")}</dt>
                  <dd>
                    {membershipRole === "owner"
                      ? t("settings.role.owner")
                      : membershipRole === "admin"
                        ? t("settings.role.admin")
                        : t("settings.role.member")}
                  </dd>
                </div>
              )}
            </dl>
            <p className="settings-note" role="note">
              {t("settings.profileNote")}
            </p>
            {languagePreferences}
            {business && (
              <section
                className="settings-business-profile"
                aria-labelledby="business-profile-title"
              >
                <div className="settings-section-heading">
                  <Building2 size={20} aria-hidden="true" />
                  <div>
                    <h3 id="business-profile-title">
                      {t("settings.businessProfile")}
                    </h3>
                    <p>{t("settings.businessProfileHelp")}</p>
                  </div>
                </div>
                <form
                  className="settings-profile-form"
                  onSubmit={handleBusinessSave}
                >
                  <label htmlFor="settings-business-name">
                    {t("businessForm.name")} *
                  </label>
                  <input
                    id="settings-business-name"
                    value={businessProfile.name ?? ""}
                    maxLength={120}
                    disabled={!canEditBusiness || businessSaving}
                    onChange={(event) =>
                      updateBusinessProfile("name", event.target.value)
                    }
                  />
                  <label htmlFor="settings-business-industry">
                    {t("businessForm.industry")}
                  </label>
                  <input
                    id="settings-business-industry"
                    value={businessProfile.industry ?? ""}
                    disabled={!canEditBusiness || businessSaving}
                    onChange={(event) =>
                      updateBusinessProfile("industry", event.target.value)
                    }
                  />
                  <label htmlFor="settings-business-description">
                    {t("businessForm.descriptionLabel")}
                  </label>
                  <textarea
                    id="settings-business-description"
                    value={businessProfile.description ?? ""}
                    disabled={!canEditBusiness || businessSaving}
                    onChange={(event) =>
                      updateBusinessProfile("description", event.target.value)
                    }
                  />
                  <label htmlFor="settings-business-website">
                    {t("businessForm.website")}
                  </label>
                  <input
                    id="settings-business-website"
                    type="url"
                    value={businessProfile.website_url ?? ""}
                    disabled={!canEditBusiness || businessSaving}
                    onChange={(event) =>
                      updateBusinessProfile("website_url", event.target.value)
                    }
                  />
                  {!canEditBusiness && (
                    <p role="note">{t("settings.businessEditRestricted")}</p>
                  )}
                  {businessError && <p role="alert">{businessError}</p>}
                  {businessSaved && (
                    <p role="status">{t("settings.businessSaved")}</p>
                  )}
                  {canEditBusiness && (
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={businessSaving}
                    >
                      {businessSaving ? t("common.saving") : t("common.save")}
                    </button>
                  )}
                </form>
              </section>
            )}
            <button
              type="button"
              className="reject-button settings-tutorial-button"
              onClick={onReplayTutorial}
            >
              <BookOpen size={18} aria-hidden="true" />
              {t("tutorial.replay")}
            </button>
          </section>
        ) : (
          <section
            className="settings-integrations"
            aria-labelledby="integrations-title"
          >
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

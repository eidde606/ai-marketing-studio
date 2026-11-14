import type { ReactNode } from "react";
import type { Campaign } from "../../services/campaignsApi";
import { useLocalization } from "../../app/localization";
import {
  draftTranslationKeys,
  formatCampaignDate,
  statusTranslationKeys,
} from "./campaignLabels";

type Props = {
  campaign: Campaign;
  busy: boolean;
  onEdit: () => void;
  onDetach: (id: string) => Promise<void>;
  children: ReactNode;
};

export default function CampaignDetails({
  campaign,
  busy,
  onEdit,
  onDetach,
  children,
}: Props) {
  const { locale, t } = useLocalization();
  return (
    <section className="panel campaign-detail">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            {t(statusTranslationKeys[campaign.status])}
          </span>
          <h2>{campaign.name}</h2>
        </div>
        <button
          className="outline-button"
          type="button"
          disabled={busy}
          onClick={onEdit}
        >
          {t("campaigns.edit")}
        </button>
      </div>
      <p className="campaign-objective">{campaign.objective}</p>
      <p>
        {formatCampaignDate(campaign.start_date, locale) ??
          t("campaigns.dateUnavailable")}{" "}
        →{" "}
        {formatCampaignDate(campaign.end_date, locale) ??
          t("campaigns.dateUnavailable")}
      </p>
      <progress
        max={100}
        value={campaign.progress}
        aria-label={t("campaigns.publishProgress")}
      />
      <p>
        <strong>{campaign.progress}%</strong> ·{" "}
        {t("campaigns.publishedCount", { count: campaign.published_count })} ·{" "}
        {t("campaigns.pendingCount", { count: campaign.pending_count })} ·{" "}
        {t("campaigns.rejectedCount", { count: campaign.rejected_count })}
      </p>
      <p className="campaign-note">{t("campaigns.confirmedProgress")}</p>
      {children}
      <h3>{t("campaigns.associatedContent")}</h3>
      {!campaign.drafts.length && (
        <p>{t("campaigns.noCountableContent")}</p>
      )}
      <ul className="campaign-contents">
        {campaign.drafts.map((draft) => (
          <li key={draft.id}>
            <div>
              <strong>{draft.title}</strong>
              <span>
                {t(
                  draft.published
                    ? "campaigns.postStatus.published"
                    : "campaigns.postStatus.pending",
                )}{" "}
                ·{" "}
                {draftTranslationKeys[
                  draft.status as keyof typeof draftTranslationKeys
                ]
                  ? t(
                      draftTranslationKeys[
                        draft.status as keyof typeof draftTranslationKeys
                      ],
                    )
                  : draft.status}
                {draft.deleted_at
                  ? ` · ${t("campaigns.deletedHistory")}`
                  : ""}
              </span>
            </div>
            <button
              className="outline-button"
              type="button"
              disabled={busy}
              aria-label={t("campaigns.detachDraft", {
                title: draft.title,
              })}
              onClick={() => void onDetach(draft.id)}
            >
              {t("campaigns.detach")}
            </button>
          </li>
        ))}
      </ul>
      <p className="campaign-note">{t("campaigns.approvalLocation")}</p>
    </section>
  );
}

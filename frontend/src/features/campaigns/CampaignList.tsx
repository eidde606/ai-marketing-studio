import type { Campaign } from "../../services/campaignsApi";
import { useLocalization } from "../../app/localization";
import { statusTranslationKeys } from "./campaignLabels";

type Props = {
  campaigns: Campaign[];
  selectedId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
};

export default function CampaignList({
  campaigns,
  selectedId,
  busy,
  onSelect,
}: Props) {
  const { t } = useLocalization();
  return (
    <div className="campaign-list">
      {campaigns.map((campaign) => (
        <button
          type="button"
          key={campaign.id}
          className={`campaign-summary ${selectedId === campaign.id ? "is-selected" : ""}`}
          aria-pressed={selectedId === campaign.id}
          disabled={busy}
          onClick={() => onSelect(campaign.id)}
        >
          <strong>{campaign.name}</strong>
          <span>{t(statusTranslationKeys[campaign.status])}</span>
          <progress
            max={100}
            value={campaign.progress}
            aria-label={t("campaigns.progressLabel", {
              name: campaign.name,
            })}
          />
          <span>
            {t("campaigns.published", {
              progress: campaign.progress,
              published: campaign.published_count,
              total: campaign.total_count,
            })}
          </span>
          <small>
            {t("campaigns.pendingRejected", {
              pending: campaign.pending_count,
              rejected: campaign.rejected_count,
            })}
          </small>
        </button>
      ))}
    </div>
  );
}

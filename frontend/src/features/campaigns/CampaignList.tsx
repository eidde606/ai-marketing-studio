import type { Campaign } from "../../services/campaignsApi";
import { statusLabels } from "./campaignLabels";

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
          <span>{statusLabels[campaign.status]}</span>
          <progress
            max={100}
            value={campaign.progress}
            aria-label={`Progreso de ${campaign.name}`}
          />
          <span>
            {campaign.progress}% · {campaign.published_count} publicados de{" "}
            {campaign.total_count}
          </span>
          <small>
            {campaign.pending_count} pendientes · {campaign.rejected_count}{" "}
            rechazados
          </small>
        </button>
      ))}
    </div>
  );
}

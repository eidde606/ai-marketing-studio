import type { ReactNode } from "react";
import type { Campaign } from "../../services/campaignsApi";
import { statusLabels, draftLabels, dateLabel } from "./campaignLabels";

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
  return (
    <section className="panel campaign-detail">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{statusLabels[campaign.status]}</span>
          <h2>{campaign.name}</h2>
        </div>
        <button
          className="outline-button"
          type="button"
          disabled={busy}
          onClick={onEdit}
        >
          Editar campaña
        </button>
      </div>
      <p className="campaign-objective">{campaign.objective}</p>
      <p>
        {dateLabel(campaign.start_date)} → {dateLabel(campaign.end_date)}
      </p>
      <progress
        max={100}
        value={campaign.progress}
        aria-label="Progreso de publicación"
      />
      <p>
        <strong>{campaign.progress}%</strong> · {campaign.published_count}{" "}
        publicados · {campaign.pending_count} pendientes de publicación ·{" "}
        {campaign.rejected_count} rechazados
      </p>
      <p className="campaign-note">
        Solo cuentan las publicaciones confirmadas en Facebook o TikTok, una vez
        por contenido. Aprobar, descargar o copiar no cuenta como publicar. Los
        rechazados siguen pendientes; los eliminados sin publicar se excluyen.
      </p>
      {children}
      <h3>Contenido asociado</h3>
      {!campaign.drafts.length && (
        <p>Esta campaña no tiene contenido contabilizable todavía.</p>
      )}
      <ul className="campaign-contents">
        {campaign.drafts.map((draft) => (
          <li key={draft.id}>
            <div>
              <strong>{draft.title}</strong>
              <span>
                {draft.published ? "Publicado" : "Pendiente de publicación"} ·{" "}
                {draftLabels[draft.status] ?? draft.status}
                {draft.deleted_at ? " · Eliminado (historial conservado)" : ""}
              </span>
            </div>
            <button
              className="outline-button"
              type="button"
              disabled={busy}
              aria-label={`Desvincular ${draft.title}`}
              onClick={() => void onDetach(draft.id)}
            >
              Desvincular
            </button>
          </li>
        ))}
      </ul>
      <p className="campaign-note">
        Gestiona las aprobaciones y publicaciones desde Aprobaciones. Para
        archivar esta campaña, cambia su estado en Editar campaña.
      </p>
    </section>
  );
}

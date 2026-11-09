import type { Draft } from "../../services/draftsApi";
import { draftLabels } from "./campaignLabels";

type Props = {
  availableDrafts: Draft[];
  draftId: string;
  busy: boolean;
  onSelect: (id: string) => void;
  onAssociate: (id: string) => Promise<void>;
};

export default function CampaignDraftAssociation({
  availableDrafts,
  draftId,
  busy,
  onSelect,
  onAssociate,
}: Props) {
  return (
    <>
      <div className="campaign-associate">
        <label htmlFor="campaign-content">Asociar contenido existente</label>
        <select
          id="campaign-content"
          value={draftId}
          disabled={busy}
          onChange={(e) => onSelect(e.target.value)}
        >
          <option value="">Selecciona contenido sin campaña</option>
          {availableDrafts.map((draft) => (
            <option key={draft.id} value={draft.id}>
              {draft.title} — {draftLabels[draft.status] ?? draft.status}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="primary-button"
          disabled={busy || !draftId}
          onClick={() => void onAssociate(draftId)}
        >
          Asociar
        </button>
      </div>
      {!availableDrafts.length && (
        <p className="campaign-note">
          No hay contenido disponible sin campaña. Puedes crear contenido con
          Sofía y Leo o desvincularlo de otra campaña.
        </p>
      )}
    </>
  );
}

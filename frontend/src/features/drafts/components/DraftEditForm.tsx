import type { Dispatch, SetStateAction } from "react";
import type { Draft } from "../../../services/draftsApi";
type Props = {
  draft: Draft;
  editTitle: string;
  editCaption: string;
  setEditTitle: Dispatch<SetStateAction<string>>;
  setEditCaption: Dispatch<SetStateAction<string>>;
  busyDraftIds: string[];
  handleSaveEdit: (id: string) => Promise<void>;
  setEditingId: Dispatch<SetStateAction<string | null>>;
};
export function DraftEditForm({
  draft,
  editTitle,
  editCaption,
  setEditTitle,
  setEditCaption,
  busyDraftIds,
  handleSaveEdit,
  setEditingId,
}: Props) {
  return (
    <div
      className="draft-edit-form"
      style={{
        display: "grid",
        gap: "0.75rem",
        marginTop: "1rem",
      }}
    >
      <label htmlFor={`edit-title-${draft.id}`}>Título</label>

      <input
        id={`edit-title-${draft.id}`}
        value={editTitle}
        onChange={(event) => setEditTitle(event.target.value)}
        maxLength={200}
        style={{
          width: "100%",
          padding: "0.6rem",
        }}
      />

      <label htmlFor={`edit-caption-${draft.id}`}>
        Texto de la publicación
      </label>

      <textarea
        id={`edit-caption-${draft.id}`}
        value={editCaption}
        onChange={(event) => setEditCaption(event.target.value)}
        rows={6}
        style={{
          width: "100%",
          padding: "0.6rem",
        }}
      />

      <div className="approval-actions">
        <button
          className="approve-button"
          type="button"
          disabled={
            busyDraftIds.includes(draft.id) ||
            !editTitle.trim() ||
            !editCaption.trim()
          }
          onClick={() => void handleSaveEdit(draft.id)}
        >
          {busyDraftIds.includes(draft.id) ? "Guardando..." : "Guardar cambios"}
        </button>

        <button
          className="text-button"
          type="button"
          disabled={busyDraftIds.includes(draft.id)}
          onClick={() => setEditingId(null)}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

import type { FormEvent } from "react";
import type {
  CampaignInput,
  CampaignStatus,
} from "../../services/campaignsApi";
import { statusLabels } from "./campaignLabels";

type Props = {
  form: CampaignInput;
  isEditing: boolean;
  busy: boolean;
  onChange: (form: CampaignInput) => void;
  onSave: (event: FormEvent) => Promise<void>;
  onCancel: () => void;
  onDelete: () => Promise<void>;
};

export default function CampaignForm({
  form,
  isEditing,
  busy,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: Props) {
  return (
    <section className="panel business-form-panel campaign-form">
      <h2>{isEditing ? "Editar campaña" : "Nueva campaña"}</h2>
      <form onSubmit={(event) => void onSave(event)}>
        <fieldset disabled={busy}>
          <label htmlFor="campaign-name">Nombre *</label>
          <input
            id="campaign-name"
            required
            maxLength={120}
            value={form.name}
            onChange={(e) => onChange({ ...form, name: e.target.value })}
          />
          <label htmlFor="campaign-objective">Objetivo *</label>
          <textarea
            id="campaign-objective"
            required
            maxLength={2000}
            value={form.objective}
            onChange={(e) => onChange({ ...form, objective: e.target.value })}
          />
          <label htmlFor="campaign-status">Estado</label>
          <select
            id="campaign-status"
            value={form.status}
            onChange={(e) =>
              onChange({ ...form, status: e.target.value as CampaignStatus })
            }
          >
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label htmlFor="campaign-start">Fecha inicial (opcional)</label>
          <input
            id="campaign-start"
            type="date"
            value={form.start_date ?? ""}
            onChange={(e) =>
              onChange({ ...form, start_date: e.target.value || null })
            }
          />
          <label htmlFor="campaign-end">Fecha final (opcional)</label>
          <input
            id="campaign-end"
            type="date"
            min={form.start_date ?? undefined}
            value={form.end_date ?? ""}
            onChange={(e) =>
              onChange({ ...form, end_date: e.target.value || null })
            }
          />
          <div className="campaign-actions">
            <button
              className="primary-button"
              type="submit"
              disabled={!form.name.trim() || !form.objective.trim()}
            >
              {busy ? "Guardando..." : "Guardar campaña"}
            </button>
            <button
              className="outline-button"
              type="button"
              disabled={busy}
              onClick={onCancel}
            >
              Cancelar
            </button>
            {isEditing && (
              <button
                className="danger-button"
                type="button"
                disabled={busy}
                onClick={() => void onDelete()}
              >
                {busy ? "Eliminando..." : "Eliminar campaña"}
              </button>
            )}
          </div>
        </fieldset>
      </form>
    </section>
  );
}

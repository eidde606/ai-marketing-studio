import type { FormEvent } from "react";
import { LoaderCircle, Trash2, X } from "lucide-react";
import type {
  CampaignInput,
  CampaignStatus,
} from "../../services/campaignsApi";
import { useLocalization } from "../../app/useLocalization";
import { statusTranslationKeys } from "./campaignLabels";

type Props = {
  form: CampaignInput;
  isEditing: boolean;
  busy: boolean;
  onChange: (form: CampaignInput) => void;
  onSave: (event: FormEvent) => Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
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
  const { t } = useLocalization();
  return (
    <section className="panel business-form-panel campaign-form">
      <h2>{t(isEditing ? "campaigns.edit" : "campaigns.new")}</h2>
      <form onSubmit={(event) => void onSave(event)}>
        <fieldset disabled={busy}>
          <label htmlFor="campaign-name">{t("campaigns.name")} *</label>
          <input
            id="campaign-name"
            required
            maxLength={120}
            value={form.name}
            onChange={(e) => onChange({ ...form, name: e.target.value })}
          />
          <label htmlFor="campaign-objective">
            {t("campaigns.objective")} *
          </label>
          <textarea
            id="campaign-objective"
            required
            maxLength={2000}
            value={form.objective}
            onChange={(e) => onChange({ ...form, objective: e.target.value })}
          />
          <label htmlFor="campaign-status">{t("campaigns.status")}</label>
          <select
            id="campaign-status"
            value={form.status}
            onChange={(e) =>
              onChange({ ...form, status: e.target.value as CampaignStatus })
            }
          >
            {(
              ["draft", "active", "paused", "completed", "archived"] as const
            ).map((status) => (
              <option key={status} value={status}>
                {t(statusTranslationKeys[status])}
              </option>
            ))}
          </select>
          <label htmlFor="campaign-start">{t("campaigns.startDate")}</label>
          <input
            id="campaign-start"
            type="date"
            value={form.start_date ?? ""}
            onChange={(e) =>
              onChange({ ...form, start_date: e.target.value || null })
            }
          />
          <label htmlFor="campaign-end">{t("campaigns.endDate")}</label>
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
              aria-busy={busy}
            >
              {busy && (
                <LoaderCircle
                  size={16}
                  className="campaign-save-spinner"
                  aria-hidden="true"
                />
              )}
              {busy ? t("campaigns.saving") : t("campaigns.save")}
            </button>
            <button
              className="outline-button"
              type="button"
              disabled={busy}
              onClick={onCancel}
            >
              <X size={16} aria-hidden="true" />
              {t("campaigns.cancel")}
            </button>
            {isEditing && (
              <button
                className="outline-button campaign-delete-button"
                type="button"
                disabled={busy}
                onClick={() => void onDelete()}
              >
                <Trash2 size={16} aria-hidden="true" />
                {t("campaigns.delete")}
              </button>
            )}
          </div>
        </fieldset>
      </form>
    </section>
  );
}

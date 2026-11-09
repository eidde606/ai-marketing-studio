import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  createCampaign,
  getCampaigns,
  setCampaignDraft,
  updateCampaign,
  type Campaign,
  type CampaignInput,
  type CampaignStatus,
} from "../services/campaignsApi";
import { getDrafts, type Draft } from "../services/draftsApi";

const statusLabels: Record<CampaignStatus, string> = {
  draft: "Borrador",
  active: "Activa",
  paused: "Pausada",
  completed: "Completada",
  archived: "Archivada",
};
const draftLabels: Record<string, string> = {
  pending: "Pendiente de aprobación",
  approved: "Aprobado",
  rejected: "Rechazado",
};
const emptyForm: CampaignInput = {
  name: "",
  objective: "",
  status: "draft",
  start_date: null,
  end_date: null,
};
const dateLabel = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(
        new Date(`${value}T12:00:00`),
      )
    : "Sin fecha";

export default function CampaignsPage({ businessId }: { businessId: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<CampaignInput | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const mutationLock = useRef(false);
  const selected = campaigns.find((campaign) => campaign.id === selectedId);
  const availableDrafts = drafts.filter(
    (draft) => !draft.deleted_at && !draft.campaign_id,
  );

  useEffect(() => {
    let active = true;
    mounted.current = true;
    if (!businessId) {
      return () => {
        mounted.current = false;
      };
    }
    Promise.all([getCampaigns(businessId), getDrafts(businessId)])
      .then(([items, content]) => {
        if (!active) return;
        setCampaigns(items);
        setDrafts(content);
        setSelectedId(items[0]?.id ?? null);
      })
      .catch(() => {
        if (active)
          setError("No se pudieron cargar las campañas. Inténtalo de nuevo.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [businessId]);

  async function perform(action: () => Promise<void>) {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      if (mounted.current)
        setError(
          err instanceof Error ? err.message : "No se pudo guardar la campaña.",
        );
    } finally {
      mutationLock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function replaceCampaign(campaign: Campaign) {
    setCampaigns((current) =>
      current.some((item) => item.id === campaign.id)
        ? current.map((item) => (item.id === campaign.id ? campaign : item))
        : [campaign, ...current],
    );
  }

  async function refresh() {
    await perform(async () => {
      const [items, content] = await Promise.all([
        getCampaigns(businessId),
        getDrafts(businessId),
      ]);
      if (!mounted.current) return;
      setCampaigns(items);
      setDrafts(content);
      setSelectedId((current) =>
        items.some((item) => item.id === current)
          ? current
          : (items[0]?.id ?? null),
      );
      setDraftId("");
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    await perform(async () => {
      const input = {
        ...form,
        name: form.name.trim(),
        objective: form.objective.trim(),
      };
      const saved = editingId
        ? await updateCampaign(businessId, editingId, input)
        : await createCampaign(businessId, input);
      if (!mounted.current) return;
      replaceCampaign(saved);
      setSelectedId(saved.id);
      setForm(null);
      setDraftId("");
    });
  }

  async function associate(id: string, attach: boolean) {
    if (!selected) return;
    await perform(async () => {
      const saved = await setCampaignDraft(businessId, selected.id, id, attach);
      if (!mounted.current) return;
      replaceCampaign(saved);
      setDrafts((current) =>
        current.map((draft) =>
          draft.id === id
            ? { ...draft, campaign_id: attach ? selected.id : null }
            : draft,
        ),
      );
      setDraftId("");
    });
  }

  if (!businessId)
    return (
      <section className="panel">
        Selecciona un negocio para gestionar sus campañas.
      </section>
    );

  return (
    <div className="campaign-page">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Planificación de marketing</span>
            <h2>Campañas</h2>
            <p>
              Organiza el contenido de tu negocio y sigue sus publicaciones.
            </p>
          </div>
          <div className="campaign-actions">
            <button
              type="button"
              className="outline-button"
              disabled={busy || loading}
              onClick={() => void refresh()}
            >
              Actualizar
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={busy || loading}
              onClick={() => {
                setEditingId(null);
                setForm({ ...emptyForm });
                setError(null);
              }}
            >
              Nueva campaña
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className="campaign-error">
            {error}
          </p>
        )}
        {loading && <p role="status">Cargando campañas...</p>}
        {!loading && !campaigns.length && (
          <p>
            No hay campañas todavía. Crea la primera para organizar tu
            contenido.
          </p>
        )}
        <div className="campaign-list">
          {campaigns.map((campaign) => (
            <button
              type="button"
              key={campaign.id}
              className={`campaign-summary ${selectedId === campaign.id ? "is-selected" : ""}`}
              aria-pressed={selectedId === campaign.id}
              disabled={busy}
              onClick={() => {
                setSelectedId(campaign.id);
                setDraftId("");
                setForm(null);
              }}
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
      </section>

      {form && (
        <section className="panel business-form-panel campaign-form">
          <h2>{editingId ? "Editar campaña" : "Nueva campaña"}</h2>
          <form onSubmit={(event) => void save(event)}>
            <fieldset disabled={busy}>
              <label htmlFor="campaign-name">Nombre *</label>
              <input
                id="campaign-name"
                required
                maxLength={120}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <label htmlFor="campaign-objective">Objetivo *</label>
              <textarea
                id="campaign-objective"
                required
                maxLength={2000}
                value={form.objective}
                onChange={(e) =>
                  setForm({ ...form, objective: e.target.value })
                }
              />
              <label htmlFor="campaign-status">Estado</label>
              <select
                id="campaign-status"
                value={form.status}
                onChange={(e) =>
                  setForm({ ...form, status: e.target.value as CampaignStatus })
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
                  setForm({ ...form, start_date: e.target.value || null })
                }
              />
              <label htmlFor="campaign-end">Fecha final (opcional)</label>
              <input
                id="campaign-end"
                type="date"
                min={form.start_date ?? undefined}
                value={form.end_date ?? ""}
                onChange={(e) =>
                  setForm({ ...form, end_date: e.target.value || null })
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
                  onClick={() => setForm(null)}
                >
                  Cancelar
                </button>
              </div>
            </fieldset>
          </form>
        </section>
      )}

      {selected && !form && (
        <section className="panel campaign-detail">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{statusLabels[selected.status]}</span>
              <h2>{selected.name}</h2>
            </div>
            <button
              className="outline-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setEditingId(selected.id);
                setForm({
                  name: selected.name,
                  objective: selected.objective,
                  status: selected.status,
                  start_date: selected.start_date,
                  end_date: selected.end_date,
                });
              }}
            >
              Editar campaña
            </button>
          </div>
          <p className="campaign-objective">{selected.objective}</p>
          <p>
            {dateLabel(selected.start_date)} → {dateLabel(selected.end_date)}
          </p>
          <progress
            max={100}
            value={selected.progress}
            aria-label="Progreso de publicación"
          />
          <p>
            <strong>{selected.progress}%</strong> · {selected.published_count}{" "}
            publicados · {selected.pending_count} pendientes de publicación ·{" "}
            {selected.rejected_count} rechazados
          </p>
          <p className="campaign-note">
            Solo cuentan las publicaciones confirmadas en Facebook o TikTok, una
            vez por contenido. Aprobar, descargar o copiar no cuenta como
            publicar. Los rechazados siguen pendientes; los eliminados sin
            publicar se excluyen.
          </p>
          <div className="campaign-associate">
            <label htmlFor="campaign-content">
              Asociar contenido existente
            </label>
            <select
              id="campaign-content"
              value={draftId}
              disabled={busy}
              onChange={(e) => setDraftId(e.target.value)}
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
              onClick={() => void associate(draftId, true)}
            >
              Asociar
            </button>
          </div>
          {!availableDrafts.length && (
            <p className="campaign-note">
              No hay contenido disponible sin campaña. Puedes crear contenido
              con Sofía y Leo o desvincularlo de otra campaña.
            </p>
          )}
          <h3>Contenido asociado</h3>
          {!selected.drafts.length && (
            <p>Esta campaña no tiene contenido contabilizable todavía.</p>
          )}
          <ul className="campaign-contents">
            {selected.drafts.map((draft) => (
              <li key={draft.id}>
                <div>
                  <strong>{draft.title}</strong>
                  <span>
                    {draft.published ? "Publicado" : "Pendiente de publicación"}{" "}
                    · {draftLabels[draft.status] ?? draft.status}
                    {draft.deleted_at
                      ? " · Eliminado (historial conservado)"
                      : ""}
                  </span>
                </div>
                <button
                  className="outline-button"
                  type="button"
                  disabled={busy}
                  aria-label={`Desvincular ${draft.title}`}
                  onClick={() => void associate(draft.id, false)}
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
      )}
    </div>
  );
}

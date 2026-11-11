import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  createCampaign,
  deleteCampaign,
  getCampaigns,
  setCampaignDraft,
  updateCampaign,
  type Campaign,
  type CampaignInput,
} from "../../services/campaignsApi";
import { getDrafts, type Draft } from "../../services/draftsApi";

import CampaignList from "./CampaignList";
import CampaignForm from "./CampaignForm";
import CampaignDetails from "./CampaignDetails";
import CampaignDraftAssociation from "./CampaignDraftAssociation";

const emptyForm: CampaignInput = {
  name: "",
  objective: "",
  status: "draft",
  start_date: null,
  end_date: null,
};
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
  const [success, setSuccess] = useState<string | null>(null);
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
    setSuccess(null);
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

  async function removeCampaign() {
    if (!editingId || !form) return;
    const campaign = campaigns.find((item) => item.id === editingId);
    if (
      !campaign ||
      !window.confirm(
        `¿Eliminar permanentemente la campaña "${campaign.name}"? Sus borradores, aprobaciones y publicaciones se conservarán sin asignar a una campaña.`,
      )
    ) {
      return;
    }

    await perform(async () => {
      await deleteCampaign(businessId, campaign.id);
      if (!mounted.current) return;
      const remaining = campaigns.filter((item) => item.id !== campaign.id);
      setCampaigns(remaining);
      setDrafts((current) =>
        current.map((draft) =>
          draft.campaign_id === campaign.id
            ? { ...draft, campaign_id: null }
            : draft,
        ),
      );
      setSelectedId(remaining[0]?.id ?? null);
      setForm(null);
      setEditingId(null);
      setDraftId("");
      setSuccess(
        "Campaña eliminada correctamente. Su contenido e historial se conservaron.",
      );
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
    <div className="campaign-workspace">
      <section className="page-intro campaign-page-intro">
        <div>
          <span className="eyebrow">Planifica</span>
          <h2>Campañas</h2>
          <p>Define objetivos y organiza las piezas de contenido de tu negocio.</p>
        </div>
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
      </section>
      <section className="panel campaign-management">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Organización del trabajo</span>
            <h3>Tu plan de marketing</h3>
            <p>Selecciona una campaña para consultar sus objetivos y resultados.</p>
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
          </div>
        </div>
        {error && (
          <p role="alert" className="campaign-error">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="campaign-success">
            {success}
          </p>
        )}
        {loading && <p className="workspace-state" role="status">Cargando campañas…</p>}
        {!loading && !campaigns.length && (
          <div className="campaign-empty">
            <span aria-hidden="true">✦</span>
            <strong>Aún no hay campañas</strong>
            <p>Crea una para definir objetivos y dar estructura a tu contenido.</p>
          </div>
        )}
        <CampaignList
          campaigns={campaigns}
          selectedId={selectedId}
          busy={busy}
          onSelect={(id) => {
            setSelectedId(id);
            setDraftId("");
            setForm(null);
          }}
        />
      </section>

      {form && (
        <CampaignForm
          form={form}
          isEditing={Boolean(editingId)}
          busy={busy}
          onChange={setForm}
          onSave={save}
          onCancel={() => setForm(null)}
          onDelete={removeCampaign}
        />
      )}

      {selected && !form && (
        <CampaignDetails
          campaign={selected}
          busy={busy}
          onEdit={() => {
            setEditingId(selected.id);
            setForm({
              name: selected.name,
              objective: selected.objective,
              status: selected.status,
              start_date: selected.start_date,
              end_date: selected.end_date,
            });
          }}
          onDetach={(id) => associate(id, false)}
        >
          <CampaignDraftAssociation
            availableDrafts={availableDrafts}
            draftId={draftId}
            busy={busy}
            onSelect={setDraftId}
            onAssociate={(id) => associate(id, true)}
          />
        </CampaignDetails>
      )}
    </div>
  );
}

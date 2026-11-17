import { useEffect, useRef, useState, type FormEvent } from "react";
import { RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
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
import { useLocalization } from "../../app/useLocalization";

import CampaignList from "./CampaignList";
import CampaignForm from "./CampaignForm";
import CampaignDetails from "./CampaignDetails";
import CampaignDraftAssociation from "./CampaignDraftAssociation";
import ConfirmationDialog from "../../components/ui/ConfirmationDialog";

const emptyForm: CampaignInput = {
  name: "",
  objective: "",
  status: "draft",
  start_date: null,
  end_date: null,
};

type DiscardIntent =
  | { type: "close" }
  | { type: "new" }
  | { type: "select"; campaignId: string };

export default function CampaignsPage({ businessId }: { businessId: string }) {
  const { t } = useLocalization();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<CampaignInput | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    businessId: string;
    campaignId: string;
    name: string;
  } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [discardIntent, setDiscardIntent] = useState<DiscardIntent | null>(
    null,
  );
  const mounted = useRef(false);
  const tRef = useRef(t);
  const mutationLock = useRef(false);
  const businessIdRef = useRef(businessId);
  const selected = campaigns.find((campaign) => campaign.id === selectedId);
  const editingCampaign = editingId
    ? campaigns.find((campaign) => campaign.id === editingId)
    : null;
  const hasUnsavedChanges = Boolean(
    form &&
      (
        form.name !== (editingCampaign?.name ?? emptyForm.name) ||
        form.objective !==
          (editingCampaign?.objective ?? emptyForm.objective) ||
        form.status !== (editingCampaign?.status ?? emptyForm.status) ||
        form.start_date !==
          (editingCampaign?.start_date ?? emptyForm.start_date) ||
        form.end_date !== (editingCampaign?.end_date ?? emptyForm.end_date)
      ),
  );
  const availableDrafts = drafts.filter(
    (draft) => !draft.deleted_at && !draft.campaign_id,
  );

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    let active = true;
    businessIdRef.current = businessId;
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
          setError(tRef.current("campaigns.loadError"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [businessId]);

  async function perform(
    action: () => Promise<void>,
    onError?: (message: string) => void,
  ) {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await action();
    } catch (err) {
      if (mounted.current) {
        const message =
          err instanceof Error
            ? err.message
            : tRef.current("campaigns.saveError");
        if (onError) onError(message);
        else setError(message);
      }
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

  function closeForm() {
    setForm(null);
    setEditingId(null);
  }

  function openNewCampaign() {
    setEditingId(null);
    setForm({ ...emptyForm });
    setError(null);
  }

  function selectCampaign(id: string) {
    setSelectedId(id);
    setDraftId("");
    closeForm();
  }

  function requestDiscard(intent: DiscardIntent) {
    if (hasUnsavedChanges) {
      setDiscardIntent(intent);
      setDiscardDialogOpen(true);
      return;
    }

    if (intent.type === "select") selectCampaign(intent.campaignId);
    else if (intent.type === "new") openNewCampaign();
    else closeForm();
  }

  function confirmDiscard() {
    const intent = discardIntent;
    setDiscardDialogOpen(false);
    setDiscardIntent(null);
    if (intent?.type === "select") selectCampaign(intent.campaignId);
    else if (intent?.type === "new") openNewCampaign();
    else closeForm();
  }

  function openDeleteDialog() {
    const campaign = editingId
      ? campaigns.find((item) => item.id === editingId)
      : null;
    if (!campaign || campaign.business_id !== businessId) return;
    setDeleteError(null);
    setDeleteTarget({
      businessId,
      campaignId: campaign.id,
      name: campaign.name,
    });
  }

  async function refresh() {
    if (mutationLock.current) return;
    setRefreshing(true);
    try {
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
    } finally {
      setRefreshing(false);
    }
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
      setEditingId(null);
      setDraftId("");
    });
  }

  async function removeCampaign() {
    const target = deleteTarget;
    if (
      !target ||
      target.businessId !== businessIdRef.current ||
      mutationLock.current
    ) {
      return;
    }
    await perform(async () => {
      await deleteCampaign(target.businessId, target.campaignId);
      if (
        !mounted.current ||
        businessIdRef.current !== target.businessId
      ) {
        return;
      }
      const remaining = campaigns.filter(
        (item) => item.id !== target.campaignId,
      );
      setCampaigns(remaining);
      setDrafts((current) =>
        current.map((draft) =>
          draft.campaign_id === target.campaignId
            ? { ...draft, campaign_id: null }
            : draft,
        ),
      );
      setSelectedId(remaining[0]?.id ?? null);
      closeForm();
      setDraftId("");
      setDeleteTarget(null);
      setDeleteError(null);
      setSuccess(t("campaigns.deleted"));
    }, setDeleteError);
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
      <section className="panel">{t("campaigns.noBusiness")}</section>
    );

  return (
    <div className="campaign-workspace">
      <section className="page-intro campaign-page-intro">
        <div>
          <span className="eyebrow">{t("campaigns.eyebrow")}</span>
          <h2>{t("campaigns.title")}</h2>
          <p>{t("campaigns.description")}</p>
        </div>
        <button
          type="button"
          className="primary-button"
          data-guide-target="campaign-create"
          disabled={busy || loading}
          onClick={() => requestDiscard({ type: "new" })}
        >
          {t("campaigns.new")}
        </button>
      </section>
      <section className="panel campaign-management">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">{t("campaigns.organization")}</span>
            <h3>{t("campaigns.planTitle")}</h3>
            <p>{t("campaigns.planDescription")}</p>
          </div>
          <div className="campaign-actions">
            <button
              type="button"
              className="outline-button campaign-refresh-button"
              disabled={busy || loading}
              onClick={() => void refresh()}
            >
              <RefreshCw
                size={16}
                className={refreshing ? "is-spinning" : ""}
                aria-hidden="true"
              />
              {t(refreshing ? "campaigns.refreshing" : "campaigns.refresh")}
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
        {loading && (
          <p className="workspace-state" role="status">
            {t("campaigns.loading")}
          </p>
        )}
        {!loading && !campaigns.length && (
          <div className="campaign-empty">
            <span aria-hidden="true">✦</span>
            <strong>{t("campaigns.emptyTitle")}</strong>
            <p>{t("campaigns.emptyDescription")}</p>
          </div>
        )}
        <CampaignList
          campaigns={campaigns}
          selectedId={selectedId}
          busy={busy}
          onSelect={(id) => {
            requestDiscard({ type: "select", campaignId: id });
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
          onCancel={() => requestDiscard({ type: "close" })}
          onDelete={openDeleteDialog}
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
      <ConfirmationDialog
        open={deleteTarget !== null}
        title={t("campaigns.deleteTitle")}
        description={t("campaigns.deleteConfirm", {
          name: deleteTarget?.name ?? "",
        })}
        cancelLabel={t("common.cancel")}
        confirmLabel={t("campaigns.delete")}
        pendingLabel={t("campaigns.deleting")}
        busy={busy && deleteTarget !== null}
        error={deleteError}
        destructive
        icon={Trash2}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        onConfirm={() => void removeCampaign()}
      />
      <ConfirmationDialog
        open={discardDialogOpen}
        title={t("campaigns.discardTitle")}
        description={t("campaigns.discardDescription", {
          name:
            form?.name.trim() ||
            editingCampaign?.name ||
            t("campaigns.new"),
        })}
        cancelLabel={t("common.cancel")}
        confirmLabel={t("campaigns.discardConfirm")}
        destructive
        icon={ShieldAlert}
        onOpenChange={(open) => {
          setDiscardDialogOpen(open);
          if (!open) setDiscardIntent(null);
        }}
        onConfirm={confirmDiscard}
      />
    </div>
  );
}

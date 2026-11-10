import type { CampaignStatus } from "../../services/campaignsApi";

export const statusLabels: Record<CampaignStatus, string> = {
  draft: "Borrador",
  active: "Activa",
  paused: "Pausada",
  completed: "Completada",
  archived: "Archivada",
};
export const draftLabels: Record<string, string> = {
  pending: "Pendiente de aprobación",
  approved: "Aprobado",
  rejected: "Rechazado",
};
export const dateLabel = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(
        new Date(`${value}T12:00:00`),
      )
    : "Sin fecha";

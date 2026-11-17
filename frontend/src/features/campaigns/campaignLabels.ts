import type { CampaignStatus } from "../../services/campaignsApi";

export const statusTranslationKeys = {
  draft: "campaigns.status.draft",
  active: "campaigns.status.active",
  paused: "campaigns.status.paused",
  completed: "campaigns.status.completed",
  archived: "campaigns.status.archived",
} as const satisfies Record<CampaignStatus, string>;

export const draftTranslationKeys = {
  pending: "campaigns.draftStatus.pending",
  approved: "campaigns.draftStatus.approved",
  rejected: "campaigns.draftStatus.rejected",
} as const;

export const formatCampaignDate = (value: string | null, locale: string) =>
  value
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
        new Date(`${value}T12:00:00`),
      )
    : null;

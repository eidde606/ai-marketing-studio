import type { Draft } from "../../services/draftsApi";
import { useLocalization } from "../../app/localization";
import { draftTranslationKeys } from "./campaignLabels";

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
  const { t } = useLocalization();
  return (
    <>
      <div className="campaign-associate">
        <label htmlFor="campaign-content">
          {t("campaigns.associateExisting")}
        </label>
        <select
          id="campaign-content"
          value={draftId}
          disabled={busy}
          onChange={(e) => onSelect(e.target.value)}
        >
          <option value="">{t("campaigns.selectUnassigned")}</option>
          {availableDrafts.map((draft) => (
            <option key={draft.id} value={draft.id}>
              {draft.title} —{" "}
              {draftTranslationKeys[
                draft.status as keyof typeof draftTranslationKeys
              ]
                ? t(
                    draftTranslationKeys[
                      draft.status as keyof typeof draftTranslationKeys
                    ],
                  )
                : draft.status}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="primary-button"
          disabled={busy || !draftId}
          onClick={() => void onAssociate(draftId)}
        >
          {t("campaigns.associate")}
        </button>
      </div>
      {!availableDrafts.length && (
        <p className="campaign-note">{t("campaigns.noAvailableContent")}</p>
      )}
    </>
  );
}

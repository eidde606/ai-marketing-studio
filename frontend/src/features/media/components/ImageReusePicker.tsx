import { useEffect, useState } from "react";
import {
  getReusableDraftImages,
  type ReusableDraftImage,
} from "../../../services/draftsApi";
import { useLocalization } from "../../../app/useLocalization";

type Props = {
  draftId: string;
  disabled: boolean;
  onSelect: (sourceDraftId: string) => Promise<boolean>;
};

export function ImageReusePicker({ draftId, disabled, onSelect }: Props) {
  const { t } = useLocalization();
  const [images, setImages] = useState<ReusableDraftImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getReusableDraftImages(draftId)
      .then((result) => {
        if (active) setImages(result);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [draftId]);

  const selectImage = async (sourceDraftId: string) => {
    if (busyId || disabled) return;
    setBusyId(sourceDraftId);
    try {
      await onSelect(sourceDraftId);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <p role="status">{t("media.loadingReusableImages")}</p>;
  if (error) return <p role="alert">{t("media.imageReuseError")}</p>;
  if (!images.length) return <p>{t("media.noReusableImages")}</p>;

  return (
    <div className="image-reuse-picker">
      <p>{t("media.existingImageHelp")}</p>
      {images.map((image) => (
        <article className="image-reuse-card" key={image.draft_id}>
          <img
            src={image.image_url}
            alt={t("media.imageFor", { title: image.title })}
          />
          <div>
            <strong>{image.title}</strong>
            <button
              type="button"
              className="secondary-button"
              disabled={disabled || busyId !== null}
              onClick={() => void selectImage(image.draft_id)}
            >
              {busyId === image.draft_id
                ? t("media.reusingImage")
                : t("media.useExistingImage")}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

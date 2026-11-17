import { useId, useState } from "react";
import { ImagePlus, Loader2, Upload } from "lucide-react";
import { useLocalization } from "../../../app/useLocalization";

const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

type Props = {
  disabled: boolean;
  onUpload: (file: File) => Promise<boolean>;
};

export function ImageUpload({ disabled, onUpload }: Props) {
  const { t } = useLocalization();
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectFile = (selected: File | null) => {
    setError(null);
    if (selected && selected.size > MAX_IMAGE_SIZE) {
      setFile(null);
      setError(t("media.imageTooLarge"));
      return;
    }
    setFile(selected);
  };

  const upload = async () => {
    if (!file || uploading || disabled) return;
    setUploading(true);
    setError(null);
    try {
      if (await onUpload(file)) setFile(null);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="image-upload">
      <input
        id={inputId}
        type="file"
        className="image-upload-input"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        disabled={disabled || uploading}
        onChange={(event) => {
          selectFile(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />
      <label htmlFor={inputId} className="image-upload-dropzone">
        <ImagePlus size={24} aria-hidden="true" />
        <span>{t("media.imageUploadHelp")}</span>
      </label>
      {file && (
        <p className="image-upload-selected">
          {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
        </p>
      )}
      <button
        type="button"
        className="secondary-button"
        disabled={!file || disabled || uploading}
        onClick={() => void upload()}
      >
        {uploading ? (
          <Loader2 className="animate-spin" size={17} aria-hidden="true" />
        ) : (
          <Upload size={17} aria-hidden="true" />
        )}
        {uploading ? t("media.uploadingImage") : t("media.uploadImage")}
      </button>
      {uploading && <p role="status">{t("media.uploadImageProgress")}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

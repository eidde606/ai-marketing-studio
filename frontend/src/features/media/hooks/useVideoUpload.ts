import { useState } from "react";
import { uploadDraftVideo } from "../services/videoApi";
import { useLocalization } from "../../../app/localization";

export function useVideoUpload(draftId: string, onUploaded: () => void) {
  const { t } = useLocalization();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function selectFile(selectedFile: File | null) {
    setError(null);

    if (!selectedFile) {
      setFile(null);
      return;
    }

    const isMp4 =
      selectedFile.type === "video/mp4" ||
      selectedFile.name.toLowerCase().endsWith(".mp4");

    if (!isMp4) {
      setFile(null);
      setError(t("videoUpload.mp4Only"));
      return;
    }

    setFile(selectedFile);
  }

  async function handleUpload() {
    if (!file || uploading) return;

    setUploading(true);
    setError(null);

    try {
      await uploadDraftVideo(draftId, file);

      setFile(null);
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("videoUpload.error"));
    } finally {
      setUploading(false);
    }
  }

  return { file, setFile, uploading, error, selectFile, handleUpload };
}

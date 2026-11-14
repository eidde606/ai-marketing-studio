import { useState } from "react";
import type { Draft } from "../../../services/draftsApi";
import { fetchVideoPreview, fetchVideoDownload } from "../services/videoApi";
import { useLocalization } from "../../../app/localization";

/** Page-local browser media state; deliberately retains the original lifetime. */
export function useApprovalMedia() {
  const { t } = useLocalization();
  const [openVideoEditorId, setOpenVideoEditorId] = useState<string | null>(
    null,
  );

  const [videoUrls, setVideoUrls] = useState<Record<string, string>>({});

  const [videoLoadingId, setVideoLoadingId] = useState<string | null>(null);

  const [videoErrors, setVideoErrors] = useState<Record<string, string>>({});

  const [copiedScriptId, setCopiedScriptId] = useState<string | null>(null);

  const [downloadBusyId, setDownloadBusyId] = useState<string | null>(null);
  const [copiedCaptionId, setCopiedCaptionId] = useState<string | null>(null);

  async function handleCopyCaption(draft: Draft) {
    try {
      await navigator.clipboard.writeText(draft.caption ?? "");
      setCopiedCaptionId(draft.id);
    } catch {
      window.alert(t("media.captionCopyError"));
    }
  }

  async function handleDownloadVideo(draft: Draft) {
    if (!draft.video_url || downloadBusyId === draft.id) return;
    setDownloadBusyId(draft.id);
    try {
      const blob = await fetchVideoDownload(draft.id);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `tiktok-${draft.id}.mp4`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : t("media.downloadError"),
      );
    } finally {
      setDownloadBusyId(null);
    }
  }

  async function handleCopyScript(draft: Draft) {
    if (!draft.video_script) return;

    try {
      await navigator.clipboard.writeText(draft.video_script);
      setCopiedScriptId(draft.id);
    } catch {
      setCopiedScriptId(null);
      window.alert(
        t("media.scriptCopyError"),
      );
    }
  }

  async function handlePreviewVideo(draft: Draft) {
    if (!draft.video_url || videoLoadingId === draft.id) return;

    setVideoLoadingId(draft.id);
    setVideoErrors((current) => ({
      ...current,
      [draft.id]: "",
    }));

    try {
      const result = await fetchVideoPreview(draft.id);

      setVideoUrls((current) => ({
        ...current,
        [draft.id]: result.video_url,
      }));
    } catch (err) {
      setVideoErrors((current) => ({
        ...current,
        [draft.id]:
          err instanceof Error ? err.message : t("media.videoPreviewError"),
      }));
    } finally {
      setVideoLoadingId(null);
    }
  }

  return {
    openVideoEditorId,
    setOpenVideoEditorId,
    videoUrls,
    setVideoUrls,
    videoLoadingId,
    videoErrors,
    copiedScriptId,
    downloadBusyId,
    copiedCaptionId,
    handleCopyCaption,
    handleDownloadVideo,
    handleCopyScript,
    handlePreviewVideo,
  };
}

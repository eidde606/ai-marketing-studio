import { useEffect, useId, useRef, useState } from "react";
import type { Draft } from "../../../services/draftsApi";
import type { HeyGenController } from "../hooks/useHeyGenGeneration";
import { fetchVideoPreview } from "../services/videoApi";
import {
  HeyGenAssetSelector,
  type AssetSelection,
} from "./HeyGenAssetSelector";
import { useLocalization } from "../../../app/localization";

export function HeyGenGenerationPanel({
  draft,
  controller,
}: {
  draft: Draft;
  controller: HeyGenController;
}) {
  const { t } = useLocalization();
  const scriptId = useId();
  const [script, setScript] = useState(draft.video_script ?? "");
  const [selection, setSelection] = useState<AssetSelection | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const active = useRef(false);
  const read = useRef(() => controller.read(draft));
  useEffect(() => {
    read.current = () => controller.read(draft);
  });
  useEffect(() => {
    active.current = true;
    void read.current();
    return () => {
      active.current = false;
    };
  }, []);
  const state = controller.state(draft.id);
  const job = state.job;
  useEffect(() => {
    if (
      state.busy ||
      state.error ||
      !job ||
      job.status === "UNKNOWN" ||
      job.status === "FAILED" ||
      (job.status === "COMPLETED" &&
        ["STORED", "FAILED"].includes(job.storage_status))
    )
      return;
    const timer = window.setTimeout(() => {
      void read.current();
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [job, state.busy, state.error]);
  const stored = job?.status === "COMPLETED" && job.storage_status === "STORED";
  const savingVideo =
    job?.status === "COMPLETED" &&
    !["STORED", "FAILED"].includes(job.storage_status);
  const showProgress =
    state.busy ||
    job?.status === "SUBMITTING" ||
    job?.status === "PROCESSING" ||
    savingVideo;
  const progressLabel =
    state.busy && !job
      ? state.uncertain
        ? t("heygen.progress.recovering")
        : t("heygen.progress.checking")
      : job?.status === "SUBMITTING"
        ? t("heygen.progress.submitting")
        : job?.status === "PROCESSING"
          ? t("heygen.progress.processing")
          : savingVideo
            ? t("heygen.progress.storing")
            : "";
  const message =
    state.uncertain || job?.status === "UNKNOWN"
      ? t("heygen.status.uncertain")
      : job?.status === "FAILED"
        ? t("heygen.status.failed")
        : stored
          ? t("heygen.status.stored")
          : job?.status === "COMPLETED" && job.storage_status === "FAILED"
            ? t("heygen.status.storageFailed")
            : job?.status === "COMPLETED"
              ? t("heygen.status.completed")
              : job
                ? t("heygen.status.processing")
                : state.checked
                  ? t("heygen.status.checked")
                  : t("heygen.status.checking");

  async function showPreview() {
    if (previewBusy || !stored) return;
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      const result = await fetchVideoPreview(draft.id);
      if (active.current) setPreview(result.video_url);
    } catch {
      if (active.current)
        setPreviewError(
          t("heygen.previewError"),
        );
    } finally {
      if (active.current) setPreviewBusy(false);
    }
  }
  return (
    <section
      className="heygen-editor"
      aria-label={t("heygen.ariaLabel")}
    >
      <header className="heygen-editor-header">
        <h3>{t("heygen.title")}</h3>
        <p>{t("heygen.configure")}</p>
      </header>
      <p className="heygen-status" role="status">
        {message}
      </p>
      {showProgress && (
        <div className="heygen-progress-status" role="status">
          <span className="heygen-progress-spinner" aria-hidden="true" />
          <span>{progressLabel}</span>
          <div
            className="heygen-progress-track"
            role="progressbar"
            aria-label={progressLabel}
          >
            <span />
          </div>
        </div>
      )}
      {state.error && <p role="alert">{state.error}</p>}
      {(job || state.uncertain || state.error) && (
        <button
          type="button"
          className="text-button"
          disabled={state.busy}
          onClick={() => void controller.reconcile(draft)}
        >
          {state.busy ? t("heygen.recovering") : t("heygen.recover")}
        </button>
      )}
      {(!job || job.status === "FAILED") && !state.uncertain && (
        <>
          <fieldset className="heygen-inputs" disabled={state.busy}>
            <HeyGenAssetSelector onSelection={setSelection} />
            <div className="heygen-field">
              <label htmlFor={scriptId}>{t("heygen.script")}</label>
              <textarea
                id={scriptId}
                className="heygen-script-textarea"
                aria-describedby={`${scriptId}-help`}
                value={script}
                maxLength={5000}
                rows={8}
                onChange={(event) => setScript(event.target.value)}
              />
              <small id={`${scriptId}-help`}>
                {t("heygen.scriptHelp")}
              </small>
            </div>
          </fieldset>
          <p className="heygen-generation-notice">
            {t("heygen.formatNotice")}
          </p>
          <button
            className="primary-button"
            type="button"
            aria-describedby={`${scriptId}-generation-help`}
            disabled={
              !controller.canGenerate(draft) || !selection || !script.trim()
            }
            onClick={() => {
              if (selection)
                void controller.generate(draft, { ...selection, script });
            }}
          >
            {t("heygen.generate")}
          </button>
          <small id={`${scriptId}-generation-help`}>
            {t("heygen.confirmNotice")}
          </small>
        </>
      )}
      {stored && (
        <>
          <button
            type="button"
            className="text-button"
            disabled={previewBusy}
            onClick={() => void showPreview()}
          >
            {previewBusy
              ? t("heygen.previewLoading")
              : t("heygen.previewRefresh")}
          </button>
          {preview && (
            <video
              src={preview}
              controls
              playsInline
              preload="metadata"
              className="heygen-video-preview"
              onError={() => {
                setPreview(null);
                setPreviewError(
                  t("heygen.previewExpired"),
                );
              }}
            />
          )}
          {previewError && <p role="alert">{previewError}</p>}
        </>
      )}
      <p className="heygen-approval-notice">
        {t("heygen.noAutoAction")}
      </p>
    </section>
  );
}

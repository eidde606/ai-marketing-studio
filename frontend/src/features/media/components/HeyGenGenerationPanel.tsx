import { useEffect, useId, useRef, useState } from "react";
import type { Draft } from "../../../services/draftsApi";
import type { HeyGenController } from "../hooks/useHeyGenGeneration";
import { fetchVideoPreview } from "../services/videoApi";
import {
  HeyGenAssetSelector,
  type AssetSelection,
} from "./HeyGenAssetSelector";

export function HeyGenGenerationPanel({
  draft,
  controller,
}: {
  draft: Draft;
  controller: HeyGenController;
}) {
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
  const message =
    state.uncertain || job?.status === "UNKNOWN"
      ? "No sabemos si HeyGen recibió la solicitud. Recupera el estado; no generes otro video."
      : job?.status === "FAILED"
        ? "HeyGen no pudo generar el video. Puedes revisar los datos antes de autorizar una nueva generación."
        : stored
          ? "Video guardado de forma privada. Puedes verlo antes de aprobar el contenido."
          : job?.status === "COMPLETED" && job.storage_status === "FAILED"
            ? "El video no se pudo adjuntar. El borrador puede haber cambiado. Contacta al administrador."
            : job?.status === "COMPLETED"
              ? "El video está generado. Recupera el estado para completar su almacenamiento privado."
              : job
                ? "HeyGen está procesando tu video. Puede tardar unos minutos."
                : state.checked
                  ? "Revisa el guion y selecciona un avatar y una voz."
                  : "Consultando el estado del video...";

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
          "No se pudo abrir el video. Solicita una nueva vista previa.",
        );
    } finally {
      if (active.current) setPreviewBusy(false);
    }
  }
  return (
    <section
      className="heygen-editor"
      aria-label="Generación de video con HeyGen"
    >
      <header className="heygen-editor-header">
        <h3>Crear video con HeyGen</h3>
        <p>Configura tu avatar, voz y guion antes de generar el video.</p>
      </header>
      <p className="heygen-status" role="status">
        {message}
      </p>
      {state.error && <p role="alert">{state.error}</p>}
      {(job || state.uncertain || state.error) && (
        <button
          type="button"
          className="text-button"
          disabled={state.busy}
          onClick={() => void controller.reconcile(draft)}
        >
          {state.busy ? "Consultando..." : "Recuperar estado del video"}
        </button>
      )}
      {(!job || job.status === "FAILED") && !state.uncertain && (
        <>
          <fieldset className="heygen-inputs" disabled={state.busy}>
            <HeyGenAssetSelector onSelection={setSelection} />
            <div className="heygen-field">
              <label htmlFor={scriptId}>Guion del video</label>
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
                Hasta 5.000 caracteres. El texto se conserva tal como lo
                escribas.
              </small>
            </div>
          </fieldset>
          <p className="heygen-generation-notice">
            Video vertical · 1080p. HeyGen consume créditos de API. El costo
            exacto no está disponible aquí.
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
            Generar video con HeyGen
          </button>
          <small id={`${scriptId}-generation-help`}>
            Selecciona un avatar y una voz, y confirma antes de enviar la
            solicitud pagada.
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
              ? "Cargando video..."
              : "Actualizar vista previa privada"}
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
                  "La vista previa venció o no está disponible. Actualízala para volver a verla.",
                );
              }}
            />
          )}
          {previewError && <p role="alert">{previewError}</p>}
        </>
      )}
      <p className="heygen-approval-notice">
        Generar un video no aprueba ni publica este contenido.
      </p>
    </section>
  );
}

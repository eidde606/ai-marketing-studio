import type { Draft } from "../../../services/draftsApi";
import type { useDraftMedia } from "../hooks/useDraftMedia";
type Props = { draft: Draft } & Pick<
  ReturnType<typeof useDraftMedia>,
  | "toggleImageEditor"
  | "showImageEditor"
  | "revisionErrors"
  | "revisions"
  | "imageUrls"
  | "handlePreviewImage"
  | "revisionBusyIds"
  | "handleDecideRevision"
  | "imageInstructions"
  | "updateImageInstructions"
  | "addImageSuggestion"
  | "handleCreateRevision"
  | "refreshRevision"
>;
export function ImageRevisionEditor({
  draft,
  toggleImageEditor,
  showImageEditor,
  revisionErrors,
  revisions,
  imageUrls,
  handlePreviewImage,
  revisionBusyIds,
  handleDecideRevision,
  imageInstructions,
  updateImageInstructions,
  addImageSuggestion,
  handleCreateRevision,
  refreshRevision,
}: Props) {
  return (
    <div className="ai-image-editor">
      <button
        type="button"
        className="ai-editor-toggle"
        onClick={() => toggleImageEditor(draft.id)}
        aria-expanded={!!showImageEditor[draft.id]}
        aria-controls={`ai-editor-content-${draft.id}`}
      >
        <span>✦ Editar imagen con IA</span>

        <span aria-hidden="true">{showImageEditor[draft.id] ? "−" : "+"}</span>
      </button>

      {showImageEditor[draft.id] && (
        <div id={`ai-editor-content-${draft.id}`} className="ai-editor-content">
          <p>
            Describe en español los cambios. La imagen original se conservará
            hasta que aceptes una versión nueva.
          </p>

          {revisionErrors[draft.id] && (
            <p role="alert" style={{ color: "#b91c1c" }}>
              {revisionErrors[draft.id]}
            </p>
          )}

          {revisions[draft.id]?.status === "ready" ? (
            <>
              <p>
                <strong>Versión nueva lista para revisar</strong>
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: "1rem",
                }}
              >
                <div>
                  <strong>Original</strong>

                  {imageUrls[draft.id] ? (
                    <img
                      src={imageUrls[draft.id]}
                      alt="Imagen original"
                      style={{
                        width: "100%",
                        borderRadius: 12,
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handlePreviewImage(draft)}
                    >
                      Ver original
                    </button>
                  )}
                </div>

                <div>
                  <strong>Nueva versión</strong>

                  {revisions[draft.id]?.image_url ? (
                    <img
                      src={revisions[draft.id]!.image_url!}
                      alt="Versión editada"
                      style={{
                        width: "100%",
                        borderRadius: 12,
                      }}
                    />
                  ) : (
                    <p>No se recibió una vista previa. Actualiza el estado.</p>
                  )}
                </div>
              </div>

              <div className="approval-actions">
                <button
                  type="button"
                  className="approve-button"
                  disabled={revisionBusyIds.includes(draft.id)}
                  onClick={() => void handleDecideRevision(draft, "accept")}
                >
                  ✓ Aceptar nueva versión
                </button>

                <button
                  type="button"
                  className="reject-button"
                  disabled={revisionBusyIds.includes(draft.id)}
                  onClick={() => void handleDecideRevision(draft, "reject")}
                >
                  Conservar original
                </button>
              </div>
            </>
          ) : revisions[draft.id]?.status === "generating" ? (
            <p role="status">
              La nueva imagen se está generando. No solicites otra hasta
              confirmar el resultado.
            </p>
          ) : (
            <>
              <label htmlFor={`image-instructions-${draft.id}`}>
                Instrucciones para la IA
              </label>

              <textarea
                id={`image-instructions-${draft.id}`}
                value={imageInstructions[draft.id] || ""}
                onChange={(event) =>
                  updateImageInstructions(draft.id, event.target.value)
                }
                placeholder="Ejemplo: Mejora la iluminación y cambia el fondo por una mesa elegante."
                rows={4}
                maxLength={1000}
                disabled={revisionBusyIds.includes(draft.id)}
              />

              <div className="ai-editor-suggestions">
                {[
                  "Mejorar iluminación",
                  "Cambiar el fondo",
                  "Estilo más profesional",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={revisionBusyIds.includes(draft.id)}
                    onClick={() => addImageSuggestion(draft.id, suggestion)}
                  >
                    + {suggestion}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="primary-button ai-regenerate-button"
                disabled={
                  revisionBusyIds.includes(draft.id) ||
                  !imageInstructions[draft.id]?.trim()
                }
                onClick={() => void handleCreateRevision(draft)}
              >
                {revisionBusyIds.includes(draft.id)
                  ? "Generando nueva versión..."
                  : "✦ Generar nueva versión"}
              </button>

              <small>
                La generación con IA puede tener un costo adicional. Se
                solicitará confirmación antes de continuar.
              </small>
            </>
          )}

          <button
            type="button"
            className="text-button"
            disabled={revisionBusyIds.includes(draft.id)}
            onClick={() => void refreshRevision(draft.id)}
          >
            Actualizar estado
          </button>
        </div>
      )}
    </div>
  );
}

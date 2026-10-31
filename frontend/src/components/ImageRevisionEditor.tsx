
import { useEffect, useRef, useState } from 'react';

import {
  acceptImageRevision,
  createImageRevision,
  getDraftImage,
  getImageRevisions,
  rejectImageRevision,
  type Draft,
  type ImageRevision,
} from '../services/draftsApi';

type Props = {
  draft: Draft;
  onAccepted: (imageUrl: string) => Promise<void>;
};

const suggestions = [
  'Mejorar iluminación',
  'Cambiar el fondo',
  'Estilo más profesional',
];

export default function ImageRevisionEditor({
  draft,
  onAccepted,
}: Props) {
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [revision, setRevision] = useState<ImageRevision | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actionLock = useRef(false);

  const ready = revision?.status === 'ready';
  const generatingOnServer = revision?.status === 'generating';
  const busy = loading || generating || deciding;

  useEffect(() => {
    if (!open) return;

    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const [original, revisions] = await Promise.all([
          getDraftImage(draft.id),
          getImageRevisions(draft.id),
        ]);

        if (!active) return;

        setOriginalUrl(original.image_url);

        const current = revisions.find(
          (item) =>
            item.status === 'ready' ||
            item.status === 'generating',
        );

        setRevision(current || null);
      } catch (err) {
        console.error('Image editor loading failed:', err);

        if (active) {
          setError(
            'No se pudo cargar el editor. Inténtalo nuevamente.',
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [open, draft.id]);

  function addSuggestion(value: string) {
    setInstructions((current) => {
      const existing = current.trim();

      return [existing, value]
        .filter(Boolean)
        .join(existing ? '. ' : '')
        .slice(0, 1000);
    });
  }

  async function handleGenerate() {
    if (
      actionLock.current ||
      busy ||
      revision?.status === 'ready' ||
      revision?.status === 'generating'
    ) {
      return;
    }

    const text = instructions.trim();

    if (!text) {
      setError('Escribe qué cambios deseas realizar.');
      return;
    }

    if (
      !window.confirm(
        '¿Generar una nueva versión con IA? Esta operación puede generar un cargo adicional en la API de OpenAI. La imagen original se conservará.',
      )
    ) {
      return;
    }

    actionLock.current = true;
    setGenerating(true);
    setError(null);

    try {
      const result = await createImageRevision(
        draft.id,
        text,
      );

      setRevision(result);
    } catch (err) {
      console.error('Image revision failed:', err);

      // A network error does not necessarily mean the
      // paid generation failed. Check the server first.
      try {
        const revisions = await getImageRevisions(draft.id);

        const activeRevision = revisions.find(
          (item) =>
            item.status === 'ready' ||
            item.status === 'generating',
        );

        if (activeRevision) {
          setRevision(activeRevision);
          setError(
            activeRevision.status === 'generating'
              ? 'La generación sigue en proceso. Espera antes de solicitar otra.'
              : null,
          );
        } else {
          setError(
            'No se pudo confirmar el resultado. Verifica el historial antes de intentar otra generación.',
          );
        }
      } catch {
        setError(
          'No se pudo verificar el resultado. No vuelvas a generar hasta comprobar el estado en el servidor.',
        );
      }
    } finally {
      actionLock.current = false;
      setGenerating(false);
    }
  }

  async function handleAccept() {
    if (
      actionLock.current ||
      busy ||
      !revision ||
      revision.status !== 'ready'
    ) {
      return;
    }

    if (
      !window.confirm(
        '¿Aceptar esta nueva imagen? Se utilizará en la publicación. La imagen anterior seguirá guardada.',
      )
    ) {
      return;
    }

    actionLock.current = true;
    setDeciding(true);
    setError(null);

    try {
      const result = await acceptImageRevision(
        draft.id,
        revision.id,
      );

      setRevision((current) =>
        current ? { ...current, status: 'accepted' } : null,
      );

      if (result.image_url) {
        setOriginalUrl(result.image_url);
        await onAccepted(result.image_url);
      }

      setInstructions('');
    } catch (err) {
      console.error('Accepting image revision failed:', err);

      setError(
        'No se pudo confirmar la aceptación. Actualiza la página para verificar el resultado.',
      );
    } finally {
      actionLock.current = false;
      setDeciding(false);
    }
  }

  async function handleReject() {
    if (
      actionLock.current ||
      busy ||
      !revision ||
      revision.status !== 'ready'
    ) {
      return;
    }

    actionLock.current = true;
    setDeciding(true);
    setError(null);

    try {
      await rejectImageRevision(
        draft.id,
        revision.id,
      );

      setRevision(null);
      setInstructions('');
    } catch (err) {
      console.error('Rejecting image revision failed:', err);

      setError(
        'No se pudo descartar la versión. Inténtalo nuevamente.',
      );
    } finally {
      actionLock.current = false;
      setDeciding(false);
    }
  }

  async function handleRefresh() {
    if (busy || actionLock.current) return;

    setLoading(true);
    setError(null);

    try {
      const revisions = await getImageRevisions(draft.id);

      const activeRevision = revisions.find(
        (item) =>
          item.status === 'ready' ||
          item.status === 'generating',
      );

      setRevision(activeRevision || null);
    } catch {
      setError('No se pudo actualizar el estado de la imagen.');
    } finally {
      setLoading(false);
    }
  }

  if (
    draft.status !== 'pending' ||
    draft.image_status !== 'completed' ||
    !draft.image_url
  ) {
    return null;
  }

  return (
    <div className="ai-image-editor">
      <button
        type="button"
        className="ai-editor-toggle"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={`ai-editor-content-${draft.id}`}
      >
        <span>✦ Editar imagen con IA</span>
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div
          id={`ai-editor-content-${draft.id}`}
          className="ai-editor-content"
        >
          <p>
            Describe en español cómo quieres mejorar la imagen.
            La original se conservará hasta que apruebes los cambios.
          </p>

          {loading && (
            <p role="status">Cargando imágenes...</p>
          )}

          {error && (
            <p role="alert" style={{ color: '#b91c1c' }}>
              {error}
            </p>
          )}

          {ready && revision?.image_url && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                gap: '1rem',
                margin: '1rem 0',
              }}
            >
              <div>
                <strong>Imagen original</strong>
                {originalUrl && (
                  <img
                    src={originalUrl}
                    alt="Imagen original"
                    style={{
                      width: '100%',
                      borderRadius: '12px',
                      marginTop: '0.5rem',
                    }}
                  />
                )}
              </div>

              <div>
                <strong>Nueva versión</strong>
                <img
                  src={revision.image_url}
                  alt="Imagen editada por IA"
                  style={{
                    width: '100%',
                    borderRadius: '12px',
                    marginTop: '0.5rem',
                  }}
                />
              </div>
            </div>
          )}

          {ready && (
            <div className="approval-actions">
              <button
                type="button"
                className="approve-button"
                disabled={busy}
                onClick={() => void handleAccept()}
              >
                {deciding
                  ? 'Procesando...'
                  : '✓ Aceptar nueva versión'}
              </button>

              <button
                type="button"
                className="reject-button"
                disabled={busy}
                onClick={() => void handleReject()}
              >
                Conservar original
              </button>
            </div>
          )}

          {generatingOnServer && (
            <div role="status">
              <p>
                La nueva imagen se está generando.
                No solicites otra generación todavía.
              </p>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void handleRefresh()}
              >
                Actualizar estado
              </button>
            </div>
          )}

          {!ready && !generatingOnServer && (
            <>
              <label htmlFor={`image-instructions-${draft.id}`}>
                Instrucciones para la IA
              </label>

              <textarea
                id={`image-instructions-${draft.id}`}
                value={instructions}
                onChange={(event) =>
                  setInstructions(event.target.value)
                }
                placeholder="Ejemplo: Haz que el plato se vea más grande, cambia el fondo y mejora la iluminación."
                rows={4}
                maxLength={1000}
                disabled={busy}
              />

              <div className="ai-editor-suggestions">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={busy}
                    onClick={() => addSuggestion(suggestion)}
                  >
                    + {suggestion}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="primary-button ai-regenerate-button"
                disabled={busy || !instructions.trim()}
                onClick={() => void handleGenerate()}
              >
                {generating
                  ? 'Generando nueva versión...'
                  : '✦ Generar nueva versión'}
              </button>

              <small>
                La edición utiliza la API de OpenAI y puede
                generar un cargo adicional. Se solicitará
                confirmación antes de continuar.
              </small>
            </>
          )}
        </div>
      )}
    </div>
  );
}

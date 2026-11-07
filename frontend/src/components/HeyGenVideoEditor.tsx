import { useEffect, useState } from "react";
import {
  getHeyGenAvatars,
  generateDraftVideo,
  getHeyGenVideoStatus,
  type HeyGenAvatar,
} from "../services/heygenApi";

import type { Draft } from "../services/draftsApi";

type HeyGenVideoEditorProps = {
  draft: Draft;
};

export function HeyGenVideoEditor({ draft }: HeyGenVideoEditorProps) {
  const [avatars, setAvatars] = useState<HeyGenAvatar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [script, setScript] = useState(draft.caption ?? "");
  const [selectedAvatarId, setSelectedAvatarId] = useState("");

  // Temporary test voice: Eddie
  const selectedVoiceId = "8cc9e20fd83c488da1a1c1015bb4c06e";

  const [generating, setGenerating] = useState(false);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoStatus, setVideoStatus] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadAvatars() {
      try {
        const result = await getHeyGenAvatars();

        if (active) {
          setAvatars(result);
        }
      } catch (err) {
        console.error("Unable to load HeyGen avatars:", err);

        if (active) {
          setError("No se pudieron cargar los avatares.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadAvatars();

    return () => {
      active = false;
    };
  }, []);

  async function handleGenerateVideo() {
    if (generating || !selectedAvatarId || !script.trim()) {
      return;
    }

    const confirmed = window.confirm(
      "¿Deseas generar este video? HeyGen puede consumir créditos de API.",
    );

    if (!confirmed) {
      return;
    }

    setGenerating(true);
    setVideoError(null);
    setVideoUrl(null);
    setVideoId(null);
    setVideoStatus(null);

    try {
      const job = await generateDraftVideo(draft.id, {
        avatar_id: selectedAvatarId,
        voice_id: selectedVoiceId,
        script: script.trim(),
      });

      if (!job.video_id) {
        throw new Error("HeyGen no devolvió un ID de video.");
      }

      setVideoId(job.video_id);
      setVideoStatus("pending");
    } catch (err) {
      console.error("Unable to generate HeyGen video:", err);

      setVideoError(
        err instanceof Error ? err.message : "No se pudo generar el video.",
      );
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    if (!videoId || videoStatus === "completed" || videoStatus === "failed") {
      return;
    }

    let active = true;

    async function checkStatus() {
      try {
        const result = await getHeyGenVideoStatus(videoId!);

        if (!active) {
          return;
        }

        setVideoStatus(result.status);

        if (result.status === "completed") {
          setVideoUrl(result.video_url ?? null);
        }

        if (result.status === "failed") {
          setVideoError(result.error ?? "HeyGen no pudo generar el video.");
        }
      } catch (err) {
        console.error("Unable to check HeyGen video status:", err);

        if (active) {
          setVideoError("No se pudo consultar el estado del video.");
          setVideoStatus("failed");
        }
      }
    }

    void checkStatus();

    const interval = window.setInterval(() => {
      void checkStatus();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [videoId, videoStatus]);

  if (loading) {
    return <p>Cargando avatares de HeyGen...</p>;
  }

  if (error) {
    return <p role="alert">{error}</p>;
  }

  const videoInProgress =
    videoId !== null && videoStatus !== "completed" && videoStatus !== "failed";

  return (
    <section className="heygen-editor">
      <div className="heygen-editor-header">
        <h3>🎬 Crear video con HeyGen</h3>
        <p>Selecciona un avatar y prepara el guion de tu video.</p>
      </div>

      <div className="heygen-field">
        <label htmlFor={`heygen-avatar-${draft.id}`}>Avatar del video</label>

        <select
          id={`heygen-avatar-${draft.id}`}
          value={selectedAvatarId}
          onChange={(event) => setSelectedAvatarId(event.target.value)}
          disabled={generating || videoInProgress}
        >
          <option value="" disabled>
            Selecciona un avatar
          </option>

          {avatars.map((avatar) => (
            <option key={avatar.id} value={avatar.id}>
              {avatar.name} —{" "}
              {avatar.avatar_type === "digital_twin"
                ? "Digital Twin"
                : avatar.avatar_type === "photo_avatar"
                  ? "Photo Avatar"
                  : "Avatar"}
            </option>
          ))}
        </select>

        <small>{avatars.length} avatares disponibles</small>
      </div>

      <div className="heygen-field">
        <label htmlFor={`video-script-${draft.id}`}>Guion del video</label>

        <textarea
          id={`video-script-${draft.id}`}
          value={script}
          onChange={(event) => setScript(event.target.value)}
          rows={6}
          maxLength={5000}
          disabled={generating || videoInProgress}
          placeholder="Escribe lo que dirá el avatar..."
        />

        <small>
          Revisa y adapta este texto para que suene natural al hablar.
        </small>
      </div>

      <button
        type="button"
        onClick={() => void handleGenerateVideo()}
        disabled={
          generating || videoInProgress || !selectedAvatarId || !script.trim()
        }
      >
        {generating ? "Enviando..." : "🎬 Generar video"}
      </button>

      {videoId && (
        <p>
          <strong>Estado del video:</strong> {videoStatus}
        </p>
      )}

      {videoInProgress && <p>HeyGen está procesando tu video...</p>}

      {videoError && <p role="alert">{videoError}</p>}

      {videoUrl && (
        <div className="heygen-field">
          <h4>Vista previa del video</h4>

          <video
            controls
            src={videoUrl}
            style={{ width: "100%", borderRadius: "12px" }}
          >
            Tu navegador no admite la reproducción de video.
          </video>
        </div>
      )}
    </section>
  );
}

import { useId, useState } from "react";
import {
  CheckCircle2,
  CloudUpload,
  FileVideo,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { supabase } from "../services/supabaseClient";

type VideoUploadProps = {
  draftId: string;
  onUploaded: () => void;
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000";

export function VideoUpload({ draftId, onUploaded }: VideoUploadProps) {
  const inputId = useId();

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function formatFileSize(bytes: number): string {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

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
      setError("Solo se permiten archivos de video MP4.");
      return;
    }

    setFile(selectedFile);
  }

  async function handleUpload() {
    if (!file || uploading) return;

    setUploading(true);
    setError(null);

    try {
      const { data, error: authError } = await supabase.auth.getSession();

      if (authError || !data.session?.access_token) {
        throw new Error("Debes iniciar sesión.");
      }

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(
        `${API_BASE_URL}/drafts/${encodeURIComponent(draftId)}/upload-video`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${data.session.access_token}`,
          },
          body: formData,
        },
      );

      if (!response.ok) {
        throw new Error(`No se pudo subir el video (${response.status}).`);
      }

      setFile(null);
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al subir el video.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className="video-upload"
      style={{
        display: "grid",
        gap: "1rem",
        marginTop: "0.75rem",
        width: "100%",
        maxWidth: "520px",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
        }}
      >
        <strong
          style={{
            fontSize: "0.9rem",
            color: "#35244f",
          }}
        >
          Subir video
        </strong>

        <span
          style={{
            padding: "0.3rem 0.65rem",
            borderRadius: "999px",
            background: "#ede5ff",
            color: "#7138dc",
            fontSize: "0.72rem",
            fontWeight: 700,
          }}
        >
          MP4
        </span>
      </div>

      {/* Hidden native input */}
      <input
        id={inputId}
        type="file"
        accept="video/mp4,.mp4"
        disabled={uploading}
        style={{ display: "none" }}
        onChange={(event) => {
          selectFile(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />

      {/* Upload area */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!uploading) setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);

          if (uploading) return;

          selectFile(event.dataTransfer.files[0] ?? null);
        }}
        style={{
          border: `2px dashed ${dragging ? "#7c3aed" : "#cbb7f5"}`,
          borderRadius: "16px",
          padding: "1.75rem 1rem",
          background: dragging ? "#f0e8ff" : "#faf7ff",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.7rem",
          textAlign: "center",
          transition: "all 0.2s ease",
        }}
      >
        <div
          style={{
            width: "54px",
            height: "54px",
            borderRadius: "15px",
            background: "#ede5ff",
            color: "#7c3aed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <CloudUpload size={27} />
        </div>

        <strong
          style={{
            fontSize: "0.95rem",
            color: "#35244f",
          }}
        >
          Selecciona tu video
        </strong>

        <span
          style={{
            fontSize: "0.78rem",
            color: "#81758f",
          }}
        >
          Arrastra un archivo MP4 aquí o selecciónalo desde tu dispositivo.
        </span>

        <label
          htmlFor={inputId}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            marginTop: "0.35rem",
            padding: "0.7rem 1.25rem",
            borderRadius: "10px",
            background: uploading ? "#a78bfa" : "#7c3aed",
            color: "#ffffff",
            fontSize: "0.83rem",
            fontWeight: 700,
            cursor: uploading ? "not-allowed" : "pointer",
            boxShadow: "0 3px 10px rgba(124,58,237,0.15)",
          }}
        >
          <Upload size={16} />
          Elegir video
        </label>

        {!file && (
          <span
            style={{
              fontSize: "0.72rem",
              color: "#a09aab",
            }}
          >
            Ningún archivo seleccionado
          </span>
        )}
      </div>

      {/* Selected file */}
      {file && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "0.85rem",
            background: "#ffffff",
            border: "1px solid #e6dcfa",
            borderRadius: "12px",
          }}
        >
          <div
            style={{
              width: "42px",
              height: "42px",
              borderRadius: "10px",
              background: "#ede5ff",
              color: "#7c3aed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <FileVideo size={21} />
          </div>

          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "grid",
              gap: "0.2rem",
            }}
          >
            <strong
              style={{
                fontSize: "0.8rem",
                color: "#35244f",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {file.name}
            </strong>

            <span
              style={{
                fontSize: "0.72rem",
                color: "#81758f",
              }}
            >
              {formatFileSize(file.size)}
            </span>
          </div>

          <CheckCircle2 size={19} color="#16a34a" />

          <button
            type="button"
            disabled={uploading}
            aria-label="Quitar video seleccionado"
            onClick={() => setFile(null)}
            style={{
              border: "none",
              background: "transparent",
              color: "#81758f",
              cursor: uploading ? "not-allowed" : "pointer",
              padding: "0.3rem",
              display: "flex",
              alignItems: "center",
            }}
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* Upload button */}
      <button
        type="button"
        disabled={!file || uploading}
        onClick={() => void handleUpload()}
        style={{
          width: "100%",
          padding: "0.85rem 1rem",
          border: "none",
          borderRadius: "11px",
          background: !file || uploading ? "#c4b5fd" : "#7c3aed",
          color: "#ffffff",
          fontSize: "0.88rem",
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.6rem",
          cursor: !file || uploading ? "not-allowed" : "pointer",
          transition: "background 0.2s ease",
        }}
      >
        {uploading ? (
          <>
            <Loader2
              size={18}
              className="animate-spin"
              style={{
                animation: "video-upload-spin 1s linear infinite",
              }}
            />
            Subiendo video...
          </>
        ) : (
          <>
            <Upload size={18} />
            Subir video
          </>
        )}
      </button>

      {uploading && (
        <p
          role="status"
          style={{
            margin: 0,
            textAlign: "center",
            fontSize: "0.78rem",
            color: "#81758f",
          }}
        >
          Estamos subiendo tu video. No cierres esta página.
        </p>
      )}

      {error && (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: "0.75rem",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "10px",
            color: "#b91c1c",
            fontSize: "0.8rem",
          }}
        >
          {error}
        </p>
      )}

      <style>
        {`
          @keyframes video-upload-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );
}

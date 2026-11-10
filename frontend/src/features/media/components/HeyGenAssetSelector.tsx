import { useEffect, useState, useId, useRef } from "react";
import {
  getHeyGenAvatarAssets,
  getHeyGenVoiceAssets,
  type HeyGenAvatarLook,
  type HeyGenAvatarType,
  type HeyGenOwnership,
  type HeyGenVoice,
  type HeyGenVoiceType,
} from "../services/heygenAssetsApi";

const avatarTypes: { value: HeyGenAvatarType | ""; label: string }[] = [
  { value: "", label: "Todos los tipos" },
  { value: "digital_twin", label: "Digital Twin" },
  { value: "photo_avatar", label: "Avatar de foto" },
  { value: "studio_avatar", label: "Avatar de estudio" },
];

export type AssetSelection = { avatar_id: string; voice_id: string };
export function HeyGenAssetSelector({
  onSelection,
}: {
  onSelection?: (value: AssetSelection | null) => void;
}) {
  const fieldId = useId();
  const avatarVisit = useRef(0);
  const voiceVisit = useRef(0);
  const [open, setOpen] = useState(false);
  const [avatarType, setAvatarType] = useState<HeyGenAvatarType | "">("");
  const [ownership, setOwnership] = useState<HeyGenOwnership>("private");
  const [voiceType, setVoiceType] = useState<HeyGenVoiceType>("private");
  const [avatars, setAvatars] = useState<HeyGenAvatarLook[]>([]);
  const [voices, setVoices] = useState<HeyGenVoice[]>([]);
  const [avatarNextToken, setAvatarNextToken] = useState<string | null>(null);
  const [voiceNextToken, setVoiceNextToken] = useState<string | null>(null);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [selectedAvatarId, setSelectedAvatarId] = useState("");
  const [selectedVoiceId, setSelectedVoiceId] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;

    void getHeyGenAvatarAssets({
      avatarType: avatarType || undefined,
      ownership,
    })
      .then((page) => {
        if (!active) return;
        setAvatars(page.data);
        setAvatarNextToken(page.next_token);
      })
      .catch((err: unknown) => {
        if (active) {
          setAvatarError(
            err instanceof Error
              ? err.message
              : "No se pudieron cargar los avatares.",
          );
        }
      })
      .finally(() => {
        if (active) setAvatarLoading(false);
      });

    return () => {
      active = false;
      avatarVisit.current += 1;
    };
  }, [open, avatarType, ownership]);

  useEffect(() => {
    if (!open) return;
    let active = true;

    void getHeyGenVoiceAssets({ type: voiceType })
      .then((page) => {
        if (!active) return;
        setVoices(page.data);
        setVoiceNextToken(page.next_token);
      })
      .catch((err: unknown) => {
        if (active) {
          setVoiceError(
            err instanceof Error
              ? err.message
              : "No se pudieron cargar las voces.",
          );
        }
      })
      .finally(() => {
        if (active) setVoiceLoading(false);
      });

    return () => {
      active = false;
      voiceVisit.current += 1;
    };
  }, [open, voiceType]);

  async function loadMoreAvatars() {
    if (!avatarNextToken || avatarLoading) return;
    const visit = avatarVisit.current;
    setAvatarLoading(true);
    setAvatarError(null);
    try {
      const page = await getHeyGenAvatarAssets({
        avatarType: avatarType || undefined,
        ownership,
        token: avatarNextToken,
      });
      if (visit !== avatarVisit.current) return;
      setAvatars((current) => [...current, ...page.data]);
      setAvatarNextToken(page.next_token);
    } catch (err) {
      if (visit !== avatarVisit.current) return;
      setAvatarError(
        err instanceof Error
          ? err.message
          : "No se pudieron cargar más avatares.",
      );
    } finally {
      if (visit === avatarVisit.current) setAvatarLoading(false);
    }
  }

  async function loadMoreVoices() {
    if (!voiceNextToken || voiceLoading) return;
    const visit = voiceVisit.current;
    setVoiceLoading(true);
    setVoiceError(null);
    try {
      const page = await getHeyGenVoiceAssets({
        type: voiceType,
        token: voiceNextToken,
      });
      if (visit !== voiceVisit.current) return;
      setVoices((current) => [...current, ...page.data]);
      setVoiceNextToken(page.next_token);
    } catch (err) {
      if (visit !== voiceVisit.current) return;
      setVoiceError(
        err instanceof Error ? err.message : "No se pudieron cargar más voces.",
      );
    } finally {
      if (visit === voiceVisit.current) setVoiceLoading(false);
    }
  }

  const selectedAvatar = avatars.find(
    (avatar) => avatar.id === selectedAvatarId,
  );
  const selectedVoice = voices.find(
    (voice) => voice.voice_id === selectedVoiceId,
  );
  const defaultVoiceMissing =
    !!selectedAvatar?.default_voice_id &&
    !voices.some((voice) => voice.voice_id === selectedAvatar.default_voice_id);

  const usableAvatar =
    selectedAvatar &&
    (!selectedAvatar.status ||
      ["completed", "ready", "active"].includes(
        selectedAvatar.status.toLowerCase(),
      )) &&
    (!selectedAvatar.supported_api_engines?.length ||
      selectedAvatar.supported_api_engines.includes("avatar_iv"));
  const usableVoice =
    selectedVoice &&
    (!selectedVoice.status || selectedVoice.status === "ACTIVE");
  const valid =
    !!usableAvatar &&
    !!usableVoice &&
    !avatarLoading &&
    !voiceLoading &&
    !avatarError &&
    !voiceError;
  useEffect(() => {
    onSelection?.(
      valid ? { avatar_id: selectedAvatarId, voice_id: selectedVoiceId } : null,
    );
  }, [valid, selectedAvatarId, selectedVoiceId, onSelection]);

  function toggleOpen() {
    const opening = !open;
    setOpen(opening);
    if (opening) {
      setAvatarLoading(true);
      setVoiceLoading(true);
      setAvatarError(null);
      setVoiceError(null);
    }
  }

  return (
    <section className="heygen-asset-selector">
      <button
        className="text-button"
        type="button"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        {open
          ? "Cerrar recursos de HeyGen"
          : "Explorar avatares y voces de HeyGen"}
      </button>

      {open && (
        <div
          style={{
            display: "grid",
            gap: "0.75rem",
            padding: "1rem",
            border: "1px solid #e9ddff",
            borderRadius: "12px",
          }}
        >
          <div>
            <h3>Seleccionar recursos de HeyGen</h3>
            <p>
              Explora los recursos disponibles en la cuenta conectada. Esta
              selección no genera videos ni consume créditos.
            </p>
          </div>

          <div className="heygen-field">
            <label htmlFor={`${fieldId}-heygen-avatar-ownership`}>
              Disponibilidad
            </label>
            <select
              id={`${fieldId}-heygen-avatar-ownership`}
              value={ownership}
              onChange={(event) => {
                setOwnership(event.target.value as HeyGenOwnership);
                setAvatarLoading(true);
                setAvatarError(null);
                setAvatars([]);
                setAvatarNextToken(null);
              }}
            >
              <option value="private">Mis avatares</option>
              <option value="public">Avatares públicos</option>
            </select>
          </div>

          <div className="heygen-field">
            <label htmlFor={`${fieldId}-heygen-avatar-type`}>
              Tipo de avatar
            </label>
            <select
              id={`${fieldId}-heygen-avatar-type`}
              value={avatarType}
              onChange={(event) => {
                setAvatarType(event.target.value as HeyGenAvatarType | "");
                setAvatarLoading(true);
                setAvatarError(null);
                setAvatars([]);
                setAvatarNextToken(null);
              }}
            >
              {avatarTypes.map((option) => (
                <option key={option.value || "all"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {avatarLoading && <p role="status">Cargando avatares...</p>}
          {avatarError && <p role="alert">{avatarError}</p>}
          {!avatarLoading && !avatarError && avatars.length === 0 && (
            <p>No hay avatares disponibles con estos filtros.</p>
          )}
          <div className="heygen-field">
            <label htmlFor={`${fieldId}-heygen-selected-avatar`}>
              Avatar o avatar de foto
            </label>
            <select
              id={`${fieldId}-heygen-selected-avatar`}
              value={selectedAvatarId}
              onChange={(event) => {
                const avatarId = event.target.value;
                setSelectedAvatarId(avatarId);
                const avatar = avatars.find((item) => item.id === avatarId);
                if (avatar?.default_voice_id) {
                  setSelectedVoiceId(avatar.default_voice_id);
                }
              }}
              disabled={avatarLoading || avatars.length === 0}
            >
              <option value="">Selecciona un avatar</option>
              {selectedAvatarId &&
                !avatars.some((avatar) => avatar.id === selectedAvatarId) && (
                  <option value={selectedAvatarId}>Avatar seleccionado</option>
                )}
              {avatars.map((avatar) => (
                <option key={avatar.id} value={avatar.id}>
                  {avatar.name} — {avatar.avatar_type.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          {selectedAvatar && (
            <div role="status" style={{ display: "grid", gap: "0.35rem" }}>
              <strong>{selectedAvatar.name}</strong>
              <span>
                Tipo: {selectedAvatar.avatar_type.replace(/_/g, " ")} · ID:{" "}
                {selectedAvatar.id}
              </span>
              {selectedAvatar.default_voice_id && (
                <small>
                  Voz predeterminada: {selectedAvatar.default_voice_id}
                </small>
              )}
              {selectedAvatar.supported_api_engines?.length ? (
                <small>
                  Motores compatibles:{" "}
                  {selectedAvatar.supported_api_engines.join(", ")}
                </small>
              ) : null}
              {selectedAvatar.preview_image_url && (
                <img
                  src={selectedAvatar.preview_image_url}
                  alt={`Vista previa de ${selectedAvatar.name}`}
                  loading="lazy"
                  style={{
                    width: "100%",
                    maxWidth: "180px",
                    borderRadius: "8px",
                  }}
                />
              )}
            </div>
          )}

          {avatarNextToken && (
            <button
              className="text-button"
              type="button"
              disabled={avatarLoading}
              onClick={() => void loadMoreAvatars()}
            >
              {avatarLoading ? "Cargando..." : "Cargar más avatares"}
            </button>
          )}

          <div className="heygen-field">
            <label htmlFor={`${fieldId}-heygen-voice-type`}>Voces</label>
            <select
              id={`${fieldId}-heygen-voice-type`}
              value={voiceType}
              onChange={(event) => {
                setVoiceType(event.target.value as HeyGenVoiceType);
                setVoiceLoading(true);
                setVoiceError(null);
                setVoices([]);
                setVoiceNextToken(null);
              }}
            >
              <option value="private">Voces de mi cuenta</option>
              <option value="public">Voces públicas</option>
            </select>
          </div>

          {voiceLoading && <p role="status">Cargando voces...</p>}
          {voiceError && <p role="alert">{voiceError}</p>}
          {!voiceLoading && !voiceError && voices.length === 0 && (
            <p>No hay voces disponibles con estos filtros.</p>
          )}
          <div className="heygen-field">
            <label htmlFor={`${fieldId}-heygen-selected-voice`}>Voz</label>
            <select
              id={`${fieldId}-heygen-selected-voice`}
              value={selectedVoiceId}
              onChange={(event) => setSelectedVoiceId(event.target.value)}
              disabled={
                voiceLoading || (voices.length === 0 && !defaultVoiceMissing)
              }
            >
              <option value="">Selecciona una voz</option>
              {defaultVoiceMissing && (
                <option value={selectedAvatar?.default_voice_id ?? ""}>
                  Voz predeterminada de {selectedAvatar?.name}
                </option>
              )}
              {selectedVoiceId &&
                !voices.some((voice) => voice.voice_id === selectedVoiceId) &&
                !defaultVoiceMissing && (
                  <option value={selectedVoiceId}>Voz seleccionada</option>
                )}
              {voices.map((voice) => (
                <option
                  key={voice.voice_id}
                  value={voice.voice_id}
                  disabled={voice.status != null && voice.status !== "ACTIVE"}
                >
                  {voice.name} {voice.language ? `— ${voice.language}` : ""}{" "}
                  {voice.status && voice.status !== "ACTIVE"
                    ? `(${voice.status})`
                    : ""}
                </option>
              ))}
            </select>
          </div>

          {onSelection && !valid && (
            <p>
              Selecciona un avatar disponible y una voz activa de la lista para
              continuar.
            </p>
          )}
          {selectedVoice && (
            <div role="status">
              Voz seleccionada: {selectedVoice.name}
              {selectedVoice.language ? ` · ${selectedVoice.language}` : ""}
              {" · ID: "}
              {selectedVoice.voice_id}
              {selectedVoice.mode ? ` · ${selectedVoice.mode}` : ""}
            </div>
          )}

          {voiceNextToken && (
            <button
              className="text-button"
              type="button"
              disabled={voiceLoading}
              onClick={() => void loadMoreVoices()}
            >
              {voiceLoading ? "Cargando..." : "Cargar más voces"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

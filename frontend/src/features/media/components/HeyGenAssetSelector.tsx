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
import { useLocalization } from "../../../app/localization";

const avatarTypes: (HeyGenAvatarType | "")[] = [
  "",
  "digital_twin",
  "photo_avatar",
  "studio_avatar",
];
const avatarTypeKeys = {
  studio_avatar: "heygen.avatarType.studio",
  digital_twin: "heygen.avatarType.digitalTwin",
  photo_avatar: "heygen.avatarType.photo",
} as const satisfies Record<HeyGenAvatarType, string>;

export type AssetSelection = { avatar_id: string; voice_id: string };
export function HeyGenAssetSelector({
  onSelection,
}: {
  onSelection?: (value: AssetSelection | null) => void;
}) {
  const { t } = useLocalization();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
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
  const [avatarRetry, setAvatarRetry] = useState(0);
  const [voiceRetry, setVoiceRetry] = useState(0);
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
              : tRef.current("heygen.avatarLoadError"),
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
  }, [open, avatarType, ownership, avatarRetry]);

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
              : tRef.current("heygen.voiceLoadError"),
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
  }, [open, voiceType, voiceRetry]);

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
          : tRef.current("heygen.avatarLoadError"),
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
        err instanceof Error
          ? err.message
          : tRef.current("heygen.voiceLoadError"),
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
          ? t("heygen.closeAssets")
          : t("heygen.exploreAssets")}
      </button>

      {open && (
        <div className="heygen-assets">
          <div>
            <h3>{t("heygen.assetsTitle")}</h3>
            <p>{t("heygen.assetsDescription")}</p>
          </div>

          <div className="heygen-field">
            <label htmlFor={`${fieldId}-heygen-avatar-ownership`}>
              {t("heygen.availability")}
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
              <option value="private">{t("heygen.myAvatars")}</option>
              <option value="public">{t("heygen.publicAvatars")}</option>
            </select>
          </div>

          <div className="heygen-field">
            <label htmlFor={`${fieldId}-heygen-avatar-type`}>
              {t("heygen.avatarType")}
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
              {avatarTypes.map((value) => (
                <option key={value || "all"} value={value}>
                  {value ? t(avatarTypeKeys[value]) : t("heygen.avatarType.all")}
                </option>
              ))}
            </select>
          </div>

          {avatarLoading && (
            <p role="status">{t("heygen.loadingAvatars")}</p>
          )}
          {avatarError && (
            <div className="heygen-asset-error">
              <p role="alert">{avatarError}</p>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setAvatars([]);
                  setAvatarNextToken(null);
                  setAvatarError(null);
                  setAvatarLoading(true);
                  setAvatarRetry((value) => value + 1);
                }}
              >
                {t("heygen.retryAvatars")}
              </button>
            </div>
          )}
          {!avatarLoading && !avatarError && avatars.length === 0 && (
            <p>{t("heygen.noAvatars")}</p>
          )}
          <div className="heygen-field">
            <label htmlFor={`${fieldId}-heygen-selected-avatar`}>
              {t("heygen.avatar")}
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
              <option value="">{t("heygen.selectAvatar")}</option>
              {selectedAvatarId &&
                !avatars.some((avatar) => avatar.id === selectedAvatarId) && (
                  <option value={selectedAvatarId}>
                    {t("heygen.selectedAvatar")}
                  </option>
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
                {t("heygen.avatarTypeLabel", {
                  type: selectedAvatar.avatar_type.replace(/_/g, " "),
                  id: selectedAvatar.id,
                })}
              </span>
              {selectedAvatar.default_voice_id && (
                <small>
                  {t("heygen.defaultVoice", {
                    id: selectedAvatar.default_voice_id,
                  })}
                </small>
              )}
              {selectedAvatar.supported_api_engines?.length ? (
                <small>
                  {t("heygen.supportedEngines", {
                    engines: selectedAvatar.supported_api_engines.join(", "),
                  })}
                </small>
              ) : null}
              {selectedAvatar.preview_image_url && (
                <img
                  src={selectedAvatar.preview_image_url}
                  alt={t("heygen.avatarPreview", {
                    name: selectedAvatar.name,
                  })}
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
              {avatarLoading
                ? t("heygen.loadingMoreAvatars")
                : t("heygen.loadMoreAvatars")}
            </button>
          )}

          <div className="heygen-field">
            <label htmlFor={`${fieldId}-heygen-voice-type`}>
              {t("heygen.voices")}
            </label>
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
              <option value="private">{t("heygen.myVoices")}</option>
              <option value="public">{t("heygen.publicVoices")}</option>
            </select>
          </div>

          {voiceLoading && <p role="status">{t("heygen.loadingVoices")}</p>}
          {voiceError && (
            <div className="heygen-asset-error">
              <p role="alert">{voiceError}</p>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setVoices([]);
                  setVoiceNextToken(null);
                  setVoiceError(null);
                  setVoiceLoading(true);
                  setVoiceRetry((value) => value + 1);
                }}
              >
                {t("heygen.retryVoices")}
              </button>
            </div>
          )}
          {!voiceLoading && !voiceError && voices.length === 0 && (
            <p>{t("heygen.noVoices")}</p>
          )}
          <div className="heygen-field">
            <label htmlFor={`${fieldId}-heygen-selected-voice`}>
              {t("heygen.voice")}
            </label>
            <select
              id={`${fieldId}-heygen-selected-voice`}
              value={selectedVoiceId}
              onChange={(event) => setSelectedVoiceId(event.target.value)}
              disabled={
                voiceLoading || (voices.length === 0 && !defaultVoiceMissing)
              }
            >
              <option value="">{t("heygen.selectVoice")}</option>
              {defaultVoiceMissing && (
                <option value={selectedAvatar?.default_voice_id ?? ""}>
                  {t("heygen.defaultVoiceFor", {
                    name: selectedAvatar?.name ?? "",
                  })}
                </option>
              )}
              {selectedVoiceId &&
                !voices.some((voice) => voice.voice_id === selectedVoiceId) &&
                !defaultVoiceMissing && (
                  <option value={selectedVoiceId}>
                    {t("heygen.selectedVoice")}
                  </option>
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
              {t("heygen.selectActiveAssets")}
            </p>
          )}
          {selectedVoice && (
            <div role="status">
              {t("heygen.selectedVoiceLabel", {
                name: selectedVoice.name,
              })}
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
              {voiceLoading
                ? t("heygen.loadingMoreVoices")
                : t("heygen.loadMoreVoices")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Facebook, Settings2, UserRound } from "lucide-react";

type SettingsTab = "account" | "integrations";

type Props = {
  businessId: string;
  userDisplayName: string;
  userEmail: string;
  onSaveDisplayName: (displayName: string) => Promise<string>;
  facebookConnection: ReactNode;
  instagramConnection?: ReactNode;
  tiktokConnection: ReactNode;
};

export default function SettingsPage({
  businessId,
  userDisplayName,
  userEmail,
  onSaveDisplayName,
  facebookConnection,
  instagramConnection,
  tiktokConnection,
}: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("account");
  const initialName = userDisplayName === "Mi cuenta" ? "" : userDisplayName;
  const [displayName, setDisplayName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "error" | "success";
    message: string;
  } | null>(null);
  const savingRef = useRef(false);
  const changed = displayName !== savedName;
  const maxNameLength = 80;

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || !changed) return;

    const normalized = displayName.trim();
    if (!normalized) {
      setFeedback({ type: "error", message: "Escribe un nombre para mostrar." });
      return;
    }
    if (normalized.length > maxNameLength) {
      setFeedback({
        type: "error",
        message: "El nombre no puede superar los 80 caracteres.",
      });
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setFeedback(null);
    try {
      const saved = await onSaveDisplayName(normalized);
      setDisplayName(saved);
      setSavedName(saved);
      setFeedback({
        type: "success",
        message: "Nombre para mostrar actualizado.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "No se pudo guardar el nombre. Inténtalo de nuevo.",
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="settings-workspace">
      <section className="page-intro">
        <div>
          <span className="eyebrow">Tu espacio de trabajo</span>
          <h2>Configuración</h2>
          <p>Administra tu cuenta y las conexiones de este negocio.</p>
        </div>
      </section>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Secciones de configuración">
          <button
            type="button"
            className={activeTab === "account" ? "is-active" : ""}
            aria-current={activeTab === "account" ? "page" : undefined}
            onClick={() => setActiveTab("account")}
          >
            <UserRound size={18} aria-hidden="true" />
            Cuenta
          </button>
          <button
            type="button"
            className={activeTab === "integrations" ? "is-active" : ""}
            aria-current={activeTab === "integrations" ? "page" : undefined}
            onClick={() => setActiveTab("integrations")}
          >
            <Settings2 size={18} aria-hidden="true" />
            Integraciones
          </button>
        </nav>

        {activeTab === "account" ? (
          <section className="settings-account panel" aria-labelledby="account-title">
            <div className="settings-section-heading">
              <span className="settings-section-icon" aria-hidden="true">
                <UserRound size={20} />
              </span>
              <div>
                <h3 id="account-title">Información de la cuenta</h3>
                <p>Datos asociados a tu sesión actual.</p>
              </div>
            </div>
            <form className="settings-profile-form" onSubmit={handleSave}>
              <label htmlFor="account-display-name">Nombre para mostrar</label>
              <input
                id="account-display-name"
                name="displayName"
                type="text"
                autoComplete="nickname"
                placeholder="Mi cuenta"
                value={displayName}
                maxLength={120}
                aria-invalid={feedback?.type === "error"}
                aria-describedby="account-display-name-help"
                disabled={saving}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  setFeedback(null);
                }}
              />
              <small id="account-display-name-help">
                Este nombre aparece en tu espacio de trabajo. Máximo 80
                caracteres.
              </small>
              <button
                type="submit"
                className="primary-button"
                disabled={!changed || saving}
              >
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
              {saving && (
                <p className="settings-profile-feedback" role="status">
                  Guardando cambios…
                </p>
              )}
              {feedback && (
                <p
                  className={`settings-profile-feedback settings-profile-feedback--${feedback.type}`}
                  role={feedback.type === "error" ? "alert" : "status"}
                >
                  {feedback.message}
                </p>
              )}
            </form>
            <dl className="settings-account-details">
              <div>
                <dt>Correo electrónico</dt>
                <dd>{userEmail || "No disponible"}</dd>
              </div>
            </dl>
            <p className="settings-note" role="note">
              Tu nombre de perfil es privado y solo se usa para personalizar tu
              cuenta.
            </p>
          </section>
        ) : (
          <section className="settings-integrations" aria-labelledby="integrations-title">
            <header className="settings-integrations-heading">
              <div className="settings-section-icon" aria-hidden="true">
                <Facebook size={20} />
              </div>
              <div>
                <h3 id="integrations-title">Redes sociales</h3>
                <p>
                  Las conexiones y publicaciones se administran por negocio.
                  {businessId ? "" : " Selecciona un negocio para continuar."}
                </p>
              </div>
            </header>
            {!businessId && (
              <p className="settings-note" role="status">
                No hay un negocio seleccionado.
              </p>
            )}
            <div className="settings-integration-list">
              {facebookConnection}
              {instagramConnection}
              {tiktokConnection}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

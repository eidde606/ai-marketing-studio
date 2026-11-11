import { Instagram } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getInstagramConnection,
  startInstagramConnection,
  type InstagramConnection as InstagramConnectionData,
} from "../services/instagramApi";

type Props = { businessId: string };

const statusLabels: Record<InstagramConnectionData["status"], string> = {
  not_connected: "No conectada",
  linked_not_api_authorized: "Vinculada · faltan permisos",
  connected_and_authorized: "Conectada y autorizada",
  reauthorization_required: "Requiere reconexión",
  permission_error: "Permisos insuficientes",
  discovery_error: "No se pudo verificar",
};

const callbackMessages: Record<string, string> = {
  connected_and_authorized: "Instagram quedó conectado y autorizado por Meta.",
  linked_not_api_authorized:
    "La cuenta está vinculada, pero falta el permiso para publicar. Revisa Meta y vuelve a conectar.",
  not_connected:
    "La página autorizada no devolvió una cuenta profesional de Instagram vinculada.",
  reauthorization_required:
    "Meta requiere una nueva autorización. Revisa los permisos e inténtalo otra vez.",
  permission_error:
    "Meta no concedió todos los permisos solicitados. Revisa la configuración de Instagram Login.",
  discovery_error:
    "Meta no permitió verificar la página y la cuenta de Instagram. Revisa el acceso a la página.",
  invalid_state:
    "La solicitud de conexión expiró o ya se utilizó. Inicia una conexión nueva.",
  authorization_declined: "No se completó la autorización de Instagram.",
};

export default function InstagramConnection({ businessId }: Props) {
  const [snapshot, setSnapshot] = useState<{
    businessId: string;
    retry: number;
    connection: InstagramConnectionData | null;
    error: string;
  } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [retry, setRetry] = useState(0);
  const [actionError, setActionError] = useState<{
    businessId: string;
    message: string;
  } | null>(null);
  const [notice] = useState(() => {
    const match = window.location.hash.match(/^#instagram_result=([^&]+)/);
    return match
      ? callbackMessages[match[1]] ?? "Se recibió la respuesta de Meta."
      : "";
  });
  const currentSnapshot =
    snapshot?.businessId === businessId && snapshot.retry === retry
      ? snapshot
      : null;
  const connection = currentSnapshot?.connection ?? null;
  const loading = Boolean(businessId) && !currentSnapshot;
  const error =
    actionError?.businessId === businessId
      ? actionError.message
      : currentSnapshot?.error ?? "";

  useEffect(() => {
    let active = true;
    const hash = window.location.hash;
    const match = hash.match(/^#instagram_result=([^&]+)/);
    if (match) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
    if (!businessId) return () => {
      active = false;
    };
    void getInstagramConnection(businessId)
      .then((result) => {
        if (active) {
          setSnapshot({
            businessId,
            retry,
            connection: result,
            error: "",
          });
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setSnapshot({
            businessId,
            retry,
            connection: null,
            error:
              cause instanceof Error
                ? cause.message
                : "No se pudo verificar la conexión de Instagram.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [businessId, retry]);

  async function connect() {
    if (!businessId || connecting) return;
    setConnecting(true);
    setActionError(null);
    try {
      const authorizationUrl = await startInstagramConnection(businessId);
      window.location.assign(authorizationUrl);
    } catch (cause) {
      setActionError({
        businessId,
        message:
          cause instanceof Error
            ? cause.message
            : "No se pudo iniciar la conexión con Instagram.",
      });
      setConnecting(false);
    }
  }

  const status = connection?.status ?? "not_connected";
  const connected = status === "connected_and_authorized";
  const statusClass = loading
    ? "social-status--loading"
    : connected
      ? "social-status--connected"
      : status === "not_connected"
        ? "social-status--disconnected"
        : "social-status--attention";

  return (
    <section className="panel facebook-connection social-integration social-integration--instagram">
      <div className="facebook-connection-header">
        <div className="facebook-connection-heading">
          <div className="facebook-connection-icon" aria-hidden="true">
            <Instagram size={22} />
          </div>
          <div>
            <span className="eyebrow">Meta</span>
            <h2>Conexión con Instagram</h2>
            <p>
              Autoriza la cuenta profesional vinculada a la página de Facebook
              de este negocio.
            </p>
          </div>
        </div>
        <span className={`social-status ${statusClass}`} role="status">
          {loading ? "Verificando" : statusLabels[status]}
        </span>
      </div>

      <div className="facebook-connection-content">
        <div className="facebook-connection-description">
          <strong>
            {connection?.username
              ? `@${connection.username}`
              : "Cuenta de Instagram"}
          </strong>
          <p>
            {connection?.message ??
              "La conexión se verifica con Meta. Vincular una cuenta en Business Suite no concede por sí solo permisos de API."}
          </p>
          {connection?.facebook_page_name && (
            <p>Página asociada: {connection.facebook_page_name}</p>
          )}
          {connection?.missing_permissions.length ? (
            <p>
              Permisos pendientes:{" "}
              {connection.missing_permissions.join(", ")}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="facebook-connect-button"
          onClick={() => void connect()}
          disabled={!businessId || loading || connecting}
        >
          <Instagram size={18} aria-hidden="true" />
          {connecting
            ? "Abriendo Meta…"
            : connection?.username || connected
              ? "Reconectar Instagram"
              : "Conectar Instagram"}
        </button>
      </div>

      {loading && (
        <p className="facebook-connection-message" role="status">
          Verificando el estado guardado de Instagram…
        </p>
      )}
      {notice && (
        <p className="facebook-connection-message" role="status">
          {notice}
        </p>
      )}
      {error && (
        <>
          <p className="facebook-connection-message" role="alert">
            {error}
          </p>
          <button
            type="button"
            className="outline-button"
            onClick={() => setRetry((value) => value + 1)}
          >
            Reintentar verificación
          </button>
        </>
      )}
      {!businessId && (
        <p className="facebook-connection-message" role="status">
          Selecciona un negocio para administrar Instagram.
        </p>
      )}
    </section>
  );
}

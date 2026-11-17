import { Instagram, Unlink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  disconnectInstagramConnection,
  getInstagramConnection,
  startInstagramConnection,
  type InstagramConnection as InstagramConnectionData,
} from "../services/instagramApi";
import { useLocalization } from "../app/useLocalization";
import ConfirmationDialog from "./ui/ConfirmationDialog";

type Props = { businessId: string };

const statusTranslationKeys = {
  not_connected: "instagram.status.notConnected",
  linked_not_api_authorized: "instagram.status.linked",
  connected_and_authorized: "instagram.status.connected",
  reauthorization_required: "instagram.status.reauthorize",
  permission_error: "instagram.status.permission",
  discovery_error: "instagram.status.discovery",
} as const satisfies Record<InstagramConnectionData["status"], string>;

const callbackMessageKeys = {
  connected_and_authorized: "instagram.callback.connected",
  linked_not_api_authorized: "instagram.callback.linked",
  not_connected: "instagram.callback.notConnected",
  reauthorization_required: "instagram.callback.reauthorize",
  permission_error: "instagram.callback.permission",
  discovery_error: "instagram.callback.discovery",
  invalid_state: "instagram.callback.invalid",
  authorization_declined: "instagram.callback.declined",
} as const;

export default function InstagramConnection({ businessId }: Props) {
  const { t } = useLocalization();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const [snapshot, setSnapshot] = useState<{
    businessId: string;
    retry: number;
    connection: InstagramConnectionData | null;
    error: string;
  } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState<{
    businessId: string;
    accountName: string;
    pageName: string;
  } | null>(null);
  const [disconnectError, setDisconnectError] = useState("");
  const disconnectLock = useRef(false);
  const [actionNotice, setActionNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const [actionError, setActionError] = useState<{
    businessId: string;
    message: string;
    state: "attention" | "unavailable" | "configuration";
  } | null>(null);
  const [callbackCode] = useState(() => {
    const match = window.location.hash.match(/^#instagram_result=([^&]+)/);
    return match?.[1] ?? "";
  });

  const notice = callbackCode
    ? t(
        callbackMessageKeys[callbackCode as keyof typeof callbackMessageKeys] ??
          "instagram.callback.received",
      )
    : "";
  const currentSnapshot =
    snapshot?.businessId === businessId && snapshot.retry === retry
      ? snapshot
      : null;
  const connection = currentSnapshot?.connection ?? null;
  const loading = Boolean(businessId) && !currentSnapshot;
  const error =
    actionError?.businessId === businessId
      ? actionError.message
      : (currentSnapshot?.error ?? "");
  const actionState =
    actionError?.businessId === businessId ? actionError.state : null;
  const activeDisconnectTarget =
    disconnectTarget?.businessId === businessId ? disconnectTarget : null;

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
    if (!businessId)
      return () => {
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
                : tRef.current("instagram.verifyError"),
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
    setActionNotice("");
    setActionError(null);
    try {
      const authorizationUrl = await startInstagramConnection(businessId);
      window.location.assign(authorizationUrl);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "";
      const pageRequired =
        detail === "Conecta primero una página de Facebook para este negocio.";
      const multiplePagesRequired =
        detail ===
        "Desconecta las páginas adicionales de Facebook de este negocio antes de conectar Instagram.";
      const configurationRequired =
        detail ===
        "La conexión de Instagram no está configurada en el servidor.";
      setActionError({
        businessId,
        message: pageRequired
          ? tRef.current("instagram.facebookRequired")
          : multiplePagesRequired
            ? tRef.current("instagram.facebookMultiplePages")
            : configurationRequired
              ? tRef.current("instagram.configurationRequired")
              : tRef.current("instagram.connectError"),
        state: configurationRequired
          ? "configuration"
          : pageRequired || multiplePagesRequired
            ? "attention"
            : "unavailable",
      });
      setConnecting(false);
    }
  }

  async function disconnect() {
    const target = disconnectTarget;
    if (
      !target ||
      target.businessId !== businessId ||
      disconnecting ||
      disconnectLock.current
    ) {
      return;
    }

    disconnectLock.current = true;
    setDisconnecting(true);
    setActionError(null);
    setDisconnectError("");
    setActionNotice("");
    try {
      await disconnectInstagramConnection(target.businessId);
      setActionNotice(tRef.current("instagram.disconnected"));
      setRetry((value) => value + 1);
      setDisconnectTarget(null);
    } catch {
      setDisconnectError(tRef.current("instagram.disconnectError"));
    } finally {
      disconnectLock.current = false;
      setDisconnecting(false);
    }
  }

  const status = connection?.status ?? "not_connected";
  const connected = status === "connected_and_authorized";
  const statusUnavailable =
    Boolean(currentSnapshot?.error) ||
    (Boolean(actionState) && actionState === "unavailable");
  const statusClass = loading
    ? "social-status--loading"
    : statusUnavailable || actionState === "configuration"
      ? "social-status--unavailable"
      : actionState
        ? "social-status--attention"
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
            <h2>{t("instagram.title")}</h2>
            <p>{t("instagram.description")}</p>
          </div>
        </div>
        <span className={`social-status ${statusClass}`} role="status">
          {loading
            ? t("instagram.status.loading")
            : actionState === "configuration"
              ? t("instagram.status.configuration")
              : statusUnavailable
                ? t("instagram.status.unavailable")
                : actionState
                  ? t("instagram.status.attention")
                  : t(statusTranslationKeys[status])}
        </span>
      </div>

      <div className="facebook-connection-content">
        <div className="facebook-connection-description">
          <strong>
            {connection?.username
              ? `@${connection.username}`
              : t("instagram.account")}
          </strong>
          {connection?.message && <p>{connection.message}</p>}
          <p>{t("instagram.connectionOnly")}</p>
          {connection?.facebook_page_name && (
            <p>
              {t("instagram.page", {
                name: connection.facebook_page_name,
              })}
            </p>
          )}
          {connection?.missing_permissions.length ? (
            <p>{t("instagram.permissionHelp")}</p>
          ) : null}
        </div>
        <div className="social-connection-actions">
          <button
            type="button"
            className="facebook-connect-button"
            onClick={() => void connect()}
            disabled={!businessId || loading || connecting}
          >
            <Instagram size={18} aria-hidden="true" />
            {connecting
              ? t("instagram.opening")
              : connection?.username || connected
                ? t("instagram.reconnect")
                : t("instagram.connect")}
          </button>
          {(connection?.username ||
            connection?.status === "connected_and_authorized" ||
            connection?.status === "linked_not_api_authorized" ||
            connection?.status === "reauthorization_required") && (
            <button
              type="button"
              className="outline-button social-disconnect-button"
              onClick={() =>
                setDisconnectTarget({
                  businessId,
                  accountName: connection?.username
                    ? `@${connection.username}`
                    : t("instagram.account"),
                  pageName:
                    connection?.facebook_page_name ||
                    t("instagram.connectedPageFallback"),
                })
              }
              disabled={disconnecting || connecting || loading}
            >
              <Unlink size={16} aria-hidden="true" />
              {t("instagram.disconnect")}
            </button>
          )}
        </div>
      </div>

      {loading && (
        <p className="facebook-connection-message" role="status">
          {t("instagram.loading")}
        </p>
      )}
      {notice && (
        <p className="facebook-connection-message" role="status">
          {notice}
        </p>
      )}
      {actionNotice && (
        <p className="facebook-connection-message" role="status">
          {actionNotice}
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
            {t("instagram.retry")}
          </button>
        </>
      )}
      {!businessId && (
        <p className="facebook-connection-message" role="status">
          {t("instagram.noBusiness")}
        </p>
      )}
      <ConfirmationDialog
        open={activeDisconnectTarget !== null}
        title={t("instagram.disconnectDialogTitle")}
        description={t("instagram.disconnectDialogDescription", {
          account: activeDisconnectTarget?.accountName ?? "",
          page: activeDisconnectTarget?.pageName ?? "",
        })}
        cancelLabel={t("common.cancel")}
        confirmLabel={t("instagram.confirmDisconnect")}
        pendingLabel={t("instagram.disconnecting")}
        busy={disconnecting}
        error={disconnectError}
        destructive
        icon={Unlink}
        onOpenChange={(open) => {
          if (!open) {
            setDisconnectTarget(null);
            setDisconnectError("");
          }
        }}
        onConfirm={() => void disconnect()}
      />
    </section>
  );
}

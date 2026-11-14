import { Instagram } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  getInstagramConnection,
  startInstagramConnection,
  type InstagramConnection as InstagramConnectionData,
} from "../services/instagramApi";
import { useLocalization } from "../app/localization";

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
  const [retry, setRetry] = useState(0);
  const [actionError, setActionError] = useState<{
    businessId: string;
    message: string;
  } | null>(null);
  const [callbackCode] = useState(() => {
    const match = window.location.hash.match(/^#instagram_result=([^&]+)/);
    return match?.[1] ?? "";
  });
  const notice = callbackCode
    ? t(callbackMessageKeys[callbackCode as keyof typeof callbackMessageKeys] ??
        "instagram.callback.received")
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
            : tRef.current("instagram.connectError"),
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
            <h2>{t("instagram.title")}</h2>
            <p>{t("instagram.description")}</p>
          </div>
        </div>
        <span className={`social-status ${statusClass}`} role="status">
          {loading
            ? t("instagram.status.loading")
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
            <p>
              {t("instagram.missingPermissions", {
                permissions: connection.missing_permissions.join(", "),
              })}
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
            ? t("instagram.opening")
            : connection?.username || connected
              ? t("instagram.reconnect")
              : t("instagram.connect")}
        </button>
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
    </section>
  );
}

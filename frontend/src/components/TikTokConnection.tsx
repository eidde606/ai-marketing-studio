import { useEffect, useRef, useState } from "react";
import {
  disconnectTikTokAccount,
  getConnectedTikTokAccounts,
  startTikTokConnection,
  type ConnectedTikTokAccount,
} from "../services/tiktokApi";
import { useLocalization } from "../app/useLocalization";

type Props = {
  businessId: string;
  directPublishingEnabled?: boolean;
};

export default function TikTokConnection({
  businessId,
  directPublishingEnabled = false,
}: Props) {
  const { t } = useLocalization();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [retryCount, setRetryCount] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    businessId: string;
    retryCount: number;
    accounts: ConnectedTikTokAccount[];
    message: string;
    failed: boolean;
    connectFailed: boolean;
  } | null>(null);
  const [connectingBusinessId, setConnectingBusinessId] = useState<
    string | null
  >(null);
  const [disconnectingAccountId, setDisconnectingAccountId] = useState<
    string | null
  >(null);
  const [disconnectNotice, setDisconnectNotice] = useState("");
  const [callbackResult] = useState(() => {
    const match = window.location.hash.match(/^#tiktok_result=([^&]+)/);
    if (match) return match[1];
    return window.location.hash === "#tiktok_connected=1" ? "connected" : "";
  });
  const currentSnapshot =
    snapshot?.businessId === businessId && snapshot.retryCount === retryCount
      ? snapshot
      : null;
  const accounts = currentSnapshot?.accounts ?? [];
  const message = currentSnapshot?.message ?? "";
  const loading =
    Boolean(businessId) &&
    (!currentSnapshot || connectingBusinessId === businessId);
  const connectedAccounts = accounts.filter(
    (account) => account.connection_status === "connected",
  );
  const connectionAvailable = accounts.length > 0;
  const unavailable =
    currentSnapshot?.failed ||
    (currentSnapshot?.connectFailed && connectedAccounts.length === 0);

  useEffect(() => {
    if (!businessId) return;
    let active = true;
    const hasCallbackResult =
      window.location.hash.startsWith("#tiktok_result=");
    const legacyConnectedResult =
      window.location.hash === "#tiktok_connected=1";
    if (hasCallbackResult || legacyConnectedResult) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
    async function loadAccounts() {
      try {
        const result = await getConnectedTikTokAccounts(businessId);
        if (active) {
          let resultMessage = "";
          if (
            (callbackResult === "connected" || legacyConnectedResult) &&
            result.length > 0
          )
            resultMessage = tRef.current("tiktok.verified");
          else if (
            (callbackResult === "connected" || legacyConnectedResult) &&
            result.length === 0
          )
            resultMessage = tRef.current("tiktok.wrongBusiness");
          setSnapshot({
            businessId,
            retryCount,
            accounts: result,
            message: resultMessage,
            failed: false,
            connectFailed: false,
          });
        }
      } catch {
        if (active)
          setSnapshot({
            businessId,
            retryCount,
            accounts: [],
            message: tRef.current("tiktok.verifyError"),
            failed: true,
            connectFailed: false,
          });
      }
    }
    void loadAccounts();
    return () => {
      active = false;
    };
  }, [businessId, callbackResult, retryCount]);

  async function handleConnect() {
    if (!businessId) return;
    const targetBusinessId = businessId;
    setConnectingBusinessId(targetBusinessId);
    try {
      const url = await startTikTokConnection(targetBusinessId);
      window.location.assign(url);
    } catch {
      setSnapshot({
        businessId: targetBusinessId,
        retryCount,
        accounts: currentSnapshot?.accounts ?? [],
        message: tRef.current("tiktok.connectError"),
        failed: false,
        connectFailed: true,
      });
    } finally {
      setConnectingBusinessId(null);
    }
  }

  async function handleDisconnect(account: ConnectedTikTokAccount) {
    if (
      !businessId ||
      !account.id ||
      !window.confirm(t("tiktok.disconnectConfirm"))
    ) {
      return;
    }
    setDisconnectingAccountId(account.id);
    setDisconnectNotice("");
    try {
      await disconnectTikTokAccount(businessId, account.id);
      setDisconnectNotice(tRef.current("tiktok.disconnected"));
      setSnapshot(null);
      setRetryCount((count) => count + 1);
    } catch {
      setSnapshot({
        businessId,
        retryCount,
        accounts,
        message: tRef.current("tiktok.disconnectError"),
        failed: true,
        connectFailed: false,
      });
    } finally {
      setDisconnectingAccountId(null);
    }
  }

  const callbackMessageKeys = {
    authorization_declined: "tiktok.callbackDeclined",
    invalid_state: "tiktok.callbackInvalid",
    provider_error: "tiktok.callbackError",
  } as const;
  const callbackMessageKey = Object.entries(callbackMessageKeys).find(
    ([result]) => result === callbackResult,
  )?.[1];

  return (
    <section className="panel facebook-connection social-integration social-integration--tiktok">
      <div className="facebook-connection-header">
        <div className="facebook-connection-heading">
          <div className="facebook-connection-icon" aria-hidden="true">
            ♪
          </div>
          <div>
            <span className="eyebrow">{t("tiktok.eyebrow")}</span>
            <h2>{t("tiktok.title")}</h2>
            <p>{t("tiktok.description")}</p>
          </div>
        </div>
        <span
          className={`social-status ${
            loading
              ? "social-status--loading"
              : connectedAccounts.length
                ? "social-status--connected"
                : connectionAvailable
                  ? "social-status--attention"
                  : unavailable
                    ? "social-status--unavailable"
                    : "social-status--disconnected"
          }`}
          role="status"
        >
          {loading
            ? t("tiktok.checking")
            : connectedAccounts.length
              ? t("tiktok.connectedStatus")
              : connectionAvailable
                ? t("tiktok.reviewAccess")
                : unavailable
                  ? t("tiktok.statusUnavailable")
                  : businessId
                    ? t("tiktok.notConnected")
                    : t("tiktok.noBusiness")}
        </span>
      </div>
      <div className="facebook-connection-content">
        <div className="facebook-connection-description">
          <strong>{t("tiktok.connectionSetup")}</strong>
          <p>{t("tiktok.eligibility")}</p>
          <p>
            {t(
              directPublishingEnabled
                ? "tiktok.directPublishingEnabled"
                : "tiktok.manualOnly",
            )}
          </p>
        </div>
        <button
          type="button"
          className="facebook-connect-button"
          onClick={() => void handleConnect()}
          disabled={loading || !businessId}
        >
          {connectedAccounts.length > 0
            ? t("tiktok.reconnect")
            : t("tiktok.connect")}
        </button>
      </div>
      {loading && !message && (
        <p className="facebook-connection-message" role="status">
          {t("tiktok.loading")}
        </p>
      )}
      {accounts.map((account, index) => (
        <div
          key={account.id ?? account.platform_account_id ?? index}
          className="facebook-connection-message"
        >
          <span>
            {account.account_name ??
              account.display_name ??
              t("tiktok.account")}{" "}
            —{" "}
            {account.connection_status === "connected"
              ? t("tiktok.connectedStatus")
              : account.connection_status === "reauthorization_required"
                ? t("tiktok.reauthorize")
                : account.connection_status === "pending"
                  ? t("tiktok.authorizationIncomplete")
                  : t("tiktok.unverified")}
          </span>
          {account.id && (
            <button
              type="button"
              className="outline-button"
              onClick={() => void handleDisconnect(account)}
              disabled={disconnectingAccountId === account.id}
            >
              {disconnectingAccountId === account.id
                ? t("tiktok.disconnecting")
                : t("tiktok.disconnect")}
            </button>
          )}
        </div>
      ))}
      {callbackMessageKey && (
        <p className="facebook-connection-message" role="alert">
          {t(callbackMessageKey)}
        </p>
      )}
      {disconnectNotice && (
        <p className="facebook-connection-message" role="status">
          {disconnectNotice}
        </p>
      )}
      {message && (
        <p
          className="facebook-connection-message"
          role={
            currentSnapshot?.failed || currentSnapshot?.connectFailed
              ? "alert"
              : "status"
          }
        >
          {message}
        </p>
      )}
      {!loading &&
        (currentSnapshot?.failed || currentSnapshot?.connectFailed) && (
          <button
            type="button"
            className="outline-button"
            onClick={() => setRetryCount((count) => count + 1)}
          >
            {t("tiktok.retry")}
          </button>
        )}
      {!businessId && (
        <p className="facebook-connection-message" role="status">
          {t("tiktok.noBusiness")}
        </p>
      )}
    </section>
  );
}

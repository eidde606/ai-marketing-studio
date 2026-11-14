import { useEffect, useRef, useState } from "react";
import {
  getConnectedTikTokAccounts,
  startTikTokConnection,
  type ConnectedTikTokAccount,
} from "../services/tiktokApi";
import { useLocalization } from "../app/localization";

type Props = { businessId: string };

export default function TikTokConnection({ businessId }: Props) {
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
  } | null>(null);
  const [connectingBusinessId, setConnectingBusinessId] = useState<
    string | null
  >(null);
  const currentSnapshot =
    snapshot?.businessId === businessId &&
    snapshot.retryCount === retryCount
      ? snapshot
      : null;
  const accounts = currentSnapshot?.accounts ?? [];
  const message = currentSnapshot?.message ?? "";
  const loading =
    Boolean(businessId) &&
    (!currentSnapshot || connectingBusinessId === businessId);

  useEffect(() => {
    if (!businessId) return;
    let active = true;
    const connected = window.location.hash === "#tiktok_connected=1";
    if (connected) {
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
          if (connected && result.length > 0)
            resultMessage = tRef.current("tiktok.verified");
          else if (connected)
            resultMessage = tRef.current("tiktok.wrongBusiness");
          setSnapshot({
            businessId,
            retryCount,
            accounts: result,
            message: resultMessage,
            failed: false,
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
          });
      }
    }
    void loadAccounts();
    return () => {
      active = false;
    };
  }, [businessId, retryCount]);

  async function handleConnect() {
    if (!businessId) return;
    const targetBusinessId = businessId;
    setConnectingBusinessId(targetBusinessId);
    try {
      const url = await startTikTokConnection(targetBusinessId);
      window.location.assign(url);
    } catch (error) {
      setSnapshot({
        businessId: targetBusinessId,
        retryCount,
        accounts: currentSnapshot?.accounts ?? [],
        message:
          error instanceof Error
            ? error.message
            : tRef.current("tiktok.connectError"),
        failed: false,
      });
    } finally {
      setConnectingBusinessId(null);
    }
  }

  const connectedAccounts = accounts.filter(
    (account) => account.connection_status === "connected",
  );
  const connectionAvailable = accounts.length > 0;

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
                : t("tiktok.notConnected")}
        </span>
      </div>
      <div className="facebook-connection-content">
        <div className="facebook-connection-description">
          <strong>{t("tiktok.available")}</strong>
          <p>{t("tiktok.eligibility")}</p>
          <p>{t("tiktok.manualOnly")}</p>
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
        <p
          key={account.id ?? account.platform_account_id ?? index}
          className="facebook-connection-message"
        >
          {account.account_name ??
            account.display_name ??
            t("tiktok.account")}{" "}
          —{" "}
          {account.connection_status === "connected"
            ? t("tiktok.connectedStatus")
            : t("tiktok.status", {
                status:
                  account.connection_status ?? t("tiktok.unverified"),
              })}
        </p>
      ))}
      {message && (
        <p
          className="facebook-connection-message"
          role={currentSnapshot?.failed ? "alert" : "status"}
        >
          {message}
        </p>
      )}
      {!loading && currentSnapshot?.failed && (
        <button
          type="button"
          className="outline-button"
          onClick={() => setRetryCount((count) => count + 1)}
        >
          {t("tiktok.retry")}
        </button>
      )}
    </section>
  );
}

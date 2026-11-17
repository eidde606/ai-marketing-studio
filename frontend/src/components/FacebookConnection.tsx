import { ChevronRight, Facebook, Unlink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  disconnectFacebookAccount,
  FacebookApiError,
  getConnectedFacebookAccounts,
  getFacebookHandoff,
  selectFacebookPage,
  startFacebookConnection,
  type ConnectedFacebookAccount,
  type FacebookPage,
} from "../services/facebookApi";
import { useLocalization } from "../app/useLocalization";
import type { FacebookHandoffContext } from "../app/facebookOAuthReturn";
import ConfirmationDialog from "./ui/ConfirmationDialog";

type Props = {
  businessId: string;
  handoff: FacebookHandoffContext | null;
  callbackResult: string | null;
  canManageConnections: boolean;
  onHandoffResolved: () => void;
};

export default function FacebookConnection({
  businessId,
  handoff,
  callbackResult,
  canManageConnections,
  onHandoffResolved,
}: Props) {
  const { t } = useLocalization();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const [pages, setPages] = useState<FacebookPage[]>([]);

  const [accountSnapshot, setAccountSnapshot] = useState<{
    businessId: string;
    accounts: ConnectedFacebookAccount[];
    loading: boolean;
    failed: boolean;
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [disconnectingAccountId, setDisconnectingAccountId] = useState<
    string | null
  >(null);
  const [disconnectTarget, setDisconnectTarget] = useState<{
    businessId: string;
    account: ConnectedFacebookAccount;
  } | null>(null);
  const [disconnectError, setDisconnectError] = useState("");
  const disconnectLock = useRef(false);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [connectionAttempt, setConnectionAttempt] = useState<{
    businessId: string;
    failed: boolean;
  } | null>(null);
  const [accountRefresh, setAccountRefresh] = useState(0);
  const [handoffRetry, setHandoffRetry] = useState(0);
  const [handoffError, setHandoffError] = useState(false);

  const currentAccountSnapshot =
    accountSnapshot?.businessId === businessId ? accountSnapshot : null;
  const connectedAccounts = currentAccountSnapshot?.accounts ?? [];
  const checkingAccounts =
    Boolean(businessId) &&
    (!currentAccountSnapshot || currentAccountSnapshot.loading);
  const connectedPages = connectedAccounts.filter(
    (account) => account.connection_status === "connected",
  );
  const connectionAttemptFailed =
    connectionAttempt?.businessId === businessId && connectionAttempt.failed;
  const accountsUnavailable =
    currentAccountSnapshot?.failed ||
    (connectionAttemptFailed && connectedAccounts.length === 0);
  const activeDisconnectTarget =
    disconnectTarget?.businessId === businessId ? disconnectTarget : null;

  useEffect(() => {
    if (
      !handoff ||
      handoff.businessId !== businessId ||
      !canManageConnections
    ) {
      return;
    }

    const activeHandoff = handoff;
    let active = true;

    async function loadPages() {
      setLoading(true);
      setHandoffError(false);
      setPages([]);

      try {
        const result = await getFacebookHandoff(
          activeHandoff.token,
          activeHandoff.businessId,
        );

        if (!active) return;
        if (result.business_id !== activeHandoff.businessId) {
          setHandoffError(true);
          setMessage(tRef.current("facebook.wrongBusiness"));
          setMessageIsError(true);
          return;
        }

        setPages(result.pages);
        setMessage("");
        setMessageIsError(false);
      } catch (error) {
        if (active) {
          setHandoffError(true);
          if (error instanceof FacebookApiError && error.status === 400) {
            onHandoffResolved();
            setHandoffError(false);
            setMessage(tRef.current("facebook.handoffExpired"));
          } else if (
            error instanceof FacebookApiError &&
            error.status === 403
          ) {
            setMessage(tRef.current("facebook.handoffAuthorization"));
          } else if (
            error instanceof FacebookApiError &&
            error.status === 401
          ) {
            setMessage(tRef.current("facebook.handoffSignIn"));
          } else {
            setMessage(tRef.current("facebook.pagesError"));
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadPages();

    return () => {
      active = false;
    };
  }, [
    businessId,
    canManageConnections,
    handoff,
    handoffRetry,
    onHandoffResolved,
  ]);

  useEffect(() => {
    if (!businessId) return;

    let active = true;

    async function loadConnectedAccounts() {
      try {
        const accounts = await getConnectedFacebookAccounts(businessId);

        if (active) {
          setAccountSnapshot({
            businessId,
            accounts,
            loading: false,
            failed: false,
          });
        }
      } catch {
        if (active) {
          setAccountSnapshot({
            businessId,
            accounts: [],
            loading: false,
            failed: true,
          });
        }
      }
    }

    void loadConnectedAccounts();

    return () => {
      active = false;
    };
  }, [businessId, accountRefresh]);

  async function handleConnect() {
    if (!businessId || !canManageConnections) return;

    setLoading(true);
    onHandoffResolved();
    setMessage("");
    setMessageIsError(false);
    setConnectionAttempt({ businessId, failed: false });

    try {
      const authorizationUrl = await startFacebookConnection(businessId);
      window.location.assign(authorizationUrl);
    } catch {
      setMessage(t("facebook.startError"));
      setMessageIsError(true);
      setConnectionAttempt({ businessId, failed: true });
      setLoading(false);
    }
  }

  async function handleSelectPage(pageId: string) {
    if (!handoff || handoff.businessId !== businessId) {
      setMessage(t("facebook.wrongBusiness"));
      setMessageIsError(true);
      return;
    }

    setLoading(true);
    setMessage("");
    setMessageIsError(false);

    try {
      const result = await selectFacebookPage(
        handoff.token,
        handoff.businessId,
        pageId,
      );

      setMessage(t("facebook.connectedPage", { name: result.page_name }));
      setMessageIsError(false);
      setPages([]);
      onHandoffResolved();
      setAccountRefresh((value) => value + 1);
    } catch (error) {
      if (error instanceof FacebookApiError && error.status === 400) {
        onHandoffResolved();
        setMessage(t("facebook.handoffExpired"));
      } else if (error instanceof FacebookApiError && error.status === 403) {
        setMessage(t("facebook.handoffAuthorization"));
      } else {
        setMessage(t("facebook.selectPageError"));
      }
      setMessageIsError(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    const target = disconnectTarget;
    if (
      !target ||
      target.businessId !== businessId ||
      !canManageConnections ||
      disconnectLock.current
    ) {
      return;
    }

    disconnectLock.current = true;
    setDisconnectingAccountId(target.account.id);
    setDisconnectError("");
    setMessage("");
    setMessageIsError(false);
    try {
      await disconnectFacebookAccount(target.businessId, target.account.id);
      setMessage(t("facebook.disconnected"));
      setAccountRefresh((value) => value + 1);
      setDisconnectTarget(null);
    } catch {
      setDisconnectError(tRef.current("facebook.disconnectError"));
    } finally {
      disconnectLock.current = false;
      setDisconnectingAccountId(null);
    }
  }

  const callbackMessageKeys = {
    authorization_declined: "facebook.callbackDeclined",
    invalid_state: "facebook.callbackInvalid",
    no_pages: "facebook.callbackNoPages",
    provider_error: "facebook.callbackError",
  } as const;
  const callbackMessageKey = Object.entries(callbackMessageKeys).find(
    ([result]) => result === callbackResult,
  )?.[1];
  const statusKey = !businessId
    ? "facebook.statusUnavailable"
    : loading || checkingAccounts
      ? "facebook.statusChecking"
      : connectedPages.length > 0
        ? "facebook.connected"
        : connectedAccounts.some(
              (account) =>
                account.connection_status === "reauthorization_required",
            )
          ? "facebook.reauthorize"
          : accountsUnavailable
            ? "facebook.statusUnavailable"
            : "facebook.statusDisconnected";
  const statusClass =
    statusKey === "facebook.connected"
      ? "social-status--connected"
      : statusKey === "facebook.statusChecking"
        ? "social-status--loading"
        : statusKey === "facebook.reauthorize"
          ? "social-status--attention"
          : statusKey === "facebook.statusUnavailable"
            ? "social-status--unavailable"
            : "social-status--disconnected";

  return (
    <section className="panel facebook-connection social-integration social-integration--facebook">
      <div className="facebook-connection-header">
        <div className="facebook-connection-heading">
          <div className="facebook-connection-icon">
            <Facebook size={24} />
          </div>

          <div>
            <span className="eyebrow">{t("facebook.eyebrow")}</span>
            <h2>{t("facebook.title")}</h2>
            <p>{t("facebook.description")}</p>
          </div>
        </div>

        <span className={`social-status ${statusClass}`} role="status">
          {t(statusKey)}
        </span>
      </div>

      <div className="facebook-connection-content">
        <div className="facebook-connection-description">
          <strong>{t("facebook.manageTitle")}</strong>
          <p>{t("facebook.manageDescription")}</p>
          {connectedAccounts.map((account) => (
            <p className="social-connection-account" key={account.id}>
              {account.page_name} —{" "}
              {account.connection_status === "connected"
                ? t("facebook.connected")
                : account.connection_status === "reauthorization_required"
                  ? t("facebook.reauthorize")
                  : t("facebook.statusDisconnected")}
            </p>
          ))}
        </div>
        <div className="social-connection-actions">
          <button
            type="button"
            className="facebook-connect-button"
            onClick={() => void handleConnect()}
            disabled={loading || !businessId || !canManageConnections}
          >
            <Facebook size={18} aria-hidden="true" />
            {connectedAccounts.length > 0
              ? t("facebook.reconnect")
              : t("facebook.connect")}
          </button>
          {connectedAccounts.map((account) => (
            <button
              type="button"
              className="outline-button social-disconnect-button"
              key={account.id}
              disabled={
                !canManageConnections ||
                disconnectingAccountId === account.id ||
                loading
              }
              onClick={() => {
                setDisconnectError("");
                setDisconnectTarget({ businessId, account });
              }}
            >
              <Unlink size={16} aria-hidden="true" />
              {t("facebook.disconnect")}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <p className="facebook-connection-message" role="status">
          {t("facebook.loading")}
        </p>
      )}
      {callbackMessageKey && (
        <p className="facebook-connection-message" role="status">
          {t(callbackMessageKey)}
          <button
            type="button"
            className="text-button"
            onClick={onHandoffResolved}
          >
            {t("facebook.dismissResult")}
          </button>
        </p>
      )}
      {checkingAccounts && !loading && (
        <p className="facebook-connection-message" role="status">
          {t("facebook.statusChecking")}
        </p>
      )}

      {connectedPages.length > 1 && (
        <p className="facebook-connection-message" role="status">
          {t("facebook.multiplePagesWarning")}
        </p>
      )}

      {message && (
        <p
          className="facebook-connection-message"
          role={messageIsError ? "alert" : "status"}
        >
          {message}
        </p>
      )}
      {handoff && handoff.businessId !== businessId && (
        <p className="facebook-connection-message" role="alert">
          {t("facebook.wrongBusiness")}
        </p>
      )}
      {handoff && !canManageConnections && (
        <p className="facebook-connection-message" role="alert">
          {t("facebook.handoffAuthorization")}
        </p>
      )}
      {handoffError && handoff && (
        <button
          type="button"
          className="outline-button"
          onClick={() => setHandoffRetry((value) => value + 1)}
        >
          {t("facebook.retry")}
        </button>
      )}
      {accountsUnavailable && !message && (
        <div className="facebook-connection-message" role="alert">
          <p>{t("facebook.verifyError")}</p>
          <button
            type="button"
            className="outline-button"
            onClick={() => {
              setConnectionAttempt({ businessId, failed: false });
              setAccountRefresh((value) => value + 1);
            }}
          >
            {t("facebook.retry")}
          </button>
        </div>
      )}
      {!businessId && (
        <p className="facebook-connection-message" role="status">
          {t("facebook.noBusiness")}
        </p>
      )}

      {pages.length > 0 && handoff && handoff.businessId === businessId && (
        <div className="facebook-page-selection">
          <h3>{t("facebook.choosePageTitle")}</h3>
          <p>{t("facebook.choosePageDescription")}</p>

          <div className="facebook-page-list">
            {pages.map((page) => (
              <button
                key={page.id}
                type="button"
                className="facebook-page-button"
                disabled={loading || handoff.businessId !== businessId}
                onClick={() => void handleSelectPage(page.id)}
              >
                <Facebook size={18} />
                <span>{page.name}</span>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
        </div>
      )}
      <ConfirmationDialog
        open={activeDisconnectTarget !== null}
        title={t("facebook.disconnectDialogTitle")}
        description={t("facebook.disconnectDialogDescription", {
          name: activeDisconnectTarget?.account.page_name ?? "",
        })}
        cancelLabel={t("common.cancel")}
        confirmLabel={t("facebook.confirmDisconnect")}
        pendingLabel={t("facebook.disconnecting")}
        busy={disconnectingAccountId !== null}
        error={disconnectError}
        destructive
        icon={Unlink}
        onOpenChange={(open) => {
          if (!open) {
            setDisconnectTarget(null);
            setDisconnectError("");
          }
        }}
        onConfirm={() => void handleDisconnect()}
      />
    </section>
  );
}

import { useEffect, useState } from "react";
import {
  getConnectedTikTokAccounts,
  startTikTokConnection,
  type ConnectedTikTokAccount,
} from "../services/tiktokApi";

type Props = { businessId: string };

export default function TikTokConnection({ businessId }: Props) {
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
            resultMessage = "Se verificó la cuenta de TikTok para este negocio.";
          else if (connected)
            resultMessage = "Verifica que hayas seleccionado el negocio correcto.";
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
            message:
            "No se pudo verificar la conexión de TikTok. Inténtalo de nuevo.",
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
          error instanceof Error ? error.message : "No se pudo iniciar TikTok.",
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
            <span className="eyebrow">Redes sociales</span>
            <h2>Conexión con TikTok</h2>
            <p>
              Autoriza TikTok para este negocio y revisa el estado de la cuenta
              conectada.
            </p>
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
            ? "Verificando"
            : connectedAccounts.length
              ? "Conectada"
              : connectionAvailable
                ? "Revisar acceso"
                : "No conectada"}
        </span>
      </div>
      <div className="facebook-connection-content">
        <div className="facebook-connection-description">
          <strong>La autorización de TikTok está disponible</strong>
          <p>
            La publicación depende de los permisos concedidos y de la
            elegibilidad de la cuenta. Esta pantalla confirma la conexión; no
            garantiza que cada publicación sea aceptada por TikTok.
          </p>
        </div>
        <button
          type="button"
          className="facebook-connect-button"
          onClick={() => void handleConnect()}
          disabled={loading || !businessId}
        >
          {connectedAccounts.length > 0
            ? "Reconectar TikTok"
            : "Conectar TikTok"}
        </button>
      </div>
      {loading && !message && (
        <p className="facebook-connection-message" role="status">
          Verificando el estado de TikTok…
        </p>
      )}
      {accounts.map((account, index) => (
        <p
          key={account.id ?? account.platform_account_id ?? index}
          className="facebook-connection-message"
        >
          {account.account_name ?? account.display_name ?? "Cuenta de TikTok"} —{" "}
          {account.connection_status === "connected"
            ? "Conectada"
            : `Estado: ${account.connection_status ?? "sin verificar"}`}
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
          Reintentar verificación
        </button>
      )}
    </section>
  );
}

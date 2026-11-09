import { useEffect, useState } from "react";
import {
  getConnectedTikTokAccounts,
  startTikTokConnection,
  type ConnectedTikTokAccount,
} from "../services/tiktokApi";

type Props = { businessId: string };

export default function TikTokConnection({ businessId }: Props) {
  const [accounts, setAccounts] = useState<ConnectedTikTokAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

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
      setAccounts([]);
      setMessage("");
      try {
        const result = await getConnectedTikTokAccounts(businessId);
        if (active) {
          setAccounts(result);
          if (connected && result.length > 0)
            setMessage("TikTok conectado correctamente.");
          else if (connected)
            setMessage("Verifica que hayas seleccionado el negocio correcto.");
        }
      } catch {
        if (active) setMessage("No se pudo verificar la conexión de TikTok.");
      }
    }
    void loadAccounts();
    return () => {
      active = false;
    };
  }, [businessId]);

  async function handleConnect() {
    if (!businessId) return;
    setLoading(true);
    setMessage("");
    try {
      const url = await startTikTokConnection(businessId);
      window.location.assign(url);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No se pudo iniciar TikTok.",
      );
      setLoading(false);
    }
  }

  return (
    <section className="panel facebook-connection">
      <div className="facebook-connection-header">
        <div className="facebook-connection-heading">
          <div className="facebook-connection-icon" aria-hidden="true">
            ♪
          </div>
          <div>
            <span className="eyebrow">Redes sociales</span>
            <h2>Conexión con TikTok</h2>
            <p>Vincula tu cuenta de TikTok con AI Marketing Studio.</p>
          </div>
        </div>
        <span className="facebook-connection-badge">Configuración</span>
      </div>
      <div className="facebook-connection-content">
        <div className="facebook-connection-description">
          <strong>Administra tu cuenta desde un solo lugar</strong>
          <p>Autoriza TikTok para preparar la integración de publicaciones.</p>
        </div>
        <button
          type="button"
          className="facebook-connect-button"
          onClick={() => void handleConnect()}
          disabled={loading || !businessId}
        >
          {accounts.length > 0 ? "Reconectar TikTok" : "Conectar TikTok"}
        </button>
      </div>
      {loading && (
        <p className="facebook-connection-message" role="status">
          Conectando...
        </p>
      )}
      {accounts.map((account, index) => (
        <p
          key={account.id ?? account.platform_account_id ?? index}
          className="facebook-connection-message"
        >
          {account.account_name ?? account.display_name ?? "Cuenta de TikTok"} —{" "}
          {account.connection_status ?? "Conectada"}
        </p>
      ))}
      {message && (
        <p className="facebook-connection-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

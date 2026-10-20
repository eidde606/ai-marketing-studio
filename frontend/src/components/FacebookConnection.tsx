import { ChevronRight, Facebook } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getFacebookHandoff,
  selectFacebookPage,
  startFacebookConnection,
  type FacebookPage,
} from "../services/facebookApi";

type Props = {
  businessId: string;
};

export default function FacebookConnection({ businessId }: Props) {
  const [pages, setPages] = useState<FacebookPage[]>([]);
  const [handoffToken, setHandoffToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [handoffBusinessId, setHandoffBusinessId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!handoffToken) return;

    const token = handoffToken;
    let active = true;

    async function loadPages() {
      setLoading(true);

      try {
        const result = await getFacebookHandoff(token);

        if (!active) return;

        setPages(result.pages);
        setHandoffBusinessId(result.business_id);
        setMessage("");
      } catch {
        if (active) {
          setMessage("No se pudieron recuperar las páginas de Facebook.");
          setHandoffToken(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadPages();

    return () => {
      active = false;
    };
  }, [handoffToken]);

  async function handleConnect() {
    if (!businessId) return;

    setLoading(true);
    setMessage("");

    try {
      const authorizationUrl = await startFacebookConnection(businessId);
      window.location.assign(authorizationUrl);
    } catch {
      setMessage("No se pudo iniciar la conexión con Facebook.");
      setLoading(false);
    }
  }

  async function handleSelectPage(pageId: string) {
    if (!handoffToken || handoffBusinessId !== businessId) {
      setMessage("Selecciona el negocio correcto antes de continuar.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const result = await selectFacebookPage(handoffToken, pageId);

      setMessage(`Página conectada: ${result.page_name}`);
      setPages([]);
      setHandoffToken(null);
      setHandoffBusinessId(null);
    } catch {
      setMessage("No se pudo conectar la página seleccionada.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel facebook-connection">
      <div className="facebook-connection-header">
        <div className="facebook-connection-heading">
          <div className="facebook-connection-icon">
            <Facebook size={24} />
          </div>

          <div>
            <span className="eyebrow">Redes sociales</span>
            <h2>Conexión con Facebook</h2>
            <p>
              Vincula una página de Facebook para publicar contenido desde AI
              Marketing Studio.
            </p>
          </div>
        </div>

        <span className="facebook-connection-badge">
          {pages.length > 0 ? "Seleccionar página" : "Configuración"}
        </span>
      </div>

      <div className="facebook-connection-content">
        <div className="facebook-connection-description">
          <strong>Administra tus publicaciones desde un solo lugar</strong>
          <p>
            Autoriza tu cuenta de Facebook y selecciona la página que deseas
            administrar.
          </p>
        </div>

        <button
          type="button"
          className="facebook-connect-button"
          onClick={() => void handleConnect()}
          disabled={loading || !businessId}
        >
          <Facebook size={18} />
          Conectar Facebook
        </button>
      </div>

      {loading && (
        <p className="facebook-connection-message" role="status">
          Procesando conexión...
        </p>
      )}

      {message && (
        <p className="facebook-connection-message" role="status">
          {message}
        </p>
      )}

      {pages.length > 0 && (
        <div className="facebook-page-selection">
          <h3>Selecciona una página</h3>
          <p>Elige la página que deseas conectar con este negocio.</p>

          <div className="facebook-page-list">
            {pages.map((page) => (
              <button
                key={page.id}
                type="button"
                className="facebook-page-button"
                disabled={loading || handoffBusinessId !== businessId}
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
    </section>
  );
}

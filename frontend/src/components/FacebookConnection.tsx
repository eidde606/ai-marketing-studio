import { ChevronRight, Facebook } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  getConnectedFacebookAccounts,
  getFacebookHandoff,
  selectFacebookPage,
  startFacebookConnection,
  type ConnectedFacebookAccount,
  type FacebookPage,
} from "../services/facebookApi";
import { useLocalization } from "../app/localization";

type Props = {
  businessId: string;
};

export default function FacebookConnection({ businessId }: Props) {
  const { t } = useLocalization();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [pages, setPages] = useState<FacebookPage[]>([]);

  const [connectedAccounts, setConnectedAccounts] = useState<
    ConnectedFacebookAccount[]
  >([]);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [handoffToken, setHandoffToken] = useState<string | null>(() => {
    const hash = window.location.hash;
    console.log(
      "Facebook handoff present:",
      hash.startsWith("#facebook_handoff="),
    );

    if (!hash.startsWith("#facebook_handoff=")) {
      return null;
    }

    const token = hash.substring("#facebook_handoff=".length);

    return token || null;
  });

  const [handoffBusinessId, setHandoffBusinessId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!handoffToken) return;

    if (window.location.hash.startsWith("#facebook_handoff=")) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }

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
          setMessage(tRef.current("facebook.pagesError"));
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

  useEffect(() => {
    if (!businessId) return;

    let active = true;

    async function loadConnectedAccounts() {
      try {
        const accounts = await getConnectedFacebookAccounts(businessId);

        if (active) {
          setConnectedAccounts(accounts);
        }
      } catch {
        if (active) {
          setMessage(tRef.current("facebook.verifyError"));
        }
      }
    }

    void loadConnectedAccounts();

    return () => {
      active = false;
    };
  }, [businessId]);

  async function handleConnect() {
    if (!businessId) return;

    setLoading(true);
    setMessage("");

    try {
      const authorizationUrl = await startFacebookConnection(businessId);
      window.location.assign(authorizationUrl);
    } catch {
      setMessage(t("facebook.startError"));
      setLoading(false);
    }
  }

  async function handleSelectPage(pageId: string) {
    if (!handoffToken || handoffBusinessId !== businessId) {
      setMessage(t("facebook.wrongBusiness"));
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const result = await selectFacebookPage(handoffToken, pageId);

      setMessage(t("facebook.connectedPage", { name: result.page_name }));
      setPages([]);
      setHandoffToken(null);
      setHandoffBusinessId(null);
    } catch {
      setMessage(t("facebook.selectPageError"));
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
            <span className="eyebrow">{t("facebook.eyebrow")}</span>
            <h2>{t("facebook.title")}</h2>
            <p>{t("facebook.description")}</p>
          </div>
        </div>

        <span className="facebook-connection-badge">
          {pages.length > 0
            ? t("facebook.selectPage")
            : t("facebook.settings")}
        </span>
      </div>

      <div className="facebook-connection-content">
        <div className="facebook-connection-description">
          <strong>{t("facebook.manageTitle")}</strong>
          <p>{t("facebook.manageDescription")}</p>
        </div>

        <button
          type="button"
          className="facebook-connect-button"
          onClick={() => void handleConnect()}
          disabled={loading || !businessId}
        >
          <Facebook size={18} />
          {connectedAccounts.length > 0
            ? t("facebook.reconnect")
            : t("facebook.connect")}
        </button>
      </div>

      {loading && (
        <p className="facebook-connection-message" role="status">
          {t("facebook.loading")}
        </p>
      )}

      {connectedAccounts.map((account) => (
        <p key={account.id} className="facebook-connection-message">
          {account.page_name} —{" "}
          {account.connection_status === "connected"
            ? t("facebook.connected")
            : account.connection_status}
        </p>
      ))}

      {message && (
        <p className="facebook-connection-message" role="status">
          {message}
        </p>
      )}

      {pages.length > 0 && (
        <div className="facebook-page-selection">
          <h3>{t("facebook.choosePageTitle")}</h3>
          <p>{t("facebook.choosePageDescription")}</p>

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

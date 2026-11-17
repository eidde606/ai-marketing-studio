import { LoaderCircle, Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { Translate } from "../../app/localization";
import { useLocalization } from "../../app/useLocalization";
import { ApiError } from "../../lib/apiClient";
import LegalFooter from "./LegalFooter";
import { policyCopy } from "./legalContent";
import {
  pagePaths,
  type LegalPage,
} from "./pagePaths";
import {
  submitContactRequest,
  type ContactCategory,
} from "./services/contactApi";

const categories: ReadonlyArray<
  readonly [ContactCategory, Parameters<Translate>[0]]
> = [
  ["general", "legal.contact.category.general"],
  ["technical", "legal.contact.category.technical"],
  ["billing", "legal.contact.category.billing"],
  ["privacy", "legal.contact.category.privacy"],
  ["problem", "legal.contact.category.problem"],
];

const contactStatusKeys = {
  success: "legal.contact.success",
  error: "legal.contact.error",
  unavailable: "legal.contact.unavailable",
  rateLimited: "legal.contact.rateLimited",
} as const;

function ContactForm() {
  const { t } = useLocalization();
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<
    "success" | "error" | "unavailable" | "rateLimited" | null
  >(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;

    const form = event.currentTarget;
    const values = new FormData(form);
    setSending(true);
    setStatus(null);

    try {
      await submitContactRequest({
        name: String(values.get("name") ?? ""),
        email: String(values.get("email") ?? ""),
        category: String(values.get("category") ?? "") as ContactCategory,
        message: String(values.get("message") ?? ""),
        website: String(values.get("website") ?? ""),
      });
      form.reset();
      setStatus("success");
    } catch (error) {
      setStatus(
        error instanceof ApiError && error.status === 429
          ? "rateLimited"
          : error instanceof ApiError && error.status === 503
            ? "unavailable"
            : "error",
      );
    } finally {
      setSending(false);
    }
  }

  const statusMessage = status ? t(contactStatusKeys[status]) : "";

  return (
    <form className="legal-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor="contact-name">{t("legal.contact.name")}</label>
      <input
        id="contact-name"
        name="name"
        autoComplete="name"
        required
        minLength={2}
        maxLength={120}
      />

      <label htmlFor="contact-email">{t("legal.contact.email")}</label>
      <input
        id="contact-email"
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={254}
      />

      <label htmlFor="contact-category">{t("legal.contact.category")}</label>
      <select id="contact-category" name="category" required defaultValue="general">
        {categories.map(([value, label]) => (
          <option value={value} key={value}>
            {t(label)}
          </option>
        ))}
      </select>

      <label htmlFor="contact-message">{t("legal.contact.message")}</label>
      <textarea
        id="contact-message"
        name="message"
        required
        minLength={10}
        maxLength={5000}
        rows={7}
      />
      <p className="legal-form__privacy">{t("legal.contact.privacy")}</p>

      <div className="legal-honeypot" aria-hidden="true">
        <label htmlFor="contact-website">Website</label>
        <input
          id="contact-website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <button
        className="legal-form__submit"
        disabled={sending}
        type="submit"
        aria-busy={sending}
      >
        {sending ? (
          <LoaderCircle
            className="legal-form__spinner"
            size={18}
            aria-hidden="true"
          />
        ) : (
          <Send size={17} aria-hidden="true" />
        )}
        {t(sending ? "legal.contact.sending" : "legal.contact.submit")}
      </button>
      {statusMessage && (
        <p
          className={`legal-form__status legal-form__status--${status}`}
          role={status === "success" ? "status" : "alert"}
        >
          {statusMessage}
        </p>
      )}
    </form>
  );
}

export default function LegalPages({ page }: { page: LegalPage }) {
  const { locale, setInterfaceLanguage, t } = useLocalization();
  const isContact = page === "contact";
  const content = isContact ? null : policyCopy[page][locale];

  return (
    <div className="legal-shell">
      <header className="legal-header">
        <a href="/" className="legal-brand">
          AI Marketing Studio
        </a>
        <label className="legal-language-control">
          <span className="sr-only">{t("legal.language")}</span>
          <select
            aria-label={t("legal.language")}
            value={locale}
            onChange={(event) =>
              void setInterfaceLanguage(event.target.value as "en" | "es")
            }
          >
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </label>
      </header>

      <main className="legal-main">
        <p className="legal-eyebrow">NAZBORT TECH LLC</p>
        {isContact ? (
          <>
            <h1>{t("legal.contact.title")}</h1>
            <p className="legal-intro">{t("legal.contact.intro")}</p>
            <ContactForm />
          </>
        ) : (
          <>
            <p className="legal-draft-status">{t("legal.draftStatus")}</p>
            <h1>{content?.title}</h1>
            <p className="legal-intro">{content?.intro}</p>
            <p className="legal-draft" role="note">
              {t("legal.draftNotice")}
            </p>
            {content?.sections.map((section) => (
              <section className="legal-section" key={section.heading}>
                <h2>{section.heading}</h2>
                <p>{section.body}</p>
              </section>
            ))}
            {page === "data-deletion" && (
              <p className="legal-action-link">
                <a href={pagePaths.contact}>{t("legal.link.contact")}</a>
              </p>
            )}
          </>
        )}
      </main>
      <LegalFooter />
    </div>
  );
}

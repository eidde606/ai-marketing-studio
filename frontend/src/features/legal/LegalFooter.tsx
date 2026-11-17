import { useLocalization } from "../../app/useLocalization";
import { pagePaths, type LegalPage } from "./pagePaths";

type LinkLabel =
  | "legal.link.privacy"
  | "legal.link.terms"
  | "legal.link.subscriptions"
  | "legal.link.deletion"
  | "legal.link.contact";

const links: ReadonlyArray<
  readonly [LegalPage, LinkLabel]
> = [
  ["privacy", "legal.link.privacy"],
  ["terms", "legal.link.terms"],
  ["subscriptions", "legal.link.subscriptions"],
  ["data-deletion", "legal.link.deletion"],
  ["contact", "legal.link.contact"],
];

export default function LegalFooter({
  className = "",
}: {
  className?: string;
}) {
  const { t } = useLocalization();
  return (
    <footer className={`legal-footer ${className}`.trim()}>
      <nav aria-label={t("legal.navigation")}>
        {links.map(([page, label]) => (
          <a href={pagePaths[page]} key={page}>
            {t(label)}
          </a>
        ))}
      </nav>
      <small>© {new Date().getFullYear()} Nazbort Tech LLC</small>
    </footer>
  );
}

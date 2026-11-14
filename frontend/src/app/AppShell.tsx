import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import Sidebar, {
  getSectionLabel,
  type Section,
} from "../components/Sidebar";
import type { Business } from "../services/businessesApi";
import { useLocalization } from "./localization";

type Props = {
  activeSection: Section;
  onSectionChange: (section: Section) => void;
  pendingCount: number;
  businesses: Business[];
  selectedBusinessId: string;
  onBusinessChange: (id: string) => void;
  onAddBusiness: () => void;
  onSignOut: () => Promise<unknown>;
  onRefreshAccess: () => Promise<void>;
  businessError: string | null;
  onRetryBusinessLoad: () => Promise<void>;
  userDisplayName: string;
  userEmail: string;
  children: ReactNode;
};

export default function AppShell({
  activeSection,
  onSectionChange,
  pendingCount,
  businesses,
  selectedBusinessId,
  onBusinessChange,
  onAddBusiness,
  onSignOut,
  onRefreshAccess,
  businessError,
  onRetryBusinessLoad,
  userDisplayName,
  userEmail,
  children,
}: Props) {
  const {
    locale,
    setInterfaceLanguage,
    preferenceError,
    t,
  } = useLocalization();
  const accountName = userDisplayName || t("shell.myAccount");
  return (
    <div className="app-shell">
      <Sidebar
        activeSection={activeSection}
        onSectionChange={onSectionChange}
        pendingCount={pendingCount}
        userDisplayName={accountName}
      />
      <main className="main-content app-shell__main">
        <header className="app-shell__topbar">
          <div className="app-shell__heading">
            <span className="app-shell__eyebrow">
              {t("shell.marketingStudio")}
            </span>
            <h1>{getSectionLabel(activeSection, t)}</h1>
          </div>
          <div className="app-shell__actions">
            <select
              aria-label={t("shell.selectBusiness")}
              value={selectedBusinessId}
              onChange={(event) => onBusinessChange(event.target.value)}
              disabled={businesses.length === 0}
            >
              {businesses.length === 0 && (
                <option value="">{t("shell.noBusinesses")}</option>
              )}
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="primary-button app-shell__add-business"
              onClick={onAddBusiness}
            >
              + {t("shell.addBusiness")}
            </button>
            <label className="sr-only" htmlFor="workspace-language">
              {t("language.choose")}
            </label>
            <select
              id="workspace-language"
              aria-label={t("language.choose")}
              value={locale}
              onChange={(event) =>
                void setInterfaceLanguage(event.target.value as "en" | "es")
              }
              className="app-shell__language"
            >
              <option value="en">{t("common.english")}</option>
              <option value="es">{t("common.spanish")}</option>
            </select>
            <div className="app-shell__account">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="app-shell__account-trigger"
                    aria-label={t("shell.accountMenu", {
                      name: accountName,
                    })}
                  >
                    <span className="app-shell__avatar" aria-hidden="true">
                      {Array.from(accountName.trim())[0]?.toLocaleUpperCase(
                        locale,
                      ) ?? "T"}
                    </span>
                    <span className="app-shell__account-name">
                      {accountName}
                    </span>
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>
                    <div className="flex flex-col gap-1">
                      <span>{accountName}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {userEmail || t("common.emailUnavailable")}
                      </span>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => void onRefreshAccess()}
                    className="cursor-pointer"
                  >
                    {t("shell.refreshAccess")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => void onSignOut()}
                    className="cursor-pointer"
                  >
                    <LogOut className="mr-2 size-4" />
                    {t("shell.signOut")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {businessError && (
              <div className="app-shell__error">
                <span role="alert">{businessError}</span>
                <button
                  type="button"
                  onClick={() => void onRetryBusinessLoad()}
                >
                  {t("common.retry")}
                </button>
              </div>
            )}
            {preferenceError && (
              <span className="app-shell__error" role="status">
                {t("language.saveError")}
              </span>
            )}
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}

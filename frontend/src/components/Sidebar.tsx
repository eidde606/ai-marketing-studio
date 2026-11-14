
import {
  BarChart3,
  Check,
  FileText,
  Home,
  Menu,
  Network,
  Settings,
  Sparkles,
  Target,
} from 'lucide-react';

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useLocalization, type Translate } from "../app/localization";

export type Section =
  | 'Resumen'
  | 'Campañas'
  | 'Contenido'
  | 'Equipo IA'
  | 'Aprobaciones'
  | 'Analíticas'
  | 'Configuración';

type SidebarProps = {
  activeSection: Section;
  onSectionChange: (section: Section) => void;
  pendingCount: number;
  userDisplayName: string;
};

type NavigationProps = Omit<SidebarProps, "userDisplayName"> & {
  closeOnSelect?: boolean;
};

const sections: Array<{
  label: Section;
  icon: typeof Home;
}> = [
  { label: 'Resumen', icon: Home },
  { label: 'Campañas', icon: Target },
  { label: 'Contenido', icon: FileText },
  { label: 'Equipo IA', icon: Network },
  { label: 'Aprobaciones', icon: Check },
  { label: 'Analíticas', icon: BarChart3 },
  { label: 'Configuración', icon: Settings },
];

function Brand() {
  return (
    <div className="app-sidebar__brand">
      <div className="app-sidebar__brand-mark">
        <Sparkles className="size-5" aria-hidden="true" />
      </div>

      <div className="app-sidebar__brand-name">
        <strong>AI Marketing</strong>
        <span>STUDIO</span>
      </div>
    </div>
  );
}

const sectionMessage: Record<Section, Parameters<Translate>[0]> = {
  Resumen: "nav.home",
  Campañas: "nav.campaigns",
  Contenido: "nav.content",
  "Equipo IA": "nav.aiTeam",
  Aprobaciones: "nav.approvals",
  Analíticas: "nav.analytics",
  Configuración: "nav.settings",
};

export function getSectionLabel(section: Section, t: Translate) {
  return t(sectionMessage[section]);
}

function UserFooter({
  userDisplayName,
}: Pick<SidebarProps, "userDisplayName">) {
  const { locale, t } = useLocalization();
  const initial =
    Array.from(userDisplayName.trim())[0]?.toLocaleUpperCase(locale) ?? "U";

  return (
    <div className="app-sidebar__user">
      <div className="app-sidebar__user-avatar" aria-hidden="true">
        {initial}
      </div>

      <div className="app-sidebar__user-info">
        <strong title={userDisplayName}>{userDisplayName}</strong>
        <span>{t("shell.workAccount")}</span>
      </div>
    </div>
  );
}

function Navigation({
  activeSection,
  onSectionChange,
  pendingCount,
  closeOnSelect = false,
}: NavigationProps) {
  const { t } = useLocalization();
  return (
    <nav aria-label={t("nav.main")} className="app-sidebar__navigation">
      <span className="app-sidebar__nav-label">{t("nav.workspace")}</span>

      {sections.map(({ label, icon: Icon }) => {
        const active = activeSection === label;

        const item = (
          <button
            type="button"
            className={`app-sidebar__nav-item${active ? " is-active" : ""}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => onSectionChange(label)}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="app-sidebar__nav-text">
              {getSectionLabel(label, t)}
            </span>

            {label === 'Aprobaciones' && pendingCount > 0 && (
              <b
                className="app-sidebar__count"
                aria-label={t("nav.pendingApprovals", {
                  count: pendingCount,
                })}
              >
                {pendingCount}
              </b>
            )}
          </button>
        );

        return closeOnSelect ? (
          <SheetClose asChild key={label}>
            {item}
          </SheetClose>
        ) : (
          <div key={label}>{item}</div>
        );
      })}
    </nav>
  );
}

export function Sidebar({
  activeSection,
  onSectionChange,
  pendingCount,
  userDisplayName,
}: SidebarProps) {
  const { t } = useLocalization();
  return (
    <>
      <aside className="app-sidebar">
        <Brand />

        <div className="app-sidebar__nav-wrap">
          <Navigation
            activeSection={activeSection}
            onSectionChange={onSectionChange}
            pendingCount={pendingCount}
          />
        </div>

        <div className="app-sidebar__footer">
          <UserFooter userDisplayName={userDisplayName} />
        </div>
      </aside>

      <div className="app-sidebar__mobile">
        <Sheet>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label={t("nav.open")}
              className="app-sidebar__mobile-trigger"
            >
              <Menu className="size-5" aria-hidden="true" />
            </button>
          </SheetTrigger>

          <SheetContent
            side="left"
            className="app-sidebar__mobile-content"
          >
            <SheetHeader className="app-sidebar__mobile-header">
              <Brand />

              <SheetTitle className="sr-only">
                {t("nav.main")}
              </SheetTitle>

              <SheetDescription className="sr-only">
                {t("nav.workspace")}
              </SheetDescription>
            </SheetHeader>

            <div className="app-sidebar__nav-wrap">
              <Navigation
                activeSection={activeSection}
                onSectionChange={onSectionChange}
                pendingCount={pendingCount}
                closeOnSelect
              />
            </div>

            <div className="app-sidebar__footer">
              <UserFooter userDisplayName={userDisplayName} />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

export default Sidebar;

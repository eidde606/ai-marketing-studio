
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
    <div className="flex items-center gap-3 px-3">
      <div className="grid size-9 place-items-center rounded-xl bg-violet-500 text-white">
        <Sparkles className="size-5" aria-hidden="true" />
      </div>

      <div>
        <strong className="block text-sm text-white">
          AI Marketing
        </strong>
        <span className="block text-[10px] tracking-[0.18em] text-slate-400">
          STUDIO
        </span>
      </div>
    </div>
  );
}

function UserFooter() {
  return (
    <div className="flex items-center gap-3 border-t border-violet-950/80 px-2 pt-4">
      <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-600 text-xs font-bold text-white">
        Á
      </div>

      <div className="min-w-0">
        <strong className="block truncate text-sm text-white">
          Ángela
        </strong>
        <span className="block text-xs text-slate-400">
          Administradora
        </span>
      </div>
    </div>
  );
}

function Navigation({
  activeSection,
  onSectionChange,
  pendingCount,
  closeOnSelect = false,
}: SidebarProps & { closeOnSelect?: boolean }) {
  return (
    <nav
      aria-label="Navegación principal"
      className="flex flex-col gap-1"
    >
      <span className="mb-2 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
        Espacio de trabajo
      </span>

      {sections.map(({ label, icon: Icon }) => {
        const active = activeSection === label;

        const item = (
          <button
            type="button"
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
              active
                ? 'bg-violet-950 text-white'
                : 'text-slate-400 hover:bg-white/10 hover:text-white'
            }`}
            aria-current={active ? 'page' : undefined}
            onClick={() => onSectionChange(label)}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />

            <span>{label}</span>

            {label === 'Aprobaciones' && pendingCount > 0 && (
              <b className="ml-auto rounded-full bg-violet-500 px-2 py-0.5 text-xs text-white">
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
}: SidebarProps) {
  return (
    <>
      {/* Desktop navigation */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-[#171529] p-6 md:flex">
        <Brand />

        <div className="mt-10">
          <Navigation
            activeSection={activeSection}
            onSectionChange={onSectionChange}
            pendingCount={pendingCount}
          />
        </div>

        <div className="mt-auto">
          <UserFooter />
        </div>
      </aside>

      {/* Mobile navigation */}
      <div className="fixed left-4 top-4 z-40 md:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="Abrir navegación principal"
              className="grid size-10 place-items-center rounded-lg bg-[#171529] text-white shadow-lg"
            >
              <Menu className="size-5" aria-hidden="true" />
            </button>
          </SheetTrigger>

          <SheetContent
            side="left"
            className="flex h-full w-72 max-w-[85vw] flex-col border-violet-950 bg-[#171529] p-6 text-white"
          >
            <SheetHeader className="p-0">
              <Brand />

              <SheetTitle className="sr-only">
                Navegación principal
              </SheetTitle>

              <SheetDescription className="sr-only">
                Secciones del espacio de trabajo de AI Marketing Studio
              </SheetDescription>
            </SheetHeader>

            <div className="mt-8">
              <Navigation
                activeSection={activeSection}
                onSectionChange={onSectionChange}
                pendingCount={pendingCount}
                closeOnSelect
              />
            </div>

            <div className="mt-auto">
              <UserFooter />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

export default Sidebar;

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
import Sidebar, { type Section } from "../components/Sidebar";
import type { Business } from "../services/businessesApi";

type Props = {
  activeSection: Section;
  onSectionChange: (section: Section) => void;
  pendingCount: number;
  businesses: Business[];
  selectedBusinessId: string;
  onBusinessChange: (id: string) => void;
  onAddBusiness: () => void;
  onSignOut: () => Promise<unknown>;
  businessError: string | null;
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
  businessError,
  children,
}: Props) {
  return (
    <div className="app-shell">
      <Sidebar
        activeSection={activeSection}
        onSectionChange={onSectionChange}
        pendingCount={pendingCount}
      />
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-heading">
            <span className="eyebrow">Estudio de marketing</span>
            <h1>{activeSection}</h1>
          </div>
          <div className="topbar-actions">
            <select
              aria-label="Seleccionar negocio"
              value={selectedBusinessId}
              onChange={(event) => onBusinessChange(event.target.value)}
              disabled={businesses.length === 0}
            >
              {businesses.length === 0 && (
                <option value="">Sin negocios</option>
              )}
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="primary-button add-business-button"
              onClick={onAddBusiness}
            >
              + Agregar negocio
            </button>
            <div className="topbar-account">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="account-trigger"
                    aria-label="Abrir menú de Ángela"
                  >
                    <span className="avatar small">Á</span>
                    <span className="account-name">Ángela</span>
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>
                    <div className="flex flex-col gap-1">
                      <span>Ángela</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        Administradora
                      </span>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => void onSignOut()}
                    className="cursor-pointer"
                  >
                    <LogOut className="mr-2 size-4" />
                    Cerrar sesión
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {businessError && (
              <span className="topbar-error" role="alert">
                {businessError}
              </span>
            )}
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}

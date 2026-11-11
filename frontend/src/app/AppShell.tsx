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
  businessError,
  userDisplayName,
  userEmail,
  children,
}: Props) {
  return (
    <div className="app-shell">
      <Sidebar
        activeSection={activeSection}
        onSectionChange={onSectionChange}
        pendingCount={pendingCount}
        userDisplayName={userDisplayName}
      />
      <main className="main-content app-shell__main">
        <header className="app-shell__topbar">
          <div className="app-shell__heading">
            <span className="app-shell__eyebrow">Estudio de marketing</span>
            <h1>{activeSection}</h1>
          </div>
          <div className="app-shell__actions">
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
              className="primary-button app-shell__add-business"
              onClick={onAddBusiness}
            >
              + Agregar negocio
            </button>
            <div className="app-shell__account">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="app-shell__account-trigger"
                    aria-label={`Abrir menú de ${userDisplayName}`}
                  >
                    <span className="app-shell__avatar" aria-hidden="true">
                      {Array.from(userDisplayName.trim())[0]?.toLocaleUpperCase(
                        "es",
                      ) ?? "T"}
                    </span>
                    <span className="app-shell__account-name">
                      {userDisplayName}
                    </span>
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>
                    <div className="flex flex-col gap-1">
                      <span>{userDisplayName}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {userEmail || "Correo no disponible"}
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
              <span className="app-shell__error" role="alert">
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

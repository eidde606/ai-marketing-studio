import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session, AuthChangeEvent } from "@supabase/supabase-js";
import type { ComponentProps } from "react";
import App from "./App";
import type ApprovalPage from "./components/ApprovalPage";
import type DashboardOverview from "./components/DashboardOverview";
import type { Business } from "./services/businessesApi";
import type { Draft } from "./services/draftsApi";
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
  updateUser: vi.fn(),
  unsubscribe: vi.fn(),
  onAuthStateChange: vi.fn(),
  getBusinesses: vi.fn(),
  getDrafts: vi.fn(),
  getConnectedFacebookAccounts: vi.fn(),
  generateContent: vi.fn(),
  publishDraftToFacebook: vi.fn(),
  approveDraft: vi.fn(),
  updateDraftDestinations: vi.fn(),
  updateDraft: vi.fn(),
  deleteDraft: vi.fn(),
  rejectDraft: vi.fn(),
  generateDraftImage: vi.fn(),
  createImageRevision: vi.fn(),
  getImageRevisions: vi.fn(),
  acceptImageRevision: vi.fn(),
  rejectImageRevision: vi.fn(),
  publishDraftToTikTok: vi.fn(),
  verifyTikTokPublication: vi.fn(),
  verifyFacebookVideo: vi.fn(),
  getDraftImage: vi.fn(),
}));
vi.mock("./services/supabaseClient", () => ({ supabase: { auth: mocks } }));
vi.mock("./services/businessesApi", () => ({
  getBusinesses: mocks.getBusinesses,
}));
vi.mock("./services/draftsApi", async (original) => ({
  ...(await original<object>()),
  getDrafts: mocks.getDrafts,
  generateContent: mocks.generateContent,
  publishDraftToFacebook: mocks.publishDraftToFacebook,
  approveDraft: mocks.approveDraft,
  updateDraftDestinations: mocks.updateDraftDestinations,
  updateDraft: mocks.updateDraft,
  deleteDraft: mocks.deleteDraft,
  rejectDraft: mocks.rejectDraft,
  generateDraftImage: mocks.generateDraftImage,
  createImageRevision: mocks.createImageRevision,
  getImageRevisions: mocks.getImageRevisions,
  acceptImageRevision: mocks.acceptImageRevision,
  rejectImageRevision: mocks.rejectImageRevision,
  publishDraftToTikTok: mocks.publishDraftToTikTok,
  verifyTikTokPublication: mocks.verifyTikTokPublication,
  verifyFacebookVideo: mocks.verifyFacebookVideo,
  getDraftImage: mocks.getDraftImage,
}));
vi.mock("./services/facebookApi", () => ({
  getConnectedFacebookAccounts: mocks.getConnectedFacebookAccounts,
}));
vi.mock("./components/AuthPage", () => ({
  default: ({
    recoveryMode,
    onRecoveryComplete,
  }: {
    recoveryMode?: boolean;
    onRecoveryComplete?: () => void;
  }) => (
    <button onClick={onRecoveryComplete}>
      {recoveryMode ? "Recuperar contraseña" : "Iniciar sesión"}
    </button>
  ),
}));
vi.mock("./components/SofiaChat", () => ({ default: () => null }));
vi.mock("./components/FacebookConnection", () => ({ default: () => null }));
vi.mock("./components/DashboardOverview", () => ({
  default: (props: ComponentProps<typeof DashboardOverview>) => (
    <div>
      <h2>Hola, {props.userDisplayName}</h2>
      {props.draftMessages}
      {props.visibleDrafts.map((d) => (
        <p key={d.id}>{d.title}</p>
      ))}
      <button onClick={props.handleGenerateContent}>Generar contenido</button>
    </div>
  ),
}));
vi.mock("./components/ApprovalPage", () => ({
  default: (props: ComponentProps<typeof ApprovalPage>) => (
    <div>
      {props.draftMessages}
      {props.visibleDrafts.map((d) => (
        <div key={d.id}>
          <p>{d.title}</p>
          <span data-testid={`draft-state-${d.id}`}>
            {d.status}:{d.campaign_id}:{d.caption}
          </span>
          <button onClick={() => props.startEditing(d)}>Editar {d.id}</button>
          <button onClick={() => props.handleSaveEdit(d.id)}>
            Guardar {d.id}
          </button>
          <button onClick={() => props.handleDelete(d.id)}>
            Eliminar {d.id}
          </button>
          <button onClick={() => props.handleReject(d.id)}>
            Rechazar {d.id}
          </button>
          <button onClick={() => props.handleApprove(d.id)}>
            Aprobar {d.id}
          </button>
          <button
            onClick={() =>
              props.handlePublishTikTok(d.id, "account-1", "SELF_ONLY", {
                disable_comment: true,
                disable_duet: false,
                disable_stitch: true,
              })
            }
          >
            TikTok {d.id}
          </button>
          <button onClick={() => props.onVerifyTikTok(d.id)}>
            Verificar TikTok {d.id}
          </button>
          <span data-testid={`tiktok-status-${d.id}`}>
            {d.tiktok_publish_status}
          </span>
          <button onClick={() => props.handleGenerateImage(d)}>
            Generar imagen {d.id}
          </button>
          <button onClick={() => props.handleCreateRevision(d)}>
            Revisar imagen {d.id}
          </button>
          <button onClick={() => props.handleDecideRevision(d, "accept")}>
            Aceptar imagen {d.id}
          </button>
          <button onClick={() => props.refreshRevision(d.id)}>
            Historial imagen {d.id}
          </button>
          <input
            aria-label={`Instrucciones ${d.id}`}
            value={props.imageInstructions[d.id] ?? ""}
            onChange={(e) =>
              props.updateImageInstructions(d.id, e.target.value)
            }
          />
          <output>
            {props.revisionErrors[d.id]}
            {props.imageErrors[d.id]}
          </output>
          <span data-testid={`publish-status-${d.id}`}>
            {d.facebook_publish_status}
          </span>
          <button
            disabled={props.publishingIds.includes(d.id)}
            onClick={() => props.handlePublishFacebook(d.id)}
          >
            Publicar {d.id}
          </button>
          <button onClick={() => props.handlePreviewImage(d)}>
            Imagen {d.id}
          </button>
        </div>
      ))}
      <input
        aria-label="Título sin guardar"
        value={props.editTitle}
        onChange={(event) => props.setEditTitle(event.target.value)}
      />
      <input
        aria-label="Texto sin guardar"
        value={props.editCaption}
        onChange={(e) => props.setEditCaption(e.target.value)}
      />
      <output>{Object.values(props.imageUrls).join(",")}</output>
    </div>
  ),
}));
vi.mock("./components/CampaignsPage", () => ({
  default: () => <p>Página de campañas</p>,
}));
vi.mock("./components/ContentPage", () => ({
  default: () => <p>Página de contenido</p>,
}));
vi.mock("./components/BusinessForm", () => ({
  default: ({ onCreated }: { onCreated: (b: Business) => void }) => (
    <button onClick={() => onCreated(business("c"))}>
      Crear negocio de prueba
    </button>
  ),
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const session = {
  user: { id: "user-1" },
  access_token: "test-token",
} as Session;
function business(id: string): Business {
  return {
    id,
    name: `Negocio ${id}`,
    description: null,
    target_audience: null,
    brand_voice: null,
    created_at: "2026-01-01",
  };
}
function draft(id: string): Draft {
  return {
    id,
    business_id: id,
    title: `Borrador ${id}`,
    deleted_at: null,
    published_at: null,
    status: "pending",
  } as Draft;
}
let authChange: (event: AuthChangeEvent, value: Session | null) => void;
async function openApp() {
  render(<App />);
  await screen.findByRole("option", { name: "Negocio a" });
}
function select(id: string) {
  fireEvent.change(screen.getByLabelText("Seleccionar negocio"), {
    target: { value: id },
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected network request");
    }),
  );
  mocks.getSession.mockResolvedValue({ data: { session } });
  mocks.updateUser.mockReset();
  mocks.onAuthStateChange.mockImplementation((callback) => {
    authChange = callback;
    return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
  });
  mocks.signOut.mockImplementation(async () => authChange("SIGNED_OUT", null));
  mocks.getBusinesses.mockResolvedValue([business("a"), business("b")]);
  mocks.getDrafts.mockResolvedValue([]);
  mocks.getConnectedFacebookAccounts.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("waits for authentication and unsubscribes", async () => {
  const pending = deferred<{ data: { session: Session | null } }>();
  mocks.getSession.mockReturnValue(pending.promise);
  const view = render(<App />);
  expect(screen.getByText("Cargando...")).toBeTruthy();
  expect(mocks.getBusinesses).not.toHaveBeenCalled();
  await act(async () => pending.resolve({ data: { session: null } }));
  expect(screen.getByText("Iniciar sesión")).toBeTruthy();
  view.unmount();
  expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
});
it("handles session initialization failure", async () => {
  mocks.getSession.mockRejectedValue(new Error("offline"));
  render(<App />);
  expect(await screen.findByText("Iniciar sesión")).toBeTruthy();
});
it("preserves the workspace through same-account password recovery", async () => {
  await openApp();
  act(() => authChange("PASSWORD_RECOVERY", session));
  expect(mocks.getBusinesses).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("Recuperar contraseña"));
  await screen.findByRole("option", { name: "Negocio a" });
  expect(screen.getByRole("heading", { name: "Resumen" })).toBeTruthy();
  expect(mocks.getBusinesses).toHaveBeenCalledTimes(1);
  expect(mocks.getDrafts).toHaveBeenCalledTimes(1);
});
it("logs out through the Spanish account menu", async () => {
  await openApp();
  fireEvent.keyDown(screen.getByLabelText("Abrir menú de Mi cuenta"), {
    key: "Enter",
  });
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Cerrar sesión" }),
  );
  expect(await screen.findByText("Iniciar sesión")).toBeTruthy();
  expect(mocks.signOut).toHaveBeenCalledTimes(1);
});
it("displays the authenticated name and a neutral fallback", async () => {
  await openApp();
  expect(screen.getByLabelText("Abrir menú de Mi cuenta")).toBeTruthy();

  const namedSession = {
    ...session,
    user: {
      ...session.user,
      user_metadata: { full_name: "María López" },
    },
  } as Session;
  mocks.getSession.mockResolvedValue({ data: { session: namedSession } });
  cleanup();
  render(<App />);

  expect(
    await screen.findByLabelText("Abrir menú de María López"),
  ).toBeTruthy();
  expect(screen.getAllByText("María López")).toHaveLength(2);
});
it("updates the account, sidebar, dashboard and restored session display name", async () => {
  const updatedSession = {
    ...session,
    user: {
      ...session.user,
      user_metadata: { display_name: "Ana Pérez" },
    },
  } as Session;
  mocks.updateUser.mockResolvedValue({
    data: { user: updatedSession.user },
    error: null,
  });

  await openApp();
  fireEvent.click(screen.getByRole("button", { name: "Configuración" }));
  const input = await screen.findByLabelText("Nombre para mostrar");
  fireEvent.change(input, { target: { value: "  Ana Pérez  " } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

  await screen.findByText("Nombre para mostrar actualizado.");
  expect(mocks.updateUser).toHaveBeenCalledWith({
    data: { display_name: "Ana Pérez" },
  });
  expect(screen.getByLabelText("Abrir menú de Ana Pérez")).toBeTruthy();
  expect(screen.getAllByText("Ana Pérez").length).toBeGreaterThanOrEqual(2);

  fireEvent.click(screen.getByRole("button", { name: "Resumen" }));
  expect(screen.getByRole("heading", { name: "Hola, Ana Pérez" })).toBeTruthy();

  mocks.getSession.mockResolvedValue({ data: { session: updatedSession } });
  cleanup();
  await openApp();
  expect(screen.getByLabelText("Abrir menú de Ana Pérez")).toBeTruthy();
});
it("keeps all navigation destinations keyboard-focusable and closes mobile navigation after selection", async () => {
  await openApp();
  const trigger = screen.getByLabelText("Abrir navegación principal");
  trigger.focus();
  expect(document.activeElement).toBe(trigger);

  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog");
  const mobileNavigation = within(dialog).getByRole("navigation", {
    name: "Navegación principal",
  });
  expect(within(mobileNavigation).getAllByRole("button")).toHaveLength(7);
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();

  fireEvent.click(trigger);
  const reopenedDialog = await screen.findByRole("dialog");
  const analyticsButton = within(
    within(reopenedDialog).getByRole("navigation", {
      name: "Navegación principal",
    }),
  ).getByRole("button", {
    name: "Analíticas",
  });
  analyticsButton.focus();
  expect(document.activeElement).toBe(analyticsButton);
  fireEvent.click(analyticsButton);

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen.getByRole("heading", { name: "Analíticas", level: 2 }),
  ).toBeTruthy();
  expect(localStorage.getItem("ai-marketing-studio:section")).toBe(
    "Analíticas",
  );
});
it("selects the first business and remembers changes per user", async () => {
  await openApp();
  expect(
    (screen.getByLabelText("Seleccionar negocio") as HTMLSelectElement).value,
  ).toBe("a");
  select("b");
  expect(localStorage.getItem("ai-marketing-studio:business:user-1")).toBe("b");
  expect(mocks.getDrafts).toHaveBeenLastCalledWith("b", true);
});
it.each([
  ["b", "b"],
  ["missing", "a"],
])("restores saved business %s as %s", async (saved, expected) => {
  localStorage.setItem("ai-marketing-studio:business:user-1", saved);
  await openApp();
  expect(
    (screen.getByLabelText("Seleccionar negocio") as HTMLSelectElement).value,
  ).toBe(expected);
});
it("works without browser storage", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  await openApp();
  select("b");
  expect(mocks.getDrafts).toHaveBeenLastCalledWith("b", true);
});
it("handles empty businesses", async () => {
  mocks.getBusinesses.mockResolvedValue([]);
  render(<App />);
  await screen.findByText("Sin negocios");
  expect(
    (screen.getByLabelText("Seleccionar negocio") as HTMLSelectElement)
      .disabled,
  ).toBe(true);
  expect(mocks.getDrafts).not.toHaveBeenCalled();
});
it("shows business failures without retries", async () => {
  mocks.getBusinesses.mockRejectedValue(new Error("offline"));
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "No se pudieron cargar los negocios.",
  );
  expect(mocks.getBusinesses).toHaveBeenCalledTimes(1);
});
it.each([false, true])(
  "ignores stale drafts (failure: %s)",
  async (failure) => {
    const old = deferred<Draft[]>();
    mocks.getDrafts.mockImplementation((id: string) =>
      id === "a" ? old.promise : Promise.resolve([draft("b")]),
    );
    await openApp();
    expect(await screen.findByText("Cargando borradores...")).toBeTruthy();
    select("b");
    await screen.findByText("Borrador b");
    await act(async () => {
      if (failure) old.reject(new Error("old"));
      else old.resolve([draft("a")]);
    });
    expect(screen.queryByText("Borrador a")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Borrador b")).toBeTruthy();
  },
);
it("ignores businesses arriving after logout", async () => {
  const old = deferred<Business[]>();
  mocks.getBusinesses.mockReturnValue(old.promise);
  render(<App />);
  await screen.findByRole("heading", { name: "Resumen" });
  act(() => authChange("SIGNED_OUT", null));
  await act(async () => old.resolve([business("a")]));
  expect(mocks.getDrafts).not.toHaveBeenCalled();
  expect(screen.getByText("Iniciar sesión")).toBeTruthy();
});
it("creates and selects a business; navigation closes its form", async () => {
  await openApp();
  fireEvent.click(screen.getByText("+ Agregar negocio"));
  fireEvent.click(screen.getByText("Crear negocio de prueba"));
  expect(
    (screen.getByLabelText("Seleccionar negocio") as HTMLSelectElement).value,
  ).toBe("c");
  fireEvent.click(screen.getByText("+ Agregar negocio"));
  fireEvent.click(screen.getByRole("button", { name: "Campañas" }));
  expect(screen.queryByText("Crear negocio de prueba")).toBeNull();
  expect(screen.getByText("Página de campañas")).toBeTruthy();
  expect(localStorage.getItem("ai-marketing-studio:section")).toBe("Campañas");
});
it("preserves Spanish navigation restoration and fallback", async () => {
  localStorage.setItem("ai-marketing-studio:section", "Contenido");
  const view = render(<App />);
  expect(
    await screen.findByRole("heading", { name: "Contenido" }),
  ).toBeTruthy();
  view.unmount();
  localStorage.setItem("ai-marketing-studio:section", "Analíticas");
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "Analíticas", level: 2 }),
  ).toBeTruthy();
});
it("shows draft loading failures", async () => {
  mocks.getDrafts.mockRejectedValue(new Error("offline"));
  await openApp();
  expect((await screen.findByRole("alert")).textContent).toContain(
    "No se pudieron cargar los borradores",
  );
});
it("does not let an old session lookup undo logout", async () => {
  const old = deferred<{ data: { session: Session } }>();
  mocks.getSession.mockReturnValue(old.promise);
  render(<App />);
  act(() => authChange("SIGNED_OUT", null));
  await act(async () => old.resolve({ data: { session } }));
  expect(screen.getByText("Iniciar sesión")).toBeTruthy();
  expect(mocks.getBusinesses).not.toHaveBeenCalled();
});
it("keeps another user's selection private while their businesses load", async () => {
  await openApp();
  select("b");
  const next = deferred<Business[]>();
  mocks.getBusinesses.mockReturnValue(next.promise);
  act(() =>
    authChange("SIGNED_IN", {
      ...session,
      user: { ...session.user, id: "user-2" },
    }),
  );
  expect(screen.queryByRole("option", { name: "Negocio b" })).toBeNull();
  expect(
    localStorage.getItem("ai-marketing-studio:business:user-2"),
  ).toBeNull();
  await act(async () => next.resolve([business("c")]));
  expect(
    (screen.getByLabelText("Seleccionar negocio") as HTMLSelectElement).value,
  ).toBe("c");
});
it("ignores generation from an earlier visit to the same business", async () => {
  const old = deferred<Draft>();
  mocks.generateContent.mockReturnValue(old.promise);
  await openApp();
  fireEvent.click(screen.getByText("Generar contenido"));
  select("b");
  select("a");
  await act(async () => old.resolve(draft("a")));
  expect(screen.getByRole("heading", { name: "Resumen" })).toBeTruthy();
  expect(screen.queryByText("Borrador a")).toBeNull();
  expect(mocks.generateContent).toHaveBeenCalledTimes(1);
});
it("keeps in-flight publishing locked across business visits and ignores old errors", async () => {
  const old = deferred<never>();
  mocks.publishDraftToFacebook.mockReturnValue(old.promise);
  mocks.getDrafts.mockImplementation((id: string) =>
    Promise.resolve([
      {
        ...draft(id),
        status: "approved",
        facebook_publish_status: "not_published",
      },
    ]),
  );
  await openApp();
  fireEvent.click(screen.getByRole("button", { name: /^Aprobaciones/ }));
  fireEvent.click(await screen.findByText("Publicar a"));
  select("b");
  await screen.findByText("Borrador b");
  select("a");
  const button = await screen.findByText("Publicar a");
  expect((button as HTMLButtonElement).disabled).toBe(true);
  await act(async () => old.reject(new Error("old failure")));
  expect(screen.queryByRole("alert")).toBeNull();
  expect((button as HTMLButtonElement).disabled).toBe(false);
  expect(mocks.publishDraftToFacebook).toHaveBeenCalledTimes(1);
});
it("still displays publishing errors for the current business", async () => {
  mocks.publishDraftToFacebook.mockRejectedValue(new Error("offline"));
  mocks.getDrafts.mockResolvedValue([
    {
      ...draft("a"),
      status: "approved",
      facebook_publish_status: "not_published",
    },
  ]);
  await openApp();
  fireEvent.click(screen.getByRole("button", { name: /^Aprobaciones/ }));
  fireEvent.click(await screen.findByText("Publicar a"));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "No se pudo confirmar la publicación",
  );
  select("b");
  expect(screen.queryByRole("alert")).toBeNull();
});
it("does not restore an image from an earlier visit to the business", async () => {
  const old = deferred<{ image_url: string }>();
  mocks.getDraftImage.mockReturnValue(old.promise);
  mocks.getDrafts.mockImplementation((id: string) =>
    Promise.resolve([draft(id)]),
  );
  await openApp();
  fireEvent.click(screen.getByRole("button", { name: /^Aprobaciones/ }));
  fireEvent.click(await screen.findByText("Imagen a"));
  select("b");
  await screen.findByText("Borrador b");
  select("a");
  await screen.findByText("Borrador a");
  await act(async () => old.resolve({ image_url: "old-image-url" }));
  expect(screen.queryByText("old-image-url")).toBeNull();
  expect(mocks.getDraftImage).toHaveBeenCalledTimes(1);
});
it("ignores generation after logout and a new login to the same account", async () => {
  const old = deferred<Draft>();
  mocks.generateContent.mockReturnValue(old.promise);
  await openApp();
  fireEvent.click(screen.getByText("Generar contenido"));
  act(() => authChange("SIGNED_OUT", null));
  act(() => authChange("SIGNED_IN", session));
  await screen.findByRole("option", { name: "Negocio a" });
  await act(async () => old.resolve(draft("a")));
  expect(screen.getByRole("heading", { name: "Resumen" })).toBeTruthy();
  expect(screen.queryByText("Borrador a")).toBeNull();
});
it("does not reload businesses or drafts on token refresh", async () => {
  await openApp();
  const businessCalls = mocks.getBusinesses.mock.calls.length;
  const draftCalls = mocks.getDrafts.mock.calls.length;
  act(() =>
    authChange("TOKEN_REFRESHED", { ...session, access_token: "new-token" }),
  );
  expect(mocks.getBusinesses).toHaveBeenCalledTimes(businessCalls);
  expect(mocks.getDrafts).toHaveBeenCalledTimes(draftCalls);
});
it("ignores stale Facebook connection status after switching businesses", async () => {
  const old = deferred<unknown[]>();
  mocks.getConnectedFacebookAccounts.mockImplementation((id: string) =>
    id === "a" ? old.promise : Promise.resolve([]),
  );
  await openApp();
  select("b");
  fireEvent.click(screen.getByRole("button", { name: "Equipo IA" }));
  await screen.findByText(
    "Conecta una página de Facebook para consultar estadísticas",
  );
  await act(async () => old.resolve([{ id: "old-account" }]));
  expect(
    screen.queryByText("Análisis de interacciones de Facebook disponible"),
  ).toBeNull();
  expect(
    screen.getByText(
      "Conecta una página de Facebook para consultar estadísticas",
    ),
  ).toBeTruthy();
});
it("keeps the mobile Spanish navigation working", async () => {
  await openApp();
  fireEvent.click(screen.getByLabelText("Abrir navegación principal"));
  const menu = await screen.findByRole("dialog");
  fireEvent.click(within(menu).getByRole("button", { name: "Campañas" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("heading", { name: "Campañas" })).toBeTruthy();
});
it("adds current generated content and opens approvals", async () => {
  mocks.generateContent.mockResolvedValue(draft("a"));
  await openApp();
  fireEvent.click(screen.getByText("Generar contenido"));
  expect(
    await screen.findByRole("heading", { name: "Aprobaciones" }),
  ).toBeTruthy();
  expect(screen.getByText("Borrador a")).toBeTruthy();
  expect(mocks.generateContent).toHaveBeenCalledTimes(1);
  expect(mocks.generateContent).toHaveBeenCalledWith("a");
});

it.each([false, true])(
  "ignores pending draft responses after logout (failure: %s)",
  async (failure) => {
    const old = deferred<Draft[]>();
    mocks.getDrafts.mockReturnValueOnce(old.promise).mockResolvedValue([]);
    await openApp();
    await screen.findByText("Cargando borradores...");
    act(() => authChange("SIGNED_OUT", null));
    expect(screen.getByText("Iniciar sesión")).toBeTruthy();
    act(() => authChange("SIGNED_IN", session));
    await screen.findByRole("option", { name: "Negocio a" });
    await act(async () => {
      if (failure) old.reject(new Error("old draft failure"));
      else old.resolve([draft("a")]);
    });
    expect(screen.queryByText("Borrador a")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.getDrafts).toHaveBeenCalledTimes(2);
  },
);

it.each(["current", "business switch", "logout"])(
  "handles publishing success after %s",
  async (transition) => {
    const old = deferred<{ status: string; facebook_post_id: string }>();
    mocks.publishDraftToFacebook.mockReturnValue(old.promise);
    mocks.getDrafts.mockImplementation((id: string) =>
      Promise.resolve([
        {
          ...draft(id),
          status: "approved",
          facebook_publish_status: "not_published",
        },
      ]),
    );
    await openApp();
    fireEvent.click(screen.getByRole("button", { name: /^Aprobaciones/ }));
    fireEvent.click(await screen.findByText("Publicar a"));
    if (transition === "business switch") {
      select("b");
      await screen.findByText("Borrador b");
      select("a");
    } else if (transition === "logout") {
      act(() => authChange("SIGNED_OUT", null));
      expect(screen.getByText("Iniciar sesión")).toBeTruthy();
      act(() => authChange("SIGNED_IN", session));
    }
    await screen.findByText("Borrador a");
    await act(async () =>
      old.resolve({ status: "published", facebook_post_id: "old-post" }),
    );
    expect(screen.getByTestId("publish-status-a").textContent).toBe(
      transition === "current" ? "published" : "not_published",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.publishDraftToFacebook).toHaveBeenCalledTimes(1);
    expect(mocks.publishDraftToFacebook).toHaveBeenCalledWith("a");
  },
);

it("retains unsaved edits, business selection and a pending publish lock during recovery", async () => {
  const pending = deferred<{ status: string; facebook_post_id: string }>();
  mocks.publishDraftToFacebook.mockReturnValue(pending.promise);
  mocks.getDrafts.mockImplementation((id: string) =>
    Promise.resolve([
      {
        ...draft(id),
        status: "approved",
        facebook_publish_status: "not_published",
      },
    ]),
  );
  await openApp();
  select("b");
  fireEvent.click(screen.getByRole("button", { name: /^Aprobaciones/ }));
  fireEvent.click(await screen.findByText("Publicar b"));
  fireEvent.change(screen.getByLabelText("Título sin guardar"), {
    target: { value: "Mi edición pendiente" },
  });
  act(() => authChange("PASSWORD_RECOVERY", session));
  expect(screen.queryByRole("heading", { name: "Aprobaciones" })).toBeNull();
  expect(screen.queryByLabelText("Título sin guardar")).toBeNull();
  act(() =>
    authChange("TOKEN_REFRESHED", { ...session, access_token: "refreshed" }),
  );
  expect(screen.getByText("Recuperar contraseña")).toBeTruthy();
  fireEvent.click(screen.getByText("Recuperar contraseña"));
  expect(
    (screen.getByLabelText("Título sin guardar") as HTMLInputElement).value,
  ).toBe("Mi edición pendiente");
  expect(
    (screen.getByLabelText("Seleccionar negocio") as HTMLSelectElement).value,
  ).toBe("b");
  expect((screen.getByText("Publicar b") as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(mocks.getBusinesses).toHaveBeenCalledTimes(1);
  expect(mocks.getDrafts).toHaveBeenCalledTimes(2);
  await act(async () =>
    pending.resolve({ status: "published", facebook_post_id: "new-post" }),
  );
  expect(screen.getByTestId("publish-status-b").textContent).toBe("published");
  expect((screen.getByText("Publicar b") as HTMLButtonElement).disabled).toBe(
    false,
  );
  expect(mocks.publishDraftToFacebook).toHaveBeenCalledTimes(1);
});

it("applies a pending generation result while same-account recovery is displayed", async () => {
  const pending = deferred<Draft>();
  mocks.generateContent.mockReturnValue(pending.promise);
  await openApp();
  fireEvent.click(screen.getByText("Generar contenido"));
  act(() => authChange("PASSWORD_RECOVERY", session));
  await act(async () => pending.resolve(draft("a")));
  expect(screen.getByText("Recuperar contraseña")).toBeTruthy();
  expect(screen.queryByText("Borrador a")).toBeNull();
  fireEvent.click(screen.getByText("Recuperar contraseña"));
  expect(screen.getByRole("heading", { name: "Aprobaciones" })).toBeTruthy();
  expect(screen.getByText("Borrador a")).toBeTruthy();
  expect(mocks.generateContent).toHaveBeenCalledTimes(1);
  expect(mocks.getBusinesses).toHaveBeenCalledTimes(1);
});

it.each(["logout", "account change"])(
  "discards recovery and old pending work on %s",
  async (transition) => {
    const pending = deferred<Draft>();
    mocks.generateContent.mockReturnValue(pending.promise);
    await openApp();
    fireEvent.click(screen.getByText("Generar contenido"));
    act(() => authChange("PASSWORD_RECOVERY", session));
    if (transition === "logout") {
      act(() => authChange("SIGNED_OUT", null));
      expect(screen.getByText("Iniciar sesión")).toBeTruthy();
    } else {
      act(() =>
        authChange("SIGNED_IN", {
          ...session,
          user: { ...session.user, id: "user-2" },
        }),
      );
      expect(screen.queryByText("Recuperar contraseña")).toBeNull();
      await screen.findByRole("option", { name: "Negocio a" });
    }
    act(() => authChange("SIGNED_IN", session));
    await screen.findByRole("option", { name: "Negocio a" });
    await act(async () => pending.resolve(draft("a")));
    expect(screen.queryByText("Recuperar contraseña")).toBeNull();
    expect(screen.queryByText("Borrador a")).toBeNull();
    expect(screen.getByRole("heading", { name: "Resumen" })).toBeTruthy();
  },
);

// Phase 4 characterization: all services are mocked; no provider requests.
const editableDraft = {
  ...draft("a"),
  caption: "Texto original",
  campaign_id: "campaign-1",
  image_prompt: "A cafe",
  image_url: null,
  image_status: "not_started",
  publish_destinations: ["facebook"],
} as Draft;
async function openDraftActions() {
  mocks.getDrafts.mockResolvedValue([editableDraft]);
  await openApp();
  fireEvent.click(screen.getByRole("button", { name: /^Aprobaciones/ }));
  await screen.findByText("Editar a");
}
it("saves trimmed edits and preserves the campaign association", async () => {
  mocks.updateDraft.mockResolvedValue({
    ...editableDraft,
    title: "Nuevo",
    caption: "Texto nuevo",
  });
  await openDraftActions();
  fireEvent.click(screen.getByText("Editar a"));
  fireEvent.change(screen.getByLabelText("Título sin guardar"), {
    target: { value: "  Nuevo  " },
  });
  fireEvent.change(screen.getByLabelText("Texto sin guardar"), {
    target: { value: " Texto nuevo " },
  });
  fireEvent.click(screen.getByText("Guardar a"));
  await screen.findByText("Nuevo");
  expect(mocks.updateDraft).toHaveBeenCalledWith("a", {
    title: "Nuevo",
    caption: "Texto nuevo",
  });
  expect(screen.getByTestId("draft-state-a").textContent).toContain(
    "campaign-1:Texto nuevo",
  );
});
it("does not save empty edits and retains edits after a save failure", async () => {
  await openDraftActions();
  fireEvent.click(screen.getByText("Guardar a"));
  expect(mocks.updateDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Editar a"));
  mocks.updateDraft.mockRejectedValue(new Error("offline"));
  fireEvent.click(screen.getByText("Guardar a"));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "No se pudo guardar",
  );
  expect(
    (screen.getByLabelText("Título sin guardar") as HTMLInputElement).value,
  ).toBe(editableDraft.title);
});
it("ignores a saved edit from the earlier A visit", async () => {
  const old = deferred<Draft>();
  mocks.updateDraft.mockReturnValue(old.promise);
  await openDraftActions();
  fireEvent.click(screen.getByText("Editar a"));
  fireEvent.click(screen.getByText("Guardar a"));
  select("b");
  select("a");
  await screen.findByText("Editar a");
  await act(async () =>
    old.resolve({ ...editableDraft, title: "Obsolete edit" }),
  );
  expect(screen.queryByText("Obsolete edit")).toBeNull();
});
it.each(["Eliminar", "Rechazar"])(
  "cancels %s without a request",
  async (action) => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await openDraftActions();
    fireEvent.click(screen.getByText(`${action} a`));
    expect(mocks.deleteDraft).not.toHaveBeenCalled();
    expect(mocks.rejectDraft).not.toHaveBeenCalled();
  },
);
it("soft-deletes once while pending and removes the draft from approvals", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const old = deferred<Draft>();
  mocks.deleteDraft.mockReturnValue(old.promise);
  await openDraftActions();
  fireEvent.click(screen.getByText("Eliminar a"));
  fireEvent.click(screen.getByText("Eliminar a"));
  expect(mocks.deleteDraft).toHaveBeenCalledTimes(1);
  await act(async () =>
    old.resolve({ ...editableDraft, deleted_at: "2026-01-01" }),
  );
  expect(screen.queryByText("Editar a")).toBeNull();
});
it("rejects a draft without deleting it", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mocks.rejectDraft.mockResolvedValue({ ...editableDraft, status: "rejected" });
  await openDraftActions();
  fireEvent.click(screen.getByText("Rechazar a"));
  await screen.findByText("rejected:campaign-1:Texto original");
  expect(mocks.deleteDraft).not.toHaveBeenCalled();
});
it("saves destinations before approving and blocks another approval while pending", async () => {
  const saved = deferred<Draft>();
  mocks.updateDraftDestinations.mockReturnValue(saved.promise);
  mocks.approveDraft.mockResolvedValue({
    ...editableDraft,
    status: "approved",
  });
  await openDraftActions();
  fireEvent.click(screen.getByText("Aprobar a"));
  fireEvent.click(screen.getByText("Aprobar a"));
  expect(mocks.updateDraftDestinations).toHaveBeenCalledTimes(1);
  expect(mocks.approveDraft).not.toHaveBeenCalled();
  await act(async () => saved.resolve(editableDraft));
  expect(mocks.updateDraftDestinations).toHaveBeenCalledWith("a", ["facebook"]);
  expect(mocks.approveDraft).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("draft-state-a").textContent).toContain("approved");
});
it("does not approve when saving destinations fails", async () => {
  mocks.updateDraftDestinations.mockRejectedValue(new Error("offline"));
  await openDraftActions();
  fireEvent.click(screen.getByText("Aprobar a"));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "No se pudo aprobar",
  );
  expect(mocks.approveDraft).not.toHaveBeenCalled();
});
it("confirms image charges, keeps the image lock and reloads authoritative drafts", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const image = deferred<{ image_url: string }>();
  mocks.generateDraftImage.mockReturnValue(image.promise);
  await openDraftActions();
  fireEvent.click(screen.getByText("Generar imagen a"));
  expect(mocks.generateDraftImage).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByText("Generar imagen a"));
  fireEvent.click(screen.getByText("Generar imagen a"));
  fireEvent.click(screen.getByText("Aprobar a"));
  expect(mocks.generateDraftImage).toHaveBeenCalledTimes(1);
  expect(mocks.approveDraft).not.toHaveBeenCalled();
  await act(async () => image.resolve({ image_url: "signed-image" }));
  expect(screen.getByText("signed-image")).toBeTruthy();
  expect(mocks.getDrafts).toHaveBeenCalledTimes(2);
  expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining("cargo"));
});
it("refreshes revision status after an ambiguous failure without retrying generation", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.createImageRevision.mockRejectedValue(new Error("ambiguous"));
  mocks.getImageRevisions.mockResolvedValue([]);
  await openDraftActions();
  fireEvent.change(screen.getByLabelText("Instrucciones a"), {
    target: { value: "  Más luz  " },
  });
  fireEvent.click(screen.getByText("Revisar imagen a"));
  await screen.findByText(/No se pudo confirmar la generación/);
  expect(mocks.createImageRevision).toHaveBeenCalledTimes(1);
  expect(mocks.createImageRevision).toHaveBeenCalledWith("a", "Más luz");
  expect(mocks.getImageRevisions).toHaveBeenCalledTimes(1);
});
it("accepts a ready revision then reloads drafts and preview without generating", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mocks.getImageRevisions.mockResolvedValue([
    { id: "revision-1", status: "ready", image_url: "revision-url" },
  ]);
  mocks.acceptImageRevision.mockResolvedValue({ status: "accepted" });
  mocks.getDraftImage.mockResolvedValue({ image_url: "accepted-image" });
  await openDraftActions();
  await act(async () =>
    fireEvent.click(screen.getByText("Historial imagen a")),
  );
  fireEvent.click(screen.getByText("Aceptar imagen a"));
  await screen.findByText("accepted-image");
  expect(mocks.acceptImageRevision).toHaveBeenCalledWith("a", "revision-1");
  expect(mocks.getDrafts).toHaveBeenCalledTimes(2);
  expect(mocks.generateDraftImage).not.toHaveBeenCalled();
});

it("preserves direct TikTok payload, pending lock and explicit verification", async () => {
  const pending = deferred<{ tiktok_publish_id: string }>();
  mocks.publishDraftToTikTok.mockReturnValue(pending.promise);
  mocks.verifyTikTokPublication.mockResolvedValue({ status: "published" });
  mocks.getDrafts.mockResolvedValue([
    {
      ...editableDraft,
      status: "approved",
      tiktok_publish_status: "not_published",
    },
  ]);
  await openApp();
  fireEvent.click(screen.getByRole("button", { name: /^Aprobaciones/ }));
  fireEvent.click(await screen.findByText("TikTok a"));
  fireEvent.click(screen.getByText("TikTok a"));
  expect(mocks.publishDraftToTikTok).toHaveBeenCalledTimes(1);
  expect(mocks.publishDraftToTikTok).toHaveBeenCalledWith("a", {
    account_id: "account-1",
    privacy_level: "SELF_ONLY",
    disable_comment: true,
    disable_duet: false,
    disable_stitch: true,
  });
  await act(async () =>
    pending.resolve({ tiktok_publish_id: "publication-1" }),
  );
  expect(screen.getByTestId("tiktok-status-a").textContent).toBe(
    "needs_review",
  );
  fireEvent.click(screen.getByText("Verificar TikTok a"));
  await screen.findByText("published");
  expect(mocks.verifyTikTokPublication).toHaveBeenCalledTimes(1);
});
it("retains Facebook video verification interval and cleans it up at logout", async () => {
  const setInterval = vi.spyOn(window, "setInterval");
  const clearInterval = vi.spyOn(window, "clearInterval");
  mocks.verifyFacebookVideo.mockResolvedValue({
    status: "processing",
    facebook_post_id: "post-1",
  });
  mocks.getDrafts.mockResolvedValue([
    {
      ...editableDraft,
      status: "approved",
      media_type: "video",
      facebook_publish_status: "needs_review",
      facebook_post_id: "post-1",
    },
  ]);
  await openApp();
  await act(async () => {});
  expect(mocks.verifyFacebookVideo).toHaveBeenCalledTimes(1);
  expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 30000);
  const index = setInterval.mock.calls.findIndex((call) => call[1] === 30000);
  const intervalId = setInterval.mock.results[index].value;
  await act(async () => {
    (setInterval.mock.calls[index][0] as () => void)();
  });
  expect(mocks.verifyFacebookVideo).toHaveBeenCalledTimes(2);
  act(() => authChange("SIGNED_OUT", null));
  expect(clearInterval).toHaveBeenCalledWith(intervalId);
});

it.each<{ destinations: ("facebook" | "tiktok")[] }>([
  { destinations: [] }, { destinations: ["tiktok"] },
])(
  "approves manual-use content without enabling direct publication ($destinations)",
  async ({ destinations }) => {
    const manual = { ...editableDraft, publish_destinations: destinations };
    mocks.getDrafts.mockResolvedValue([manual]);
    mocks.updateDraftDestinations.mockResolvedValue({ ...manual, publish_destinations: [] });
    mocks.approveDraft.mockResolvedValue({ ...manual, status: "approved", publish_destinations: [] });
    await openApp();
    fireEvent.click(screen.getByRole("button", { name: /^Aprobaciones/ }));
    fireEvent.click(await screen.findByText("Aprobar a"));
    await act(async () => {});
    expect(mocks.updateDraftDestinations).toHaveBeenCalledWith("a", []);
    expect(mocks.approveDraft).toHaveBeenCalledTimes(1);
    expect(mocks.publishDraftToFacebook).not.toHaveBeenCalled();
    expect(mocks.publishDraftToTikTok).not.toHaveBeenCalled();
  },
);

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
  unsubscribe: vi.fn(),
  onAuthStateChange: vi.fn(),
  getBusinesses: vi.fn(),
  getDrafts: vi.fn(),
  getConnectedFacebookAccounts: vi.fn(),
  generateContent: vi.fn(),
  publishDraftToFacebook: vi.fn(),
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
  fireEvent.keyDown(screen.getByLabelText("Abrir menú de Ángela"), {
    key: "Enter",
  });
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Cerrar sesión" }),
  );
  expect(await screen.findByText("Iniciar sesión")).toBeTruthy();
  expect(mocks.signOut).toHaveBeenCalledTimes(1);
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
  expect(await screen.findByRole("heading", { name: "Resumen" })).toBeTruthy();
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

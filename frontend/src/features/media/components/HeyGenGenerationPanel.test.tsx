import { useDraftActions } from "../../drafts/hooks/useDraftActions";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDraftCollection } from "../../drafts/hooks/useDraftCollection";
import { useDraftOperations } from "../../drafts/hooks/useDraftOperations";
import { useHeyGenGeneration } from "../hooks/useHeyGenGeneration";
import { HeyGenGenerationPanel } from "./HeyGenGenerationPanel";
import {
  getDrafts,
  updateDraft,
  rejectDraft,
  deleteDraft,
  type Draft,
} from "../../../services/draftsApi";
import * as api from "../services/heygenGenerationApi";
import * as assets from "../services/heygenAssetsApi";
import { fetchVideoPreview } from "../services/videoApi";

vi.mock("../../../services/draftsApi", () => ({
  getDrafts: vi.fn(),
  updateDraft: vi.fn(),
  rejectDraft: vi.fn(),
  deleteDraft: vi.fn(),
}));
vi.mock("../services/heygenGenerationApi", () => ({
  getGeneration: vi.fn(),
  reconcileGeneration: vi.fn(),
  submitGeneration: vi.fn(),
}));
vi.mock("../services/heygenAssetsApi", () => ({
  getHeyGenAvatarAssets: vi.fn(),
  getHeyGenVoiceAssets: vi.fn(),
}));
vi.mock("../services/videoApi", () => ({ fetchVideoPreview: vi.fn() }));
const draft: Draft = {
  id: "draft-1",
  business_id: "A",
  campaign_id: null,
  title: "Oferta",
  caption: "Descripción diferente",
  video_script: "Guion original",
  platform: "facebook",
  status: "pending",
  source: "ai",
  created_at: "2026-01-01",
  deleted_at: null,
  published_at: null,
  publish_destinations: ["facebook"],
  facebook_post_id: null,
  facebook_publish_status: "not_published",
  tiktok_publish_id: null,
  tiktok_publish_status: "not_published",
  image_prompt: null,
  image_url: null,
  image_status: "not_started",
  media_type: "text",
  video_status: "not_started",
  video_url: null,
};
const job: api.Generation = {
  attempt_id: "attempt-1",
  business_id: "A",
  draft_id: draft.id,
  status: "PROCESSING",
  storage_status: "PENDING",
};
function Workspace({
  business = "A",
  show = true,
  item = draft,
}: {
  business?: string;
  show?: boolean;
  item?: Draft;
}) {
  const collection = useDraftCollection(business, "user");
  const operations = useDraftOperations(business);
  const actions = useDraftActions(business, collection, operations, vi.fn());
  const controller = useHeyGenGeneration(business, collection, operations);
  return (
    <>
      <button onClick={() => actions.startEditing(item)}>Editar prueba</button>
      <button onClick={() => void actions.handleSaveEdit(item.id)}>
        Guardar prueba
      </button>
      <button onClick={() => void actions.handleReject(item.id)}>
        Rechazar prueba
      </button>
      <button onClick={() => void actions.handleDelete(item.id)}>
        Eliminar prueba
      </button>
      <span data-testid="locks">{operations.busyDraftIds.join(",")}</span>
      {show && (
        <HeyGenGenerationPanel
          key={business}
          draft={{ ...item, business_id: business }}
          controller={controller}
        />
      )}
    </>
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.mocked(getDrafts).mockResolvedValue([draft]);
  vi.mocked(api.getGeneration).mockResolvedValue(null);
  vi.mocked(api.reconcileGeneration).mockResolvedValue(job);
  vi.mocked(api.submitGeneration).mockResolvedValue(job);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(assets.getHeyGenAvatarAssets).mockResolvedValue({
    data: [
      {
        id: "look",
        name: "Ana",
        avatar_type: "photo_avatar",
        default_voice_id: "voice",
        supported_api_engines: ["avatar_iv"],
        status: "completed",
        group_id: null,
        gender: null,
        tags: [],
        preview_image_url: null,
        preview_video_url: null,
      },
    ],
    next_token: null,
    has_more: false,
  });
  vi.mocked(assets.getHeyGenVoiceAssets).mockResolvedValue({
    data: [
      {
        voice_id: "voice",
        name: "Voz española",
        language: "es",
        status: "ACTIVE",
        mode: null,
        preview_audio_url: null,
      },
    ],
    next_token: null,
    has_more: false,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.useRealTimers();
});
async function selectAssets() {
  await waitFor(() =>
    expect(screen.getByLabelText("Video script")).not.toHaveProperty(
      "disabled",
      true,
    ),
  );
  // Wait for the restore request to finish (fieldset controls inherit disabled).
  await screen.findByText("Review the script and select an avatar and voice.");
  fireEvent.click(screen.getByRole("button", { name: /Explore HeyGen avatars/ }));
  await screen.findByRole("option", { name: /Ana/ });
  await screen.findByRole("option", { name: /Voz española/ });
  fireEvent.change(screen.getByLabelText("Avatar"), {
    target: { value: "look" },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Generate video with HeyGen" }),
    ).toHaveProperty("disabled", false),
  );
}
it("shows a clean no-attempt state without reconciliation and allows asset selection", async () => {
  const avatarPage =
    deferred<Awaited<ReturnType<typeof assets.getHeyGenAvatarAssets>>>();
  const voicePage =
    deferred<Awaited<ReturnType<typeof assets.getHeyGenVoiceAssets>>>();
  vi.mocked(assets.getHeyGenAvatarAssets).mockReturnValue(avatarPage.promise);
  vi.mocked(assets.getHeyGenVoiceAssets).mockReturnValue(voicePage.promise);

  render(<Workspace />);
  await screen.findByText("Review the script and select an avatar and voice.");
  expect(api.getGeneration).toHaveBeenCalledTimes(1);
  expect(api.reconcileGeneration).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "Recover video status" }),
  ).toBeNull();

  const script = screen.getByLabelText("Video script");
  expect(script).toHaveProperty("rows", 8);
  expect(script.getAttribute("aria-describedby")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Explore HeyGen avatars and voices",
    }),
  );
  expect(screen.getByText("Loading avatars…")).toBeTruthy();
  expect(screen.getByText("Loading voices…")).toBeTruthy();
  expect(screen.getByLabelText("Avatar")).toHaveProperty("disabled", true);
  expect(screen.getByLabelText("Voice")).toHaveProperty("disabled", true);

  await act(async () => {
    avatarPage.resolve({
      data: [{
        id: "look",
        name: "Ana",
        avatar_type: "photo_avatar",
        default_voice_id: "voice",
        supported_api_engines: ["avatar_iv"],
        status: "completed",
        group_id: null,
        gender: null,
        tags: [],
        preview_image_url: null,
        preview_video_url: null,
      }],
      next_token: null,
      has_more: false,
    });
    voicePage.resolve({
      data: [{
        voice_id: "voice",
        name: "Voz española",
        language: "es",
        status: "ACTIVE",
        mode: null,
        preview_audio_url: null,
      }],
      next_token: null,
      has_more: false,
    });
  });

  fireEvent.change(screen.getByLabelText("Avatar"), {
    target: { value: "look" },
  });
  expect(screen.getByLabelText("Avatar")).toHaveProperty("value", "look");
  expect(screen.getByLabelText("Voice")).toHaveProperty("value", "voice");
  expect(screen.getByLabelText("Video script")).toHaveProperty(
    "value",
    "Guion original",
  );
  expect(
    screen.getByRole("button", { name: "Generate video with HeyGen" }),
  ).toHaveProperty("disabled", false);
  vi.useFakeTimers();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(api.getGeneration).toHaveBeenCalledTimes(1);
  expect(api.reconcileGeneration).not.toHaveBeenCalled();
});
it("requires paid confirmation, sends edited script and selected assets once, and keeps a workspace lock", async () => {
  const pending = deferred<api.Generation>();
  vi.mocked(api.submitGeneration).mockReturnValue(pending.promise);
  const view = render(<Workspace />);
  await selectAssets();
  expect(screen.getByLabelText("Video script")).toHaveProperty(
    "value",
    "Guion original",
  );
  fireEvent.change(screen.getByLabelText("Video script"), {
    target: { value: "Guion editado" },
  });
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  fireEvent.click(
    screen.getByRole("button", { name: "Generate video with HeyGen" }),
  );
  expect(api.submitGeneration).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Generate video with HeyGen" }),
  );
  expect(api.submitGeneration).toHaveBeenCalledTimes(1);
  expect(api.submitGeneration).toHaveBeenCalledWith("A", "draft-1", {
    avatar_id: "look",
    voice_id: "voice",
    script: "Guion editado",
    confirmed_paid_generation: true,
  });
  expect(window.confirm).toHaveBeenCalledWith(
    expect.stringContaining("uses API credits"),
  );
  expect(screen.getByTestId("locks").textContent).toBe(draft.id);
  view.rerender(<Workspace show={false} />);
  view.rerender(<Workspace />);
  expect(api.submitGeneration).toHaveBeenCalledTimes(1);
  expect(updateDraft).not.toHaveBeenCalled();
  await act(async () => pending.resolve(job));
  await screen.findByText(/HeyGen is processing your video/);
  expect(screen.getByTestId("locks").textContent).toBe(draft.id);
});
it("restores stored completion on refresh and uses an authorized renewable private preview", async () => {
  const stored = {
    ...job,
    status: "COMPLETED" as const,
    storage_status: "STORED" as const,
  };
  vi.mocked(api.getGeneration).mockResolvedValue(stored);
  vi.mocked(fetchVideoPreview)
    .mockResolvedValueOnce({ video_url: "https://private.test/signed-one" })
    .mockResolvedValueOnce({ video_url: "https://private.test/signed-two" });
  const view = render(<Workspace />);
  await screen.findByText(/Video saved privately/);
  fireEvent.click(
    screen.getByRole("button", { name: /Refresh private preview/ }),
  );
  await waitFor(() =>
    expect(view.container.querySelector("video")?.src).toBe(
      "https://private.test/signed-one",
    ),
  );
  expect(fetchVideoPreview).toHaveBeenCalledWith(draft.id);
  fireEvent.error(view.container.querySelector("video")!);
  await screen.findByText(/The preview expired/);
  fireEvent.click(
    screen.getByRole("button", { name: /Refresh private preview/ }),
  );
  await waitFor(() =>
    expect(view.container.querySelector("video")?.src).toBe(
      "https://private.test/signed-two",
    ),
  );
  view.unmount();
  render(<Workspace />);
  await screen.findByText(/Video saved privately/);
  expect(api.submitGeneration).not.toHaveBeenCalled();
});
it("keeps an ambiguous network submission blocked even if recovery initially finds no attempt", async () => {
  vi.mocked(api.submitGeneration).mockRejectedValue(
    new Error("Conexión interrumpida"),
  );
  vi.mocked(api.reconcileGeneration).mockResolvedValue(null);
  render(<Workspace />);
  await selectAssets();
  fireEvent.click(
    screen.getByRole("button", { name: "Generate video with HeyGen" }),
  );
  await screen.findByText("Conexión interrumpida");
  fireEvent.click(screen.getByRole("button", { name: /Recover video status/ }));
  await waitFor(() =>
    expect(api.reconcileGeneration).toHaveBeenCalledWith("A", draft.id),
  );
  expect(
    screen.queryByRole("button", { name: "Generate video with HeyGen" }),
  ).toBeNull();
  expect(screen.getByTestId("locks").textContent).toBe(draft.id);
  expect(api.submitGeneration).toHaveBeenCalledTimes(1);
});
it.each(["UNKNOWN", "FAILED"] as const)(
  "shows %s without automatically generating",
  async (status) => {
    vi.mocked(api.getGeneration).mockResolvedValue({ ...job, status });
    render(<Workspace />);
    await screen.findByText(
      status === "UNKNOWN"
        ? /We don't know whether HeyGen/
        : /HeyGen could not generate/,
    );
    expect(api.submitGeneration).not.toHaveBeenCalled();
  },
);
it("stops on restore failure and permits recovery without a paid retry", async () => {
  vi.mocked(api.getGeneration).mockRejectedValue(
    new Error("Servidor no disponible"),
  );
  render(<Workspace />);
  await screen.findByText("Servidor no disponible");
  expect(
    screen.getByRole("button", { name: "Generate video with HeyGen" }),
  ).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: /Recover video status/ }));
  await screen.findByText(/HeyGen is processing your video/);
  expect(api.submitGeneration).not.toHaveBeenCalled();
});
it("ignores a stale A response after A → B → A and after logout", async () => {
  const old = deferred<api.Generation>();
  vi.mocked(api.getGeneration)
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue(null);
  const view = render(<Workspace />);
  view.rerender(<Workspace business="B" />);
  await screen.findByText(/Review the script/);
  view.rerender(<Workspace />);
  await act(async () =>
    old.resolve({ ...job, status: "COMPLETED", storage_status: "STORED" }),
  );
  expect(screen.queryByText(/Video saved/)).toBeNull();
  view.unmount();
  expect(api.submitGeneration).not.toHaveBeenCalled();
});
it.each([
  { status: "approved" },
  { deleted_at: "2026-01-01" },
  { video_url: "private/path" },
  { image_status: "generating" },
])("blocks ineligible draft %j", async (changes) => {
  render(<Workspace item={{ ...draft, ...changes } as Draft} />);
  await screen.findByText(/Review the script/);
  expect(
    screen.getByRole("button", { name: "Generate video with HeyGen" }),
  ).toHaveProperty("disabled", true);
  expect(api.submitGeneration).not.toHaveBeenCalled();
});
it("polls processing state without another generation request and stops at completion", async () => {
  vi.useFakeTimers();
  vi.mocked(api.getGeneration)
    .mockResolvedValueOnce(job)
    .mockResolvedValue({
      ...job,
      status: "COMPLETED",
      storage_status: "STORED",
    });
  await act(async () => {
    render(<Workspace />);
  });
  expect(screen.getByText(/HeyGen is processing your video/)).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(screen.getByText(/Video saved/)).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(api.getGeneration).toHaveBeenCalledTimes(2);
  expect(api.submitGeneration).not.toHaveBeenCalled();
});
it("does not enable generation with unavailable assets or missing configuration", async () => {
  vi.mocked(assets.getHeyGenAvatarAssets).mockRejectedValue(
    new Error("HeyGen no está configurado. Contacta al administrador."),
  );
  render(<Workspace />);
  await screen.findByText(/Review the script/);
  fireEvent.click(screen.getByRole("button", { name: /Explore HeyGen avatars/ }));
  await screen.findByText(/HeyGen no está configurado/);
  expect(
    screen.getByRole("button", { name: "Generate video with HeyGen" }),
  ).toHaveProperty("disabled", true);
  expect(api.submitGeneration).not.toHaveBeenCalled();
});
it("does not apply pending completion or open previews after logout", async () => {
  const pending = deferred<api.Generation>();
  vi.mocked(api.getGeneration).mockReturnValue(pending.promise);
  const view = render(<Workspace />);
  view.unmount();
  await act(async () =>
    pending.resolve({ ...job, status: "COMPLETED", storage_status: "STORED" }),
  );
  expect(fetchVideoPreview).not.toHaveBeenCalled();
  expect(api.submitGeneration).not.toHaveBeenCalled();
  expect(getDrafts).toHaveBeenCalledTimes(1); // Initial collection only.
});
it("keeps edits locked until the completed draft refresh finishes", async () => {
  const fresh = deferred<Draft[]>();
  vi.mocked(getDrafts)
    .mockResolvedValueOnce([draft])
    .mockReturnValueOnce(fresh.promise);
  vi.mocked(api.getGeneration).mockResolvedValue({
    ...job,
    status: "COMPLETED",
    storage_status: "STORED",
  });
  render(<Workspace />);
  await screen.findByText(/Video saved/);
  expect(screen.getByTestId("locks").textContent).toBe(draft.id);
  await act(async () =>
    fresh.resolve([
      {
        ...draft,
        media_type: "video",
        video_status: "completed",
        video_url: "private/path",
      },
    ]),
  );
  expect(screen.getByTestId("locks").textContent).toBe("");
});
it("blocks generation after recovery fails for an existing attempt", async () => {
  vi.mocked(api.getGeneration).mockResolvedValue({ ...job, status: "FAILED" });
  render(<Workspace />);
  await screen.findByText(/HeyGen could not generate/);
  vi.mocked(api.reconcileGeneration).mockRejectedValue(
    new Error("Sin conexión"),
  );
  fireEvent.click(screen.getByRole("button", { name: /Recover video status/ }));
  await screen.findByText("Sin conexión");
  expect(
    screen.getByRole("button", { name: "Generate video with HeyGen" }),
  ).toHaveProperty("disabled", true);
  expect(api.submitGeneration).not.toHaveBeenCalled();
});

it.each([
  ["Guardar prueba", updateDraft],
  ["Rechazar prueba", rejectDraft],
  ["Eliminar prueba", deleteDraft],
] as const)(
  "recovery cannot acquire or clear a pending %s lock",
  async (label, mutation) => {
    const pending = deferred<Draft>();
    vi.mocked(mutation).mockReturnValue(pending.promise);
    vi.mocked(api.getGeneration).mockResolvedValue({ ...job, status: "FAILED" });
    render(<Workspace />);
    await screen.findByText(/HeyGen could not generate/);
    fireEvent.click(screen.getByRole("button", { name: "Editar prueba" }));
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("locks").textContent).toBe(draft.id);
    fireEvent.click(screen.getByRole("button", { name: /Recover video status/ }));
    await screen.findByText(/Wait for the other draft operation/);
    expect(api.reconcileGeneration).not.toHaveBeenCalled();
    expect(screen.getByTestId("locks").textContent).toBe(draft.id);
    await act(async () => pending.resolve(draft));
    expect(screen.getByTestId("locks").textContent).toBe("");
    vi.mocked(api.reconcileGeneration).mockResolvedValue({
      ...job,
      status: "FAILED",
    });
    fireEvent.click(screen.getByRole("button", { name: /Recover video status/ }));
    await screen.findByText(/HeyGen could not generate/);
    await waitFor(() =>
      expect(screen.getByTestId("locks").textContent).toBe(""),
    );
  },
);

it.each([
  ["Guardar prueba", updateDraft],
  ["Rechazar prueba", rejectDraft],
  ["Eliminar prueba", deleteDraft],
] as const)(
  "blocks %s while recovery owns the lock",
  async (label, mutation) => {
    const pending = deferred<api.Generation>();
    vi.mocked(api.reconcileGeneration).mockReturnValue(pending.promise);
    vi.mocked(api.getGeneration).mockResolvedValue({ ...job, status: "FAILED" });
    render(<Workspace />);
    await screen.findByText(/HeyGen could not generate/);
    fireEvent.click(screen.getByRole("button", { name: "Editar prueba" }));
    fireEvent.click(screen.getByRole("button", { name: /Recover video status/ }));
    expect(screen.getByTestId("locks").textContent).toBe(draft.id);
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(mutation).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ ...job, status: "FAILED" }));
    expect(screen.getByTestId("locks").textContent).toBe("");
  },
);

it("only releases the matching HeyGen owner and keeps other operation flags separate", () => {
  const { result } = renderHook(() => useDraftOperations("A"));
  const owner = Symbol("owner");
  const other = Symbol("other");
  act(() => {
    result.current.setBusyDraftIds([draft.id]);
    expect(result.current.acquireHeyGenLock(draft.id, owner)).toBe(false);
  });
  expect(result.current.busyDraftIds).toEqual([draft.id]);
  act(() => {
    result.current.setBusyDraftIds([]);
    expect(result.current.acquireHeyGenLock(draft.id, owner)).toBe(true);
    result.current.releaseHeyGenLock(draft.id, other);
    result.current.setBusyDraftIds([]);
  });
  expect(result.current.busyDraftIds).toEqual([draft.id]);
  act(() => result.current.releaseHeyGenLock(draft.id, owner));
  expect(result.current.busyDraftIds).toEqual([]);
});

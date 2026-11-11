import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VideoUpload } from "./VideoUpload";
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("../services/supabaseClient", () => ({ supabase: { auth } }));
beforeEach(() => {
  auth.getSession.mockResolvedValue({
    data: { session: { access_token: "token" } },
  });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("rejects non-MP4 files before sending a request", () => {
  const view = render(<VideoUpload draftId="a" onUploaded={vi.fn()} />);
  fireEvent.change(view.container.querySelector('input[type="file"]')!, {
    target: { files: [new File(["x"], "photo.jpg", { type: "image/jpeg" })] },
  });
  expect(screen.getByRole("alert").textContent).toBe(
    "Solo se permiten archivos de video MP4.",
  );
  expect(fetch).not.toHaveBeenCalled();
});
it("uploads once with the current token and FormData, then clears selection", async () => {
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const uploaded = vi.fn();
  const view = render(<VideoUpload draftId="draft/1" onUploaded={uploaded} />);
  const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
  fireEvent.change(view.container.querySelector('input[type="file"]')!, {
    target: { files: [file] },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Subir video" })),
  );
  fireEvent.click(screen.getByRole("button", { name: "Subiendo video..." }));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(uploaded).not.toHaveBeenCalled();
  const [url, request] = vi.mocked(fetch).mock.calls[0];
  expect(url).toContain("/drafts/draft%2F1/upload-video");
  expect(request?.headers).toEqual({ Authorization: "Bearer token" });
  expect(request?.method).toBe("POST");
  expect((request?.body as FormData).get("file")).toBe(file);
  await act(async () => finish({ ok: true } as Response));
  expect(uploaded).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("clip.mp4")).toBeNull();
});
it("retains the file on upload failure and does not retry automatically", async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);
  const uploaded = vi.fn();
  const view = render(<VideoUpload draftId="a" onUploaded={uploaded} />);
  fireEvent.change(view.container.querySelector('input[type="file"]')!, {
    target: { files: [new File(["video"], "clip.mp4")] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Subir video" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "No se pudo subir el video (500).",
  );
  expect(screen.getByText("clip.mp4")).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(uploaded).not.toHaveBeenCalled();
});

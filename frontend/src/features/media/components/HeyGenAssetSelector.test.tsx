import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  getHeyGenAvatarAssets,
  getHeyGenVoiceAssets,
} from "../services/heygenAssetsApi";
import { HeyGenAssetSelector } from "./HeyGenAssetSelector";

vi.mock("../services/heygenAssetsApi", () => ({
  getHeyGenAvatarAssets: vi.fn(),
  getHeyGenVoiceAssets: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("loads and displays avatar metadata and selectable voices", async () => {
  vi.mocked(getHeyGenAvatarAssets).mockResolvedValue({
    data: [{
      id: "look-1",
      name: "Avatar de prueba",
      avatar_type: "photo_avatar",
      default_voice_id: "voice-1",
      supported_api_engines: ["avatar_iv", "avatar_v"],
      preview_image_url: null,
      preview_video_url: null,
      group_id: null,
      gender: null,
      tags: [],
      status: "completed",
    }],
    has_more: false,
    next_token: null,
  });
  vi.mocked(getHeyGenVoiceAssets).mockResolvedValue({
    data: [{
      voice_id: "voice-1",
      name: "Voz de prueba",
      language: "es",
      status: "ACTIVE",
      mode: "instant",
      preview_audio_url: null,
    }],
    has_more: false,
    next_token: null,
  });

  render(<HeyGenAssetSelector />);
  fireEvent.click(screen.getByRole("button", { name: /Explore HeyGen avatars/ }));

  await screen.findByRole("option", { name: /Avatar de prueba/ });
  await screen.findByRole("option", { name: /Voz de prueba/ });
  fireEvent.change(screen.getByLabelText("Avatar"), {
    target: { value: "look-1" },
  });

  expect(
    await screen.findByText(/Supported engines: avatar_iv, avatar_v/),
  ).toBeTruthy();
  expect(screen.getByLabelText("Voice")).toHaveProperty("value", "voice-1");
  expect(
    screen.getByText(/Selected voice: Voz de prueba · es · ID: voice-1/),
  ).toBeTruthy();
  expect(getHeyGenAvatarAssets).toHaveBeenCalledWith({
    avatarType: undefined,
    ownership: "private",
  });
  expect(getHeyGenVoiceAssets).toHaveBeenCalledWith({ type: "private" });
});

it("filters photo avatars and paginates avatar and voice results", async () => {
  vi.mocked(getHeyGenAvatarAssets)
    .mockResolvedValueOnce({
      data: [{
        id: "look-1",
        name: "Avatar de foto",
        avatar_type: "photo_avatar",
        default_voice_id: null,
        supported_api_engines: ["avatar_iv"],
        preview_image_url: null,
        preview_video_url: null,
        group_id: null,
        gender: null,
        tags: [],
        status: "completed",
      }],
      has_more: true,
      next_token: "avatar-next",
    })
    .mockResolvedValueOnce({
      data: [{
        id: "look-1",
        name: "Avatar de foto",
        avatar_type: "photo_avatar",
        default_voice_id: null,
        supported_api_engines: ["avatar_iv"],
        preview_image_url: null,
        preview_video_url: null,
        group_id: null,
        gender: null,
        tags: [],
        status: "completed",
      }],
      has_more: true,
      next_token: "avatar-next",
    })
    .mockResolvedValueOnce({
      data: [{
        id: "look-2",
        name: "Avatar siguiente",
        avatar_type: "photo_avatar",
        default_voice_id: null,
        supported_api_engines: ["avatar_iv"],
        preview_image_url: null,
        preview_video_url: null,
        group_id: null,
        gender: null,
        tags: [],
        status: "completed",
      }],
      has_more: false,
      next_token: null,
    });
  vi.mocked(getHeyGenVoiceAssets)
    .mockResolvedValueOnce({
      data: [{
        voice_id: "voice-1",
        name: "Voz privada",
        language: "es",
        status: "ACTIVE",
        mode: "instant",
        preview_audio_url: null,
      }],
      has_more: true,
      next_token: "voice-next",
    })
    .mockResolvedValueOnce({
      data: [{
        voice_id: "voice-2",
        name: "Voz siguiente",
        language: "en",
        status: "ACTIVE",
        mode: "professional",
        preview_audio_url: null,
      }],
      has_more: false,
      next_token: null,
    });

  render(<HeyGenAssetSelector />);
  fireEvent.click(screen.getByRole("button", { name: /Explore HeyGen avatars/ }));
  await screen.findByRole("option", { name: /Voz privada/ });

  fireEvent.change(screen.getByLabelText("Avatar type"), {
    target: { value: "photo_avatar" },
  });
  await waitFor(() =>
    expect(getHeyGenAvatarAssets).toHaveBeenCalledWith({
      avatarType: "photo_avatar",
      ownership: "private",
    }),
  );
  await screen.findByRole("button", { name: "Load more avatars" });
  fireEvent.click(screen.getByRole("button", { name: "Load more avatars" }));
  await screen.findByRole("option", { name: /Avatar siguiente/ });

  fireEvent.click(screen.getByRole("button", { name: "Load more voices" }));
  await screen.findByRole("option", { name: /Voz siguiente/ });
  expect(getHeyGenAvatarAssets).toHaveBeenCalledWith({
    avatarType: "photo_avatar",
    ownership: "private",
    token: "avatar-next",
  });
  expect(getHeyGenVoiceAssets).toHaveBeenCalledWith({
    type: "private",
    token: "voice-next",
  });
});

it("switches between private and public voice lists and reports failures", async () => {
  vi.mocked(getHeyGenAvatarAssets).mockResolvedValue({
    data: [],
    has_more: false,
    next_token: null,
  });
  vi.mocked(getHeyGenVoiceAssets)
    .mockRejectedValueOnce(new Error("No se pudieron cargar los recursos de HeyGen (502)."))
    .mockResolvedValueOnce({
      data: [{
        voice_id: "voice-public",
        name: "Voz pública",
        language: "es",
        status: "ACTIVE",
        mode: "instant",
        preview_audio_url: null,
      }],
      has_more: false,
      next_token: null,
    });

  render(<HeyGenAssetSelector />);
  fireEvent.click(screen.getByRole("button", { name: /Explore HeyGen avatars/ }));
  expect(await screen.findByRole("alert")).toBeTruthy();

  fireEvent.change(screen.getByLabelText("Voices"), {
    target: { value: "public" },
  });
  await screen.findByRole("option", { name: /Voz pública/ });

  expect(getHeyGenVoiceAssets).toHaveBeenLastCalledWith({ type: "public" });
});

it("offers retry after an avatar catalog failure", async () => {
  vi.mocked(getHeyGenAvatarAssets)
    .mockRejectedValueOnce(
      new Error("No se pudieron cargar los recursos de HeyGen (502)."),
    )
    .mockResolvedValueOnce({
      data: [{
        id: "look-retry",
        name: "Avatar recuperado",
        avatar_type: "digital_twin",
        default_voice_id: null,
        supported_api_engines: ["avatar_iv"],
        preview_image_url: null,
        preview_video_url: null,
        group_id: null,
        gender: null,
        tags: [],
        status: "completed",
      }],
      has_more: false,
      next_token: null,
    });
  vi.mocked(getHeyGenVoiceAssets).mockResolvedValue({
    data: [],
    has_more: false,
    next_token: null,
  });

  render(<HeyGenAssetSelector />);
  fireEvent.click(screen.getByRole("button", { name: /Explore HeyGen avatars/ }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry loading avatars" }),
  );
  await screen.findByRole("option", { name: /Avatar recuperado/ });
  expect(getHeyGenAvatarAssets).toHaveBeenCalledTimes(2);
});

it("offers retry after a voice catalog failure", async () => {
  vi.mocked(getHeyGenAvatarAssets).mockResolvedValue({
    data: [],
    has_more: false,
    next_token: null,
  });
  vi.mocked(getHeyGenVoiceAssets)
    .mockRejectedValueOnce(new Error("No se pudieron cargar las voces."))
    .mockResolvedValueOnce({
      data: [{
        voice_id: "voice-retry",
        name: "Voz recuperada",
        language: "es",
        status: "ACTIVE",
        mode: null,
        preview_audio_url: null,
      }],
      has_more: false,
      next_token: null,
    });

  render(<HeyGenAssetSelector />);
  fireEvent.click(screen.getByRole("button", { name: /Explore HeyGen avatars/ }));
  expect(await screen.findByText("No se pudieron cargar las voces.")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry loading voices" }),
  );
  await screen.findByRole("option", { name: /Voz recuperada/ });
  expect(getHeyGenVoiceAssets).toHaveBeenCalledTimes(2);
});

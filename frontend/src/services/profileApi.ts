import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

const DISPLAY_NAME_MAX_LENGTH = 80;

export async function updateOwnDisplayName(
  displayName: string,
): Promise<{ displayName: string; user: User }> {
  const normalized = displayName.trim();
  if (!normalized) {
    throw new Error("Escribe un nombre para mostrar.");
  }
  if (normalized.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new Error("El nombre no puede superar los 80 caracteres.");
  }

  const { data, error } = await supabase.auth.updateUser({
    data: { display_name: normalized },
  });

  if (error) {
    throw new Error("No se pudo guardar el nombre. Inténtalo de nuevo.");
  }
  if (!data.user) {
    throw new Error("No se pudo confirmar el nombre actualizado.");
  }

  return { displayName: normalized, user: data.user };
}

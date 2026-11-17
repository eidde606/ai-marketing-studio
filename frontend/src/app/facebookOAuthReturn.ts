export type FacebookHandoffContext = {
  token: string;
  businessId: string;
};

export type FacebookOAuthReturn = {
  handoff: FacebookHandoffContext | null;
  result: string | null;
};

const HANDOFF_STORAGE_KEY = "ai-marketing-studio:facebook-handoff";
const RESULT_STORAGE_KEY = "ai-marketing-studio:facebook-result";

export function restoreFacebookOAuthReturn(): FacebookOAuthReturn {
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.hash.slice(1));
  const hasFacebookReturn =
    params.has("facebook_handoff") ||
    params.has("business_id") ||
    params.has("facebook_result");
  let handoff: FacebookHandoffContext | null = null;
  let result: string | null = null;

  if (hasFacebookReturn) {
    const token = params.get("facebook_handoff");
    const businessId = params.get("business_id");
    if (token && businessId) {
      handoff = { token, businessId };
      writeStorage(HANDOFF_STORAGE_KEY, JSON.stringify(handoff));
      removeStorage(RESULT_STORAGE_KEY);
    } else {
      removeStorage(HANDOFF_STORAGE_KEY);
      result = params.get("facebook_result");
      if (result) writeStorage(RESULT_STORAGE_KEY, result);
    }

    params.delete("facebook_handoff");
    params.delete("business_id");
    params.delete("facebook_result");
    url.hash = params.size > 0 ? params.toString() : "";
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }

  if (!handoff) handoff = readHandoff();
  if (!result) result = readStorage(RESULT_STORAGE_KEY);
  return { handoff, result };
}

export function clearFacebookOAuthReturn(): void {
  removeStorage(HANDOFF_STORAGE_KEY);
  removeStorage(RESULT_STORAGE_KEY);
}

function readHandoff(): FacebookHandoffContext | null {
  const saved = readStorage(HANDOFF_STORAGE_KEY);
  if (!saved) return null;
  try {
    const value: unknown = JSON.parse(saved);
    if (
      typeof value === "object" &&
      value !== null &&
      "token" in value &&
      "businessId" in value &&
      typeof value.token === "string" &&
      value.token.length > 0 &&
      typeof value.businessId === "string" &&
      value.businessId.length > 0
    ) {
      return { token: value.token, businessId: value.businessId };
    }
  } catch {
    removeStorage(HANDOFF_STORAGE_KEY);
  }
  return null;
}

function readStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Keep the handoff in memory when browser storage is unavailable.
  }
}

function removeStorage(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Browser storage may be unavailable.
  }
}

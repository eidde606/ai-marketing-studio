import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearFacebookOAuthReturn,
  restoreFacebookOAuthReturn,
} from "./facebookOAuthReturn";

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  clearFacebookOAuthReturn();
  window.history.replaceState(null, "", "/");
});

describe("restoreFacebookOAuthReturn", () => {
  it("captures the handoff before authentication and removes it from the URL", () => {
    const token = "one-time-handoff-secret";
    window.history.replaceState(
      null,
      "",
      `/#facebook_handoff=${token}&business_id=business-1`,
    );

    expect(restoreFacebookOAuthReturn()).toEqual({
      handoff: { token, businessId: "business-1" },
      result: null,
    });
    expect(window.location.href).not.toContain(token);
    expect(window.location.hash).toBe("");
  });

  it("restores the handoff from tab storage after a reload", () => {
    const token = "one-time-handoff-secret";
    window.history.replaceState(
      null,
      "",
      `/#facebook_handoff=${token}&business_id=business-1`,
    );
    restoreFacebookOAuthReturn();

    expect(restoreFacebookOAuthReturn()).toEqual({
      handoff: { token, businessId: "business-1" },
      result: null,
    });
  });

  it("captures callback failures without retaining their URL fragment", () => {
    window.history.replaceState(
      null,
      "",
      "/#facebook_result=authorization_declined",
    );

    expect(restoreFacebookOAuthReturn()).toEqual({
      handoff: null,
      result: "authorization_declined",
    });
    expect(window.location.hash).toBe("");
  });
});

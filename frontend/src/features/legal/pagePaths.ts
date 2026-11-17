export type LegalPage =
  | "privacy"
  | "terms"
  | "subscriptions"
  | "data-deletion"
  | "contact";

export const pagePaths: Record<LegalPage, string> = {
  privacy: "/privacy",
  terms: "/terms",
  subscriptions: "/subscriptions",
  "data-deletion": "/data-deletion",
  contact: "/contact",
};

const pagesByPath = new Map(
  Object.entries(pagePaths).map(([page, path]) => [path, page as LegalPage]),
);

export function resolvePublicLegalPage(pathname: string): LegalPage | null {
  return pagesByPath.get(pathname.replace(/\/+$/, "") || "/") ?? null;
}

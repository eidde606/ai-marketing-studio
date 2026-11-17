import { publicApiRequest } from "../../../lib/apiClient";

export type ContactCategory =
  | "general"
  | "technical"
  | "billing"
  | "privacy"
  | "problem";

export type ContactRequest = {
  name: string;
  email: string;
  category: ContactCategory;
  message: string;
  website: string;
};

export function submitContactRequest(
  request: ContactRequest,
): Promise<{ status: "submitted" }> {
  return publicApiRequest<{ status: "submitted" }>(
    "/public/contact",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
    "Contact request could not be sent.",
  );
}

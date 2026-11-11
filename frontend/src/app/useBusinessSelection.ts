import { useEffect, useState } from "react";
import { getBusinesses, type Business } from "../services/businessesApi";

/** Owned by the user-keyed workspace, so accounts never share selection state. */
export function useBusinessSelection(userId: string) {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState("");
  const [businessError, setBusinessError] = useState<string | null>(null);
  useEffect(() => {
    if (!userId || !selectedBusinessId) return;
    try {
      window.localStorage.setItem(
        `ai-marketing-studio:business:${userId}`,
        selectedBusinessId,
      );
    } catch {
      // Ignore unavailable browser storage.
    }
  }, [userId, selectedBusinessId]);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    getBusinesses()
      .then((data) => {
        if (!active) return;
        setBusinesses(data);
        setSelectedBusinessId((current) => {
          let saved = "";
          try {
            saved =
              window.localStorage.getItem(
                `ai-marketing-studio:business:${userId}`,
              ) ?? "";
          } catch {
            // Continue with a default if storage is unavailable.
          }
          const valid = (id: string) =>
            data.some((business) => business.id === id);
          return valid(current)
            ? current
            : valid(saved)
              ? saved
              : (data[0]?.id ?? "");
        });
        setBusinessError(null);
      })
      .catch(() => {
        if (active) {
          setBusinessError("No se pudieron cargar los negocios.");
        }
      });
    return () => {
      active = false;
    };
  }, [userId]);
  const addBusiness = (business: Business) => {
    setBusinesses((current) => [...current, business]);
    setSelectedBusinessId(business.id);
  };
  return {
    businesses,
    selectedBusinessId,
    setSelectedBusinessId,
    businessError,
    addBusiness,
  };
}

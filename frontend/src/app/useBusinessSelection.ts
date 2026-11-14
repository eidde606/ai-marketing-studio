import { useCallback, useEffect, useState } from "react";
import { useLocalization } from "./localization";
import { getBusinesses, type Business } from "../services/businessesApi";

/** Owned by the user-keyed workspace, so accounts never share selection state. */
export function useBusinessSelection(userId: string) {
  const { t } = useLocalization();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState("");
  const [businessError, setBusinessError] = useState<string | null>(null);
  const [businessLoading, setBusinessLoading] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refreshBusinesses = useCallback(async () => {
    setBusinessLoading(true);
    setRefreshVersion((current) => current + 1);
  }, []);
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
          setBusinessError(t("business.loadError"));
        }
      })
      .finally(() => {
        if (active) setBusinessLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, refreshVersion, t]);
  const addBusiness = (business: Business) => {
    setBusinesses((current) => [...current, business]);
    setSelectedBusinessId(business.id);
  };
  return {
    businesses,
    selectedBusinessId,
    setSelectedBusinessId,
    businessError,
    businessLoading,
    refreshBusinesses,
    addBusiness,
  };
}

import { useState, useEffect, useRef } from "react";
import {
  approveDraft,
  updateDraftDestinations,
  publishDraftToFacebook,
  publishDraftToTikTok,
  verifyTikTokPublication,
  verifyFacebookVideo,
} from "../../../services/draftsApi";
import type { DraftCollection } from "../../drafts/hooks/useDraftCollection";
import type { DraftOperations } from "../../drafts/hooks/useDraftOperations";
import { useLocalization } from "../../../app/localization";

export function useApprovalActions(
  selectedBusinessId: string,
  collection: DraftCollection,
  operations: DraftOperations,
) {
  const { t } = useLocalization();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const { visibleDrafts, setApprovals, updateLocalDraft, isCurrentBusiness } =
    collection;
  const {
    approvingIds,
    setApprovingIds,
    busyDraftIds,
    imageLocks,
    setApprovalError,
    publishingIds,
    setPublishingIds,
  } = operations;
  const [draftDestinations, setDraftDestinations] = useState<
    Record<string, { facebook: boolean; tiktok: boolean }>
  >({});
  const [publishError, setPublishError] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPublishError(null);
  }, [selectedBusinessId]);
  const handleApprove = async (id: string) => {
    if (
      approvingIds.includes(id) ||
      busyDraftIds.includes(id) ||
      imageLocks.current.has(id)
    )
      return;
    const draft = visibleDrafts.find((item) => item.id === id);
    if (!draft || draft.status !== "pending") return;
    setApprovalError(null);
    setApprovingIds((current) => [...current, id]);
    try {
      const selection = draftDestinations[id];

      const savedDestinations = draft.publish_destinations ?? ["facebook"];

      const destinations: ("facebook" | "tiktok")[] = [];

      if (selection?.facebook ?? savedDestinations.includes("facebook")) {
        destinations.push("facebook");
      }

      // The rendered TikTok flow is manual export. Approval may have no
      // direct-publishing destination and must not require a social connection.
      // Keep the separate direct-TikTok API handler gated from this UI.

      await updateDraftDestinations(id, destinations);
      const updated = await approveDraft(id);

      if (!isCurrentBusiness()) return;
      updateLocalDraft(updated);
    } catch {
      if (!isCurrentBusiness()) return;
      setApprovalError(tRef.current("approval.approveError"));
    } finally {
      setApprovingIds((current) => current.filter((value) => value !== id));
    }
  };

  const handlePublishTikTok = async (
    id: string,
    accountId: string,
    privacyLevel: string,
    interactions: {
      disable_comment: boolean;
      disable_duet: boolean;
      disable_stitch: boolean;
    },
  ) => {
    const draft = visibleDrafts.find((item) => item.id === id);

    if (
      !draft ||
      draft.status !== "approved" ||
      draft.tiktok_publish_status !== "not_published" ||
      publishingIds.includes(id)
    ) {
      return;
    }

    setPublishError(null);
    setPublishingIds((current) => [...current, id]);

    try {
      const result = await publishDraftToTikTok(id, {
        account_id: accountId,
        privacy_level: privacyLevel,
        ...interactions,
      });

      if (!isCurrentBusiness()) return;
      setApprovals((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                tiktok_publish_id: result.tiktok_publish_id,
                tiktok_publish_status: "needs_review",
              }
            : item,
        ),
      );
    } catch (error) {
      console.error("TikTok publishing failed:", error);

      if (!isCurrentBusiness()) return;
      setPublishError(
        tRef.current("approval.tiktokPublishError"),
      );

      // The request may have reached TikTok.
      // Do not automatically retry.
    } finally {
      setPublishingIds((current) => current.filter((value) => value !== id));
    }
  };

  // Publishing button will use this handler when ApprovalPage is connected.
  const handlePublishFacebook = async (id: string) => {
    const draft = visibleDrafts.find((item) => item.id === id);
    if (
      !draft ||
      draft.status !== "approved" ||
      draft.facebook_publish_status !== "not_published" ||
      publishingIds.includes(id)
    ) {
      return;
    }
    setPublishError(null);
    setPublishingIds((current) => [...current, id]);
    try {
      const result = await publishDraftToFacebook(id);
      if (!isCurrentBusiness()) return;
      setApprovals((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                facebook_post_id: result.facebook_post_id,
                facebook_publish_status:
                  result.status === "published" ? "published" : "needs_review",
                published_at:
                  result.status === "published"
                    ? new Date().toISOString()
                    : null,
              }
            : item,
        ),
      );
    } catch {
      if (!isCurrentBusiness()) return;
      setPublishError(
        tRef.current("approval.facebookPublishError"),
      );
      // The server may have marked the draft as needing review.
      // Reloading drafts later will retrieve the authoritative status.
    } finally {
      setPublishingIds((current) => current.filter((value) => value !== id));
    }
  };

  const handleVerifyTikTok = async (id: string) => {
    if (publishingIds.includes(id)) return;

    setPublishError(null);
    setPublishingIds((current) => [...current, id]);

    try {
      const result = await verifyTikTokPublication(id);

      if (!isCurrentBusiness()) return;
      setApprovals((current) =>
        current.map((draft) =>
          draft.id === id
            ? {
                ...draft,
                tiktok_publish_status:
                  result.status === "published" ? "published" : "needs_review",
              }
            : draft,
        ),
      );
    } catch (error) {
      console.error("TikTok verification failed:", error);

      if (!isCurrentBusiness()) return;
      setPublishError(
        tRef.current("approval.tiktokVerifyError"),
      );
    } finally {
      setPublishingIds((current) => current.filter((value) => value !== id));
    }
  };

  const handleVerifyFacebookVideo = async (id: string) => {
    setPublishError(null);

    try {
      const result = await verifyFacebookVideo(id);

      if (isCurrentBusiness() && result.status === "published") {
        setApprovals((current) =>
          current.map((item) =>
            item.id === id
              ? {
                  ...item,
                  facebook_publish_status: "published",
                  published_at: new Date().toISOString(),
                }
              : item,
          ),
        );
      }
    } catch (error) {
      console.error("Facebook video verification failed:", error);
      if (!isCurrentBusiness()) return;
      setPublishError(
        tRef.current("approval.facebookVerifyError"),
      );
    }
  };

  useEffect(() => {
    const videosToVerify = visibleDrafts.filter(
      (draft) =>
        draft.status === "approved" &&
        draft.media_type === "video" &&
        draft.facebook_publish_status === "needs_review" &&
        !!draft.facebook_post_id,
    );

    if (videosToVerify.length === 0) return;

    let checking = false;

    const checkVideos = async () => {
      if (checking) return;

      checking = true;

      try {
        for (const draft of videosToVerify) {
          if (!isCurrentBusiness()) return;
          const result = await verifyFacebookVideo(draft.id);

          if (isCurrentBusiness() && result.status === "published") {
            setApprovals((current) =>
              current.map((item) =>
                item.id === draft.id
                  ? {
                      ...item,
                      facebook_publish_status: "published",
                      published_at: new Date().toISOString(),
                    }
                  : item,
              ),
            );
          }
        }
      } catch (error) {
        console.error("Automatic Facebook verification failed:", error);
      } finally {
        checking = false;
      }
    };

    void checkVideos();

    const interval = window.setInterval(() => {
      void checkVideos();
    }, 30000);

    return () => {
      window.clearInterval(interval);
    };
  }, [visibleDrafts, isCurrentBusiness, setApprovals]);

  return {
    draftDestinations,
    setDraftDestinations,
    publishError,
    handleApprove,
    handlePublishTikTok,
    handlePublishFacebook,
    handleVerifyTikTok,
    handleVerifyFacebookVideo,
  };
}

import { useState, useEffect, useRef } from "react";
import {
  approveDraft,
  getDrafts,
  publishDraftToInstagram,
  updateDraftDestinations,
  publishDraftToFacebook,
  publishDraftToTikTok,
  verifyTikTokPublication,
  verifyFacebookVideo,
} from "../../../services/draftsApi";
import { getConnectedFacebookAccounts } from "../../../services/facebookApi";
import { getInstagramConnection } from "../../../services/instagramApi";
import type { DraftCollection } from "../../drafts/hooks/useDraftCollection";
import type { DraftOperations } from "../../drafts/hooks/useDraftOperations";
import { useLocalization } from "../../../app/useLocalization";

export function useApprovalActions(
  selectedBusinessId: string,
  collection: DraftCollection,
  operations: DraftOperations,
  canPublish: boolean,
  isActive: boolean,
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
    Record<string, { facebook: boolean; instagram: boolean }>
  >({});
  const [publisherStatus, setPublisherStatus] = useState<{
    businessId: string;
    facebook: string | null;
    instagram: string | null;
  }>({ businessId: "", facebook: null, instagram: null });
  const publisherStatusLoading =
    !!selectedBusinessId &&
    canPublish &&
    isActive &&
    publisherStatus.businessId !== selectedBusinessId;
  const facebookPublisher =
    publisherStatus.businessId === selectedBusinessId
      ? publisherStatus.facebook
      : null;
  const instagramPublisher =
    publisherStatus.businessId === selectedBusinessId
      ? publisherStatus.instagram
      : null;
  const [publishError, setPublishError] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPublishError(null);
  }, [selectedBusinessId]);
  useEffect(() => {
    let active = true;
    if (!selectedBusinessId || !canPublish || !isActive) return;

    Promise.allSettled([
      getConnectedFacebookAccounts(selectedBusinessId),
      getInstagramConnection(selectedBusinessId),
    ]).then(([facebookResult, instagramResult]) => {
      if (!active) return;
      let facebook: string | null = null;
      let instagram: string | null = null;
      if (facebookResult.status === "fulfilled") {
        const accounts = facebookResult.value.filter(
          (account) => account.connection_status === "connected",
        );
        if (accounts.length === 1) {
          facebook = accounts[0].page_name;
        }
      }
      if (
        instagramResult.status === "fulfilled" &&
        instagramResult.value.status === "connected_and_authorized"
      ) {
        instagram = instagramResult.value.username;
      }
      setPublisherStatus({ businessId: selectedBusinessId, facebook, instagram });
    });

    return () => {
      active = false;
    };
  }, [selectedBusinessId, canPublish, isActive]);
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

      const destinations: ("facebook" | "instagram" | "tiktok")[] = [];

      const wantsFacebook =
        selection?.facebook === true ||
        (!selection &&
          savedDestinations.includes("facebook") &&
          !!facebookPublisher);
      const wantsInstagram =
        selection?.instagram === true ||
        (!selection &&
          savedDestinations.includes("instagram") &&
          !!instagramPublisher);

      if (wantsFacebook && !facebookPublisher) {
        setApprovalError(
          tRef.current("approval.facebookConnectionUnavailable"),
        );
        return;
      }
      if (wantsInstagram && !instagramPublisher) {
        setApprovalError(
          tRef.current("approval.instagramConnectionUnavailable"),
        );
        return;
      }

      if (wantsFacebook) {
        destinations.push("facebook");
      }
      if (
        wantsInstagram &&
        draft.media_type === "image" &&
        draft.image_status === "completed" &&
        !!draft.image_url &&
        /\.(jpe?g)$/i.test(draft.image_url) &&
        draft.caption.length <= 2200
      ) {
        destinations.push("instagram");
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
      setPublishError(tRef.current("approval.tiktokPublishError"));

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
      setPublishError(tRef.current("approval.facebookPublishError"));
      // The server may have marked the draft as needing review.
      // Reloading drafts later will retrieve the authoritative status.
    } finally {
      setPublishingIds((current) => current.filter((value) => value !== id));
    }
  };

  const handlePublishInstagram = async (id: string) => {
    const draft = visibleDrafts.find((item) => item.id === id);
    const status = draft?.instagram_publish_status ?? "not_published";
    if (
      !draft ||
      draft.status !== "approved" ||
      !instagramPublisher ||
      publisherStatusLoading ||
      !(draft.publish_destinations ?? []).includes("instagram") ||
      draft.media_type !== "image" ||
      draft.image_status !== "completed" ||
      !draft.image_url ||
      !/\.(jpe?g)$/i.test(draft.image_url.split("?")[0]) ||
      draft.caption.length > 2200 ||
      !["not_published", "failed"].includes(status) ||
      publishingIds.includes(id)
    ) {
      return;
    }

    setPublishError(null);
    setPublishingIds((current) => [...current, id]);
    try {
      const result = await publishDraftToInstagram(id);
      if (!isCurrentBusiness()) return;
      setApprovals((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                instagram_media_id: result.instagram_media_id,
                instagram_permalink: result.instagram_permalink,
                instagram_publish_status: "published",
                instagram_published_at: new Date().toISOString(),
              }
            : item,
        ),
      );
    } catch {
      if (!isCurrentBusiness()) return;
      setPublishError(tRef.current("approval.instagramPublishError"));
      try {
        const drafts = await getDrafts(selectedBusinessId, true);
        if (isCurrentBusiness()) setApprovals(drafts);
      } catch {
        if (isCurrentBusiness()) {
          setPublishError(tRef.current("approval.instagramStatusRefreshError"));
        }
      }
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
      setPublishError(tRef.current("approval.tiktokVerifyError"));
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
      setPublishError(tRef.current("approval.facebookVerifyError"));
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
    facebookPublisher,
    instagramPublisher,
    publisherStatusLoading,
    publishError,
    handleApprove,
    handlePublishTikTok,
    handlePublishFacebook,
    handlePublishInstagram,
    handleVerifyTikTok,
    handleVerifyFacebookVideo,
  };
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getAccount,
  updateAccountPreferences,
  type AccountResponse,
  type Language,
} from "../services/accountApi";

const en = {
  "app.name": "AI Marketing Studio",
  "common.loading": "Loading...",
  "common.retry": "Try again",
  "common.cancel": "Cancel",
  "common.save": "Save changes",
  "common.saving": "Saving…",
  "common.account": "Account",
  "common.business": "Business",
  "common.language": "Language",
  "common.english": "English",
  "common.spanish": "Español",
  "common.saved": "Saved",
  "common.emailUnavailable": "Email unavailable",
  "common.error": "Something went wrong. Please try again.",
  "app.starting": "Starting your workspace…",
  "app.accessUnavailable": "Workspace access unavailable",
  "app.accessRetry": "We couldn't verify your account or business access.",
  "app.signOutAndRetry": "Sign out and try another account",
  "app.accountNotProvisioned":
    "This account is not currently authorized for the workspace.",
  "app.recovering": "Account recovery",
  "app.createBusinessFirst":
    "Create a business to start building your marketing workspace.",
  "app.accessRetrying": "Checking access…",
  "agent.sofiaRole": "Marketing strategist",
  "agent.leoRole": "Content creator",
  "agent.unverified": "Not verified",
  "agent.generated": "Content generated",
  "agent.noActivity": "No activity recorded",
  "agent.checkingActivity": "Checking activity…",
  "agent.activityFailed": "Activity could not be loaded.",
  "agent.strategyUsed": "Strategy used in AI-generated content",
  "agent.aiDraftSaved": "AI-created post saved as a draft",
  "agent.noGenerations": "No AI generations are recorded for this business.",
  "team.eyebrow": "Plan and create",
  "team.title": "Your AI marketing team",
  "team.description":
    "Sofía helps shape the strategy, and Leo turns it into content. Results only include data the connected platforms provide.",
  "team.roles": "AI team roles",
  "team.automation": "Automation",
  "team.activity": "AI team activity",
  "drafts.loading": "Loading drafts…",
  "dashboard.heroEyebrow": "Your creative workspace",
  "dashboard.hello": "Welcome, {name}",
  "dashboard.intro":
    "Track your work and choose a helpful next step for your marketing.",
  "dashboard.create": "Create content",
  "dashboard.preparing": "Preparing content…",
  "dashboard.workflow": "Marketing workflow",
  "dashboard.stepCreate": "Create",
  "dashboard.stepReview": "Review",
  "dashboard.stepApprove": "Approve & publish",
  "dashboard.stepResults": "Results",
  "dashboard.businessActivity": "Business activity",
  "dashboard.activeCampaigns": "Active campaigns",
  "dashboard.thisBusiness": "For this business",
  "dashboard.library": "Content library",
  "dashboard.draftsHistory": "Drafts and history",
  "dashboard.pendingReview": "Pending review",
  "dashboard.awaitingApproval": "Awaiting your approval",
  "dashboard.awaitingAdmin": "Waiting for an owner or admin",
  "dashboard.uniqueViewers": "Unique viewers",
  "dashboard.unavailableMetrics": "{count} posts without available data",
  "dashboard.facebookMetrics": "Available Facebook metrics",
  "dashboard.plan": "Plan",
  "dashboard.campaigns": "Campaigns",
  "dashboard.viewCampaigns": "View campaigns",
  "dashboard.loadingCampaigns": "Loading campaigns…",
  "dashboard.campaignsLoadError": "Campaigns could not be loaded.",
  "dashboard.campaignStatus.active": "Active",
  "dashboard.campaignStatus.paused": "Paused",
  "dashboard.campaignStatus.completed": "Completed",
  "dashboard.campaignStatus.archived": "Archived",
  "dashboard.campaignStatus.draft": "Draft",
  "dashboard.postsPublished":
    "{published} of {total} posts published · {progress}%",
  "dashboard.firstCampaign": "Your first campaign starts here",
  "dashboard.campaignHelp":
    "Set an objective and organize content for your business. Campaigns are optional.",
  "dashboard.createCampaign": "Create campaign",
  "dashboard.review": "Review",
  "dashboard.needsAttention": "Needs attention",
  "dashboard.reviewDraft": "Review",
  "dashboard.approving": "Approving…",
  "dashboard.approve": "Approve",
  "dashboard.reject": "Reject",
  "dashboard.noPending": "No items need review",
  "dashboard.inboxCurrent": "Your review queue is up to date.",
  "dashboard.openReview": "Open review",
  "dashboard.published": "Published",
  "dashboard.recentActivity": "Recent activity",
  "dashboard.viewContent": "View content",
  "dashboard.publishedLabel": "Published",
  "dashboard.noPublications": "Confirmed publications will appear here.",
  "dashboard.team": "Your AI team",
  "dashboard.teamActivity": "Roles and activity",
  "dashboard.openTeam": "Go to AI team",
  "content.loading": "Loading content…",
  "content.introEyebrow": "Create and organize",
  "content.title": "Content library",
  "content.description":
    "Find drafts, check their status, and review published posts.",
  "content.itemCount": "{count} {item}",
  "content.itemSingular": "item",
  "content.itemPlural": "items",
  "content.searchAndFilter": "Search and filter content",
  "content.searchLabel": "Search content",
  "content.searchPlaceholder": "Search by title, text, or platform",
  "content.statusFilter": "Status",
  "content.filter.all": "All content",
  "content.filter.pending": "Pending review",
  "content.filter.approved": "Approved",
  "content.filter.published": "Published",
  "content.filter.rejected": "Rejected",
  "content.emptyResults": "No results found",
  "content.emptyLibrary": "Your library is ready",
  "content.refineSearch": "Try different terms or change the status filter.",
  "content.libraryEmpty":
    "Content created and published for this business will appear here.",
  "content.previewOf": "Preview of {title}",
  "content.previewLoading": "Loading preview…",
  "content.preview": "View preview",
  "content.createdWithAI": "AI-created",
  "content.createdManually": "Created manually",
  "content.metricsLoading": "Loading…",
  "content.refreshMetrics": "Refresh metrics",
  "content.viewMetrics": "View metrics",
  "content.facebookMetrics": "Facebook metrics",
  "content.reactions": "reactions",
  "content.comments": "comments",
  "content.shares": "shares",
  "content.openPost": "Open post",
  "content.analyticsError": "Facebook metrics could not be loaded.",
  "content.previewError": "Preview could not be loaded.",
  "content.statusLabel.published": "Published",
  "content.statusLabel.approved": "Approved",
  "content.statusLabel.rejected": "Rejected",
  "content.statusLabel.pending": "Pending review",
  "analytics.loading": "Loading content…",
  "analytics.eyebrow": "Measure what matters",
  "analytics.title": "Results",
  "analytics.description":
    "Available results from this business's published posts.",
  "analytics.refreshing": "Refreshing…",
  "analytics.refreshMetrics": "Refresh metrics",
  "analytics.sourceNote":
    "Data shown here comes from Facebook. TikTok trends and metrics are not available in this view.",
  "analytics.querying": "Checking Facebook metrics…",
  "analytics.loadError": "Analytics could not be processed.",
  "analytics.facebookMetrics": "Facebook metrics",
  "analytics.confirmedPosts": "Confirmed posts",
  "analytics.facebookHistory": "Facebook history",
  "analytics.reactions": "Reactions",
  "analytics.comments": "Comments",
  "analytics.shares": "Shares",
  "analytics.accessibleTotal": "Total accessible data",
  "analytics.noData": "No data available",
  "analytics.unavailableOne":
    "{count} post has no available metrics. This may be due to access restrictions or deletion on Facebook.",
  "analytics.unavailableMany":
    "{count} posts have no available metrics. This may be due to access restrictions or deletion on Facebook.",
  "analytics.detail": "Details",
  "analytics.postsAnalyzed": "Posts analyzed",
  "analytics.withData": "{count} with data",
  "analytics.noFacebookPosts": "No Facebook posts yet",
  "analytics.postsWillAppear":
    "Metrics will appear when posts are confirmed as published.",
  "analytics.noAvailableMetrics": "No metrics available",
  "analytics.postsNoMetrics":
    "{count} confirmed posts, but Facebook returned no accessible data.",
  "analytics.viewPost": "View post",
  "sofia.title": "Talk with Sofia",
  "sofia.description": "Your AI marketing strategist.",
  "sofia.currentConversation": "CURRENT CONVERSATION",
  "sofia.currentTitle": "Current conversation",
  "sofia.newConversationTitle": "New conversation",
  "sofia.active": "Active",
  "sofia.notStarted": "Not started",
  "sofia.newConversation": "New conversation",
  "sofia.history": "History",
  "sofia.previousConversations": "Previous conversations",
  "sofia.noConversations": "No conversations saved yet.",
  "sofia.current": "Current",
  "sofia.messages": "Messages with Sofia",
  "sofia.loadingConversation": "Loading conversation…",
  "sofia.greeting":
    "Hi! I'm Sofia. Tell me what product you'd like to promote or share an idea for your business.",
  "sofia.you": "You",
  "sofia.thinking": "Sofia is preparing a response…",
  "sofia.retryMessage": "Retry message",
  "sofia.retryDraft": "Retry draft",
  "sofia.retryLoad": "Retry loading",
  "sofia.messageLabel": "Message for Sofia",
  "sofia.loadingPlaceholder": "Loading conversation…",
  "sofia.messagePlaceholder": "Write a message to Sofia…",
  "sofia.sending": "Sending…",
  "sofia.send": "Send",
  "sofia.generating": "Sofia and Leo are working…",
  "sofia.createDraft": "Create a draft with Leo",
  "sofia.draftCreated":
    "Draft created: {title}. Review it in the Review section.",
  "sofia.conversationLoadError": "Conversation could not be loaded.",
  "sofia.historyLoadError": "Conversation history could not be refreshed.",
  "sofia.contactError": "Sofia could not be reached.",
  "sofia.draftError": "Draft could not be generated.",
  "sofia.dateUnavailable": "Date unavailable",
  "sofia.newCampaign": "New campaign",
  "campaigns.noBusiness": "Select a business to manage its campaigns.",
  "campaigns.eyebrow": "Plan",
  "campaigns.title": "Campaigns",
  "campaigns.description":
    "Set objectives and organize your business content. Campaigns are optional.",
  "campaigns.new": "New campaign",
  "campaigns.organization": "Work organization",
  "campaigns.planTitle": "Your marketing plan",
  "campaigns.planDescription":
    "Select a campaign to review its objectives and progress.",
  "campaigns.refresh": "Refresh",
  "campaigns.loading": "Loading campaigns…",
  "campaigns.loadError": "Campaigns could not be loaded. Try again.",
  "campaigns.saveError": "Campaign could not be saved.",
  "campaigns.emptyTitle": "No campaigns yet",
  "campaigns.emptyDescription":
    "Create one to set an objective and organize your content.",
  "campaigns.edit": "Edit campaign",
  "campaigns.name": "Name",
  "campaigns.objective": "Objective",
  "campaigns.status": "Status",
  "campaigns.startDate": "Start date (optional)",
  "campaigns.endDate": "End date (optional)",
  "campaigns.saving": "Saving…",
  "campaigns.save": "Save campaign",
  "campaigns.cancel": "Cancel",
  "campaigns.deleting": "Deleting…",
  "campaigns.delete": "Delete campaign",
  "campaigns.deleteConfirm":
    'Permanently delete the campaign "{name}"? Its drafts, approvals, and posts will be kept without a campaign.',
  "campaigns.deleted":
    "Campaign deleted. Its content and history have been preserved.",
  "campaigns.status.draft": "Draft",
  "campaigns.status.active": "Active",
  "campaigns.status.paused": "Paused",
  "campaigns.status.completed": "Completed",
  "campaigns.status.archived": "Archived",
  "campaigns.draftStatus.pending": "Pending approval",
  "campaigns.draftStatus.approved": "Approved",
  "campaigns.draftStatus.rejected": "Rejected",
  "campaigns.progressLabel": "Progress for {name}",
  "campaigns.published": "{progress}% · {published} published of {total}",
  "campaigns.pendingRejected": "{pending} pending · {rejected} rejected",
  "campaigns.dateUnavailable": "No date",
  "campaigns.publishProgress": "Publication progress",
  "campaigns.confirmedProgress":
    "Only confirmed publications to Facebook or TikTok count, once per post. Approval, download, or copy does not count as publishing. Rejected posts remain pending; deleted unpublished posts are excluded.",
  "campaigns.publishedCount": "{count} published",
  "campaigns.pendingCount": "{count} awaiting publication",
  "campaigns.rejectedCount": "{count} rejected",
  "campaigns.associatedContent": "Associated content",
  "campaigns.noCountableContent": "This campaign has no countable content yet.",
  "campaigns.postStatus.published": "Published",
  "campaigns.postStatus.pending": "Awaiting publication",
  "campaigns.deletedHistory": "Deleted (history retained)",
  "campaigns.detach": "Remove from campaign",
  "campaigns.detachDraft": "Remove {title} from campaign",
  "campaigns.approvalLocation":
    "Manage reviews and publishing in the Review section. To archive this campaign, change its status in Edit campaign.",
  "campaigns.associateExisting": "Add existing content",
  "campaigns.selectUnassigned": "Select content not in a campaign",
  "campaigns.associate": "Add to campaign",
  "campaigns.noAvailableContent":
    "No unassigned content is available. You can create content with Sofia and Leo or remove it from another campaign.",
  "businessForm.title": "Add a business",
  "businessForm.description":
    "Tell us about your business so the AI team can create tailored strategies and content.",
  "businessForm.name": "Business name",
  "businessForm.namePlaceholder": "e.g. Latitude Food Fusion",
  "businessForm.industry": "Business type",
  "businessForm.industryPlaceholder":
    "e.g. Restaurant, entertainment, online store",
  "businessForm.descriptionLabel": "Description",
  "businessForm.descriptionPlaceholder":
    "Describe your business and what makes it special",
  "businessForm.products": "Products or services",
  "businessForm.productsPlaceholder":
    "e.g. Signature dishes, services, or product lines",
  "businessForm.audience": "Target audience",
  "businessForm.audiencePlaceholder":
    "What kinds of customers do you want to reach?",
  "businessForm.area": "Service area",
  "businessForm.areaPlaceholder": "e.g. Richmond, Virginia",
  "businessForm.voice": "Brand voice",
  "businessForm.voicePlaceholder": "e.g. Friendly, upbeat, professional",
  "businessForm.website": "Website",
  "businessForm.goals": "Marketing goals",
  "businessForm.goalsPlaceholder":
    "e.g. Increase orders, get bookings, attract customers",
  "businessForm.platforms": "Preferred social platforms",
  "businessForm.platformsPlaceholder": "e.g. Instagram, Facebook, TikTok",
  "businessForm.frequency": "Posting frequency",
  "businessForm.chooseFrequency": "Choose a frequency",
  "businessForm.frequency.daily": "Every day",
  "businessForm.frequency.five": "5 times a week",
  "businessForm.frequency.three": "3 times a week",
  "businessForm.frequency.weekly": "Once a week",
  "businessForm.frequency.manual": "As needed",
  "businessForm.saveError": "Business could not be saved. Try again.",
  "businessForm.cancel": "Cancel",
  "businessForm.saving": "Saving…",
  "businessForm.save": "Save business",
  "facebook.eyebrow": "Social accounts",
  "facebook.title": "Connect Facebook",
  "facebook.description":
    "Connect a Facebook Page to publish content from AI Marketing Studio.",
  "facebook.selectPage": "Select a Page",
  "facebook.settings": "Settings",
  "facebook.manageTitle": "Manage posts in one place",
  "facebook.manageDescription":
    "Authorize Facebook and choose the Page you want to manage.",
  "facebook.connect": "Connect Facebook",
  "facebook.reconnect": "Reconnect Facebook",
  "facebook.processing": "Connecting…",
  "facebook.connected": "Connected",
  "facebook.verifyError": "Facebook connection could not be verified.",
  "facebook.startError": "Facebook connection could not be started.",
  "facebook.pagesError": "Facebook Pages could not be retrieved.",
  "facebook.wrongBusiness": "Select the correct business before continuing.",
  "facebook.selectPageError": "The selected Page could not be connected.",
  "facebook.connectedPage": "Page connected: {name}",
  "facebook.loading": "Processing connection…",
  "facebook.choosePageTitle": "Choose a Page",
  "facebook.choosePageDescription":
    "Choose the Page you want to connect to this business.",
  "instagram.title": "Connect Instagram",
  "instagram.description":
    "Authorize the professional account linked to this business's Facebook Page.",
  "instagram.connectionOnly":
    "Instagram connection is available for account setup and verification. Publishing to Instagram is not currently supported.",
  "instagram.account": "Instagram account",
  "instagram.status.notConnected": "Not connected",
  "instagram.status.linked": "Linked · permissions missing",
  "instagram.status.connected": "Connected and authorized",
  "instagram.status.reauthorize": "Reauthorization required",
  "instagram.status.permission": "Insufficient permissions",
  "instagram.status.discovery": "Could not verify",
  "instagram.callback.connected":
    "Instagram was connected and authorized by Meta.",
  "instagram.callback.linked":
    "The account is linked, but publishing permission is missing. Review Meta settings and reconnect.",
  "instagram.callback.notConnected":
    "The authorized Page did not return a linked professional Instagram account.",
  "instagram.callback.reauthorize":
    "Meta requires new authorization. Review permissions and try again.",
  "instagram.callback.permission":
    "Meta did not grant all requested permissions. Review Instagram Login settings.",
  "instagram.callback.discovery":
    "Meta could not verify the Page and Instagram account. Review Page access.",
  "instagram.callback.invalid":
    "The connection request expired or was already used. Start a new connection.",
  "instagram.callback.declined": "Instagram authorization was not completed.",
  "instagram.callback.received": "Meta's response was received.",
  "instagram.verifyError": "Instagram connection could not be verified.",
  "instagram.connectError": "Instagram connection could not be started.",
  "instagram.status.loading": "Checking…",
  "instagram.page": "Facebook Page: {name}",
  "instagram.missingPermissions": "Missing permissions: {permissions}",
  "instagram.opening": "Opening Meta…",
  "instagram.connect": "Connect Instagram",
  "instagram.reconnect": "Reconnect Instagram",
  "instagram.loading": "Checking saved Instagram connection…",
  "instagram.retry": "Retry verification",
  "instagram.noBusiness": "Select a business to manage Instagram.",
  "tiktok.eyebrow": "Social accounts",
  "tiktok.title": "Connect TikTok",
  "tiktok.description":
    "Authorize TikTok for this business and check the connected account status.",
  "tiktok.manualOnly":
    "TikTok publishing is manual export only. Connecting an account does not publish posts from this app.",
  "tiktok.connectedStatus": "Connected",
  "tiktok.reviewAccess": "Review access",
  "tiktok.notConnected": "Not connected",
  "tiktok.checking": "Checking…",
  "tiktok.available": "TikTok authorization is available",
  "tiktok.eligibility":
    "Publishing depends on permissions and account eligibility. A connection does not guarantee TikTok will accept every post.",
  "tiktok.connect": "Connect TikTok",
  "tiktok.reconnect": "Reconnect TikTok",
  "tiktok.loading": "Checking TikTok status…",
  "tiktok.verified": "TikTok account verified for this business.",
  "tiktok.wrongBusiness": "Check that you selected the correct business.",
  "tiktok.verifyError": "TikTok connection could not be verified. Try again.",
  "tiktok.connectError": "TikTok connection could not be started.",
  "tiktok.account": "TikTok account",
  "tiktok.status": "Status: {status}",
  "tiktok.unverified": "unverified",
  "tiktok.retry": "Retry verification",
  "approval.eyebrow": "Review before publishing",
  "approval.title": "Content and approvals",
  "approval.description": "Approve content before publishing begins.",
  "approval.pendingCount": "{count} pending",
  "approval.status.pending": "Pending approval",
  "approval.status.approved": "Approved",
  "approval.status.rejected": "Rejected",
  "approval.caption": "Post text",
  "approval.actions": "Actions for {title}",
  "approval.destinationOptional": "Publishing destination (optional):",
  "approval.manualDestination":
    "Leave Facebook unchecked to approve for manual use. TikTok supports manual export only; Instagram publishing is not available.",
  "approval.approving": "Approving…",
  "approval.approve": "✓ Approve",
  "approval.processing": "Processing…",
  "approval.reject": "Reject",
  "approval.edit": "Edit",
  "approval.finalApproved": "✓ Approved",
  "approval.finalRejected": "✕ Rejected",
  "approval.confirmVideo":
    "Send this video and its caption to Facebook? Processing may take a few minutes.",
  "approval.confirmImage": "Publish this image and its caption to Facebook?",
  "approval.confirmText": "Publish this text to Facebook?",
  "approval.publishing": "Publishing…",
  "approval.publishFacebook": "Publish to Facebook",
  "approval.publishedFacebook": "✓ Published to Facebook",
  "approval.publishingStatus":
    "Publication is processing. Refresh to check its status.",
  "approval.needsReview":
    "Publication needs verification. Check Facebook before retrying.",
  "approval.verifyFacebook": "Verify Facebook post",
  "approval.downloading": "Downloading video…",
  "approval.downloadTikTok": "⬇ Download video for TikTok",
  "approval.captionCopied": "✓ Caption copied",
  "approval.copyCaption": "Copy caption and hashtags",
  "approval.deleting": "Deleting…",
  "approval.delete": "Delete",
  "approval.empty": "There are no drafts to review yet.",
  "draftEdit.title": "Title",
  "draftEdit.caption": "Post text",
  "draftEdit.saving": "Saving…",
  "draftEdit.save": "Save changes",
  "draftEdit.cancel": "Cancel",
  "media.ariaLabel": "Media and tools for this draft",
  "media.videoAssets": "Video media",
  "media.postImage": "Post image",
  "media.imageGenerating":
    "Image generation is in progress. This may take a few minutes.",
  "media.imageFailed": "The previous image generation did not complete.",
  "media.imageReady": "The image is saved and ready to preview.",
  "media.imageFor": "Image for {title}",
  "media.generatingImage": "Generating image…",
  "media.retryImage": "Retry image",
  "media.createImage": "✦ Generate image",
  "media.loadingImage": "Loading image…",
  "media.refreshPreview": "Refresh preview",
  "media.viewImage": "View image",
  "media.videoPost": "Post video",
  "media.loadingVideo": "Loading video…",
  "media.closeVideo": "Close video",
  "media.viewVideo": "🎬 Preview video",
  "media.videoUnsupported": "Your browser does not support video playback.",
  "media.heygenScript": "🎬 HeyGen script",
  "media.copied": "✓ Copied",
  "media.copyScript": "Copy script",
  "media.closeHeygen": "Close video generation",
  "media.createHeygen": "Create or recover video with HeyGen",
  "media.closeUpload": "Close video upload",
  "media.uploadVideo": "🎬 Upload MP4 video",
  "media.noImagePrompt": "This draft has no AI-generated image description.",
  "media.imageEditor": "✦ Edit image with AI",
  "media.imageInstructions":
    "Describe the changes you'd like. The original image will be kept until you accept a new version.",
  "media.revisionReady": "New version ready to review",
  "media.original": "Original",
  "media.viewOriginal": "View original",
  "media.newVersion": "New version",
  "media.noPreview": "No preview was returned. Refresh the status.",
  "media.acceptRevision": "✓ Accept new version",
  "media.keepOriginal": "Keep original",
  "media.revisionGenerating":
    "The new image is generating. Wait for the result before requesting another.",
  "media.instructionsLabel": "Instructions for AI",
  "media.instructionsPlaceholder":
    "For example: Improve the lighting and replace the background with an elegant table.",
  "media.suggestion.lighting": "Improve lighting",
  "media.suggestion.background": "Change the background",
  "media.suggestion.professional": "More professional style",
  "media.generatingRevision": "Generating new version…",
  "media.generateRevision": "✦ Generate new version",
  "media.costNotice":
    "AI image generation may incur additional costs. You will be asked to confirm before continuing.",
  "media.refreshStatus": "Refresh status",
  "heygen.title": "Create a video with HeyGen",
  "heygen.loadingVideo": "Loading video…",
  "heygen.loadingAvatars": "Loading avatars…",
  "heygen.noAvatars": "No avatars match these filters.",
  "heygen.selectAvatar": "Select an avatar",
  "heygen.loadingMoreAvatars": "Loading…",
  "heygen.loadMoreAvatars": "Load more avatars",
  "heygen.loadingVoices": "Loading voices…",
  "heygen.noVoices": "No voices match these filters.",
  "heygen.selectVoice": "Select a voice",
  "heygen.loadingMoreVoices": "Loading…",
  "heygen.loadMoreVoices": "Load more voices",
  "heygen.progress.submitting": "Submitting the request to HeyGen…",
  "heygen.progress.checking": "Checking the saved status…",
  "heygen.progress.recovering": "Sending and confirming the request…",
  "heygen.progress.processing": "HeyGen is generating the video…",
  "heygen.progress.storing": "Saving the video to private storage…",
  "heygen.status.uncertain":
    "We don't know whether HeyGen received the request. Recover its status before requesting another video.",
  "heygen.status.failed":
    "HeyGen could not generate the video. Review the details before authorizing another generation.",
  "heygen.status.stored":
    "Video saved privately. Preview it before approving the content.",
  "heygen.status.storageFailed":
    "The video could not be attached. The draft may have changed. Contact an administrator.",
  "heygen.status.completed":
    "The video was generated. Recover its status to finish saving it privately.",
  "heygen.status.processing":
    "HeyGen is processing your video. This may take a few minutes.",
  "heygen.status.checked": "Review the script and select an avatar and voice.",
  "heygen.status.checking": "Checking video status…",
  "heygen.previewError": "Video could not be opened. Request a new preview.",
  "heygen.previewExpired":
    "The preview expired or is unavailable. Refresh it to view the video again.",
  "heygen.recovering": "Checking…",
  "heygen.recover": "Recover video status",
  "heygen.ariaLabel": "HeyGen video generation",
  "heygen.configure":
    "Configure your avatar, voice, and script before generating a video.",
  "heygen.script": "Video script",
  "heygen.scriptHelp":
    "Up to 5,000 characters. Your text is preserved as written.",
  "heygen.formatNotice":
    "Vertical video · 1080p. HeyGen uses API credits. The exact cost is not available here.",
  "heygen.generate": "Generate video with HeyGen",
  "heygen.confirmNotice":
    "Choose an avatar and voice. You will confirm before sending the paid request.",
  "heygen.previewLoading": "Loading video…",
  "heygen.previewRefresh": "Refresh private preview",
  "heygen.noAutoAction":
    "Generating a video does not approve or publish this content.",
  "heygen.confirmPaid":
    "Generate this video with HeyGen? This uses API credits and may incur a charge. It will not be approved or published automatically.",
  "heygen.busyOtherOperation":
    "Wait for the other draft operation to finish before recovering the video.",
  "heygen.closeAssets": "Close HeyGen assets",
  "heygen.exploreAssets": "Explore HeyGen avatars and voices",
  "heygen.assetsTitle": "Select HeyGen assets",
  "heygen.assetsDescription":
    "Explore assets available in the connected account. This selection does not generate videos or use credits.",
  "heygen.availability": "Availability",
  "heygen.myAvatars": "My avatars",
  "heygen.publicAvatars": "Public avatars",
  "heygen.avatarType": "Avatar type",
  "heygen.retryAvatars": "Retry loading avatars",
  "heygen.avatar": "Avatar",
  "heygen.selectedAvatar": "Selected avatar",
  "heygen.avatarTypeLabel": "Type: {type} · ID: {id}",
  "heygen.defaultVoice": "Default voice: {id}",
  "heygen.supportedEngines": "Supported engines: {engines}",
  "heygen.avatarPreview": "Preview of {name}",
  "heygen.avatarType.all": "All types",
  "heygen.avatarType.digitalTwin": "Digital twin",
  "heygen.avatarType.photo": "Photo avatar",
  "heygen.avatarType.studio": "Studio avatar",
  "heygen.avatarLoadError": "Avatars could not be loaded.",
  "heygen.voiceLoadError": "Voices could not be loaded.",
  "heygen.voices": "Voices",
  "heygen.myVoices": "My voices",
  "heygen.publicVoices": "Public voices",
  "heygen.retryVoices": "Retry loading voices",
  "heygen.voice": "Voice",
  "heygen.defaultVoiceFor": "Default voice for {name}",
  "heygen.selectedVoice": "Selected voice",
  "heygen.selectActiveAssets":
    "Select an available avatar and an active voice from the list to continue.",
  "heygen.selectedVoiceLabel": "Selected voice: {name}",
  "videoUpload.title": "Upload video",
  "videoUpload.choosePrompt": "Choose your video",
  "videoUpload.dropHelp":
    "Drag an MP4 file here or choose one from your device.",
  "videoUpload.choose": "Choose video",
  "videoUpload.none": "No file selected",
  "videoUpload.remove": "Remove selected video",
  "videoUpload.uploading": "Uploading video…",
  "videoUpload.upload": "Upload video",
  "videoUpload.doNotClose": "Uploading your video. Do not close this page.",
  "videoUpload.mp4Only": "Only MP4 video files are allowed.",
  "videoUpload.error": "Video could not be uploaded.",
  "media.confirmGenerate":
    "Generate an AI image? This may incur a charge from the OpenAI API.",
  "media.generationUncertain":
    "Image generation could not be confirmed. Refresh the page before trying again.",
  "media.imageLoadError": "Image could not be loaded. Try again.",
  "media.revisionStatusError": "Edit status could not be checked.",
  "media.confirmRevision":
    "Create a new AI-generated image? This may incur an additional OpenAI charge. The original will be kept.",
  "media.revisionUncertain":
    "Image generation could not be confirmed. Check its status before trying again to avoid duplicate charges.",
  "media.confirmAccept": "Use the new version for this post?",
  "media.revisionDecisionError":
    "The change could not be confirmed. Refresh the page and check the result.",
  "media.captionCopyError": "Caption could not be copied.",
  "media.downloadError": "Video could not be downloaded.",
  "media.scriptCopyError":
    "Script could not be copied. Select the text to copy it.",
  "media.videoPreviewError": "Video could not be loaded.",
  "approval.tiktokPublishError":
    "TikTok publication could not be confirmed. Check its status before trying again.",
  "approval.facebookPublishError":
    "Facebook publication could not be confirmed. Check Facebook before trying again.",
  "approval.tiktokVerifyError":
    "TikTok post could not be verified. Try again later.",
  "approval.facebookVerifyError":
    "Video could not be verified. Try again later.",
  "approval.approveError": "Draft could not be approved. Try again.",
  "draft.deleteConfirm":
    "Delete this item from Review? Posts already published to social networks will not be deleted.",
  "draft.deleteError":
    "Item could not be deleted. If an operation is in progress, wait for it to finish and try again.",
  "draft.rejectConfirm": "Reject this post? It will remain in the history.",
  "draft.rejectError": "Draft could not be rejected. Try again.",
  "draft.saveError": "Draft could not be saved. Try again.",
  "draft.generationError": "Content could not be generated. Try again.",
  "draft.requiredFields": "Title and post text cannot be empty.",
  "nav.home": "Home",
  "nav.campaigns": "Campaigns",
  "nav.content": "Content",
  "nav.aiTeam": "AI team",
  "nav.approvals": "Review",
  "nav.analytics": "Results",
  "nav.settings": "Settings",
  "nav.workspace": "Workspace",
  "nav.main": "Main navigation",
  "nav.open": "Open main navigation",
  "nav.close": "Close navigation",
  "nav.pendingApprovals": "{count} items awaiting review",
  "nav.pendingReview": "{count} items to review",
  "shell.marketingStudio": "Marketing studio",
  "shell.selectBusiness": "Select business",
  "shell.noBusinesses": "No businesses yet",
  "shell.addBusiness": "Add business",
  "shell.accountMenu": "Open {name}'s account menu",
  "shell.myAccount": "My account",
  "shell.workAccount": "Workspace account",
  "shell.signOut": "Sign out",
  "shell.refreshAccess": "Refresh workspace access",
  "shell.permissionsUnavailable": "Business permissions could not be verified.",
  "shell.retryPermissions": "Retry access check",
  "business.loadError":
    "Businesses could not be loaded. Check access and retry.",
  "access.title": "This account cannot access the workspace",
  "access.body":
    "Sign in with an authorized account or contact the workspace owner.",
  "access.signOut": "Sign out",
  "auth.welcome": "Welcome back",
  "auth.continue": "Sign in to continue creating great ideas.",
  "auth.recover": "Reset your password",
  "auth.recoverHelp": "We'll send you a link to recover access.",
  "auth.newPassword": "Create a new password",
  "auth.newPasswordHelp": "Choose a new password for your account.",
  "auth.email": "Email address",
  "auth.password": "Password",
  "auth.passwordNew": "New password",
  "auth.forgot": "Forgot password?",
  "auth.showPassword": "Show password",
  "auth.hidePassword": "Hide password",
  "auth.processing": "Working…",
  "auth.signIn": "Sign in",
  "auth.sendLink": "Send reset link",
  "auth.savePassword": "Save new password",
  "auth.backToSignIn": "Back to sign in",
  "auth.privateAccess": "Private access",
  "auth.creativeSpace": "Your creative workspace",
  "auth.heroHeadline": "Smarter ideas.\nExceptional marketing.",
  "auth.heroDescription":
    "Create content, organize campaigns, and grow your brands with AI.",
  "auth.emailPlaceholder": "you@example.com",
  "auth.accessibility": "Private and secure access",
  "auth.unknownError": "Something went wrong. Please try again.",
  "auth.resetLinkSent":
    "If an account exists for this email, you'll receive a password reset link.",
  "auth.passwordMin": "Your password must be at least 12 characters.",
  "auth.passwordSaved": "Password updated successfully.",
  "auth.signInError": "We couldn't sign you in. Check your details and retry.",
  "language.interface": "Interface language",
  "language.conversation": "AI conversation language",
  "language.content": "Marketing content language",
  "language.explanation":
    "These settings are independent. Changing a preference affects new work only.",
  "language.saveError":
    "The language was saved on this device but couldn't be synced to your account.",
  "language.accountLoading": "Loading account preferences…",
  "language.accountError": "Account preferences could not be loaded.",
  "language.updateError": "Language preference could not be saved.",
  "language.interfaceSaved": "Interface language saved.",
  "language.conversationSaved": "Conversation language saved.",
  "language.contentSaved": "Marketing content language saved.",
  "language.choose": "Choose interface language",
  "language.settingsTitle": "Language preferences",
  "language.settingsHelp":
    "Choose the language for the interface, AI conversations, and new marketing content independently.",
  "language.saveConversation": "Save conversation language",
  "language.saveContent": "Save content language",
  "language.loadingBusiness": "Loading this business's language preference…",
  "language.noBusiness": "Select a business to set its content language.",
  "language.preferenceSaved": "Preference saved.",
  "language.preferenceError": "Preference could not be saved. Try again.",
  "settings.introTitle": "Settings",
  "settings.introEyebrow": "Your workspace",
  "settings.introDescription":
    "Manage your account, language preferences, and business connections.",
  "settings.accountTab": "Account",
  "settings.integrationsTab": "Integrations",
  "settings.accountTitle": "Account information",
  "settings.accountDescription":
    "Details associated with your current session.",
  "settings.displayName": "Display name",
  "settings.displayNamePlaceholder": "My account",
  "settings.displayNameHelp":
    "This name appears in your workspace. Maximum 80 characters.",
  "settings.displayNameRequired": "Enter a display name.",
  "settings.displayNameTooLong": "Name must be 80 characters or fewer.",
  "settings.displayNameSaved": "Display name updated.",
  "settings.displayNameSaveError": "Name couldn't be saved. Please try again.",
  "settings.email": "Email address",
  "settings.emailUnavailable": "Unavailable",
  "settings.profileNote":
    "Your profile name is private and is used only to personalize your account.",
  "settings.socialTitle": "Social accounts",
  "settings.socialDescription":
    "Connections and publishing are managed per business.",
  "settings.selectBusiness": "Select a business to continue.",
  "settings.noBusiness": "No business selected.",
  "settings.connectionsRestricted":
    "Your role can't manage social connections. Ask a business owner or admin.",
  "settings.integrationNavigation": "Settings sections",
  "usage.heygenTitle": "HeyGen generation allowance",
  "usage.heygenNote":
    "This is an operator-configured attempt limit, not a price or subscription balance.",
  "usage.loading": "Loading generation usage…",
  "usage.unavailable": "Generation usage could not be loaded.",
  "usage.unconfigured":
    "No allowance is configured. New video generation is unavailable; existing content and recovery remain available.",
  "usage.attempts": "{used} of {limit} generation attempts used",
  "usage.active": "{count} active generation jobs",
  "usage.remaining": "{count} attempts remaining",
  "usage.lifetime": "Lifetime allowance; it does not reset automatically.",
  "account.statusActive": "Workspace account active",
  "account.statusActiveHelp":
    "Account access and business permissions are available for this session.",
  "capability.available": "Available",
  "capability.unavailable": "Not available",
  "settings.featuresTitle": "Feature availability",
  "settings.facebookPublishing": "Facebook publishing",
  "settings.tiktokDirect": "TikTok direct publishing",
  "settings.tiktokManual": "TikTok manual export",
  "settings.instagramConnection": "Instagram connection",
  "settings.instagramPublishing": "Instagram publishing",
  "settings.miaAnalysis": "Mía analytics",
  "subscription.title": "Subscription information",
  "subscription.notice":
    "Subscription status will appear here when an authorized billing service is available.",
} as const;

type MessageKey = keyof typeof en;

const es: Record<MessageKey, string> = {
  "app.name": "AI Marketing Studio",
  "common.loading": "Cargando...",
  "common.retry": "Intentar de nuevo",
  "common.cancel": "Cancelar",
  "common.save": "Guardar cambios",
  "common.saving": "Guardando…",
  "common.account": "Cuenta",
  "common.business": "Negocio",
  "common.language": "Idioma",
  "common.english": "English",
  "common.spanish": "Español",
  "common.saved": "Guardado",
  "common.emailUnavailable": "Correo no disponible",
  "common.error": "Ocurrió un error. Inténtalo de nuevo.",
  "app.starting": "Iniciando tu espacio de trabajo…",
  "app.accessUnavailable": "Acceso al espacio no disponible",
  "app.accessRetry": "No se pudo verificar el acceso de tu cuenta o negocio.",
  "app.signOutAndRetry": "Cerrar sesión e intentar con otra cuenta",
  "app.accountNotProvisioned":
    "Esta cuenta no está autorizada actualmente para acceder al espacio.",
  "app.recovering": "Recuperación de cuenta",
  "app.createBusinessFirst":
    "Crea un negocio para comenzar a organizar tu marketing.",
  "app.accessRetrying": "Verificando acceso…",
  "agent.sofiaRole": "Estratega de marketing",
  "agent.leoRole": "Creador de contenido",
  "agent.unverified": "Sin verificar",
  "agent.generated": "Contenido generado",
  "agent.noActivity": "Sin actividad registrada",
  "agent.checkingActivity": "Consultando actividad…",
  "agent.activityFailed": "No se pudo consultar la actividad.",
  "agent.strategyUsed": "Estrategia utilizada en contenido generado por IA",
  "agent.aiDraftSaved": "Publicación creada por IA y guardada como borrador",
  "agent.noGenerations":
    "No hay generaciones de IA registradas para este negocio.",
  "team.eyebrow": "Planifica y crea",
  "team.title": "Tu equipo de marketing con IA",
  "team.description":
    "Sofía ayuda a definir la estrategia y Leo la convierte en contenido. Los resultados solo incluyen datos disponibles de las plataformas conectadas.",
  "team.roles": "Roles del equipo IA",
  "team.automation": "Automatización",
  "team.activity": "Actividad del Equipo IA",
  "drafts.loading": "Cargando borradores…",
  "dashboard.heroEyebrow": "Tu espacio creativo",
  "dashboard.hello": "Hola, {name}",
  "dashboard.intro":
    "Sigue tu trabajo y continúa con el siguiente paso de tu marketing.",
  "dashboard.create": "Crear contenido",
  "dashboard.preparing": "Preparando contenido…",
  "dashboard.workflow": "Flujo de trabajo",
  "dashboard.stepCreate": "Crea",
  "dashboard.stepReview": "Revisa",
  "dashboard.stepApprove": "Aprueba y publica",
  "dashboard.stepResults": "Analiza",
  "dashboard.businessActivity": "Actividad del negocio",
  "dashboard.activeCampaigns": "Campañas activas",
  "dashboard.thisBusiness": "De este negocio",
  "dashboard.library": "Contenido en biblioteca",
  "dashboard.draftsHistory": "Borradores e historial",
  "dashboard.pendingReview": "Por revisar",
  "dashboard.awaitingApproval": "Esperando tu aprobación",
  "dashboard.awaitingAdmin": "Esperando a un propietario o administrador",
  "dashboard.uniqueViewers": "Espectadores únicos",
  "dashboard.unavailableMetrics": "{count} publicaciones sin dato disponible",
  "dashboard.facebookMetrics": "Métricas disponibles de Facebook",
  "dashboard.plan": "Planifica",
  "dashboard.campaigns": "Campañas",
  "dashboard.viewCampaigns": "Ver campañas",
  "dashboard.loadingCampaigns": "Cargando campañas…",
  "dashboard.campaignsLoadError": "No se pudieron cargar las campañas.",
  "dashboard.campaignStatus.active": "Activa",
  "dashboard.campaignStatus.paused": "Pausada",
  "dashboard.campaignStatus.completed": "Completada",
  "dashboard.campaignStatus.archived": "Archivada",
  "dashboard.campaignStatus.draft": "Borrador",
  "dashboard.postsPublished":
    "{published} de {total} piezas publicadas · {progress}%",
  "dashboard.firstCampaign": "Tu primera campaña empieza aquí",
  "dashboard.campaignHelp":
    "Define un objetivo y organiza el contenido de tu negocio. Las campañas son opcionales.",
  "dashboard.createCampaign": "Crear campaña",
  "dashboard.review": "Revisión",
  "dashboard.needsAttention": "Necesitan tu atención",
  "dashboard.reviewDraft": "Revisar",
  "dashboard.approving": "Aprobando…",
  "dashboard.approve": "Aprobar",
  "dashboard.reject": "Rechazar",
  "dashboard.noPending": "No hay elementos por revisar",
  "dashboard.inboxCurrent": "Tu bandeja de revisión está al día.",
  "dashboard.openReview": "Abrir revisión",
  "dashboard.published": "Publicado",
  "dashboard.recentActivity": "Actividad reciente",
  "dashboard.viewContent": "Ver contenido",
  "dashboard.publishedLabel": "Publicado",
  "dashboard.noPublications": "Las publicaciones confirmadas aparecerán aquí.",
  "dashboard.team": "Tu equipo de IA",
  "dashboard.teamActivity": "Roles y actividad",
  "dashboard.openTeam": "Ir al equipo IA",
  "content.loading": "Cargando contenido…",
  "content.metricsLoading": "Cargando…",
  "content.introEyebrow": "Crea y organiza",
  "content.title": "Biblioteca de contenido",
  "content.description":
    "Encuentra borradores, revisa su estado y consulta publicaciones.",
  "content.itemCount": "{count} {item}",
  "content.itemSingular": "pieza",
  "content.itemPlural": "piezas",
  "content.searchAndFilter": "Buscar y filtrar contenido",
  "content.searchLabel": "Buscar contenido",
  "content.searchPlaceholder": "Buscar por título, texto o plataforma",
  "content.statusFilter": "Estado",
  "content.filter.all": "Todo el contenido",
  "content.filter.pending": "Pendiente",
  "content.filter.approved": "Aprobado",
  "content.filter.published": "Publicado",
  "content.filter.rejected": "Rechazado",
  "content.emptyResults": "No hay resultados",
  "content.emptyLibrary": "Tu biblioteca está lista",
  "content.refineSearch":
    "Prueba con otros términos o cambia el filtro de estado.",
  "content.libraryEmpty":
    "El contenido creado y publicado para este negocio aparecerá aquí.",
  "content.previewOf": "Vista previa de {title}",
  "content.previewLoading": "Cargando vista previa…",
  "content.preview": "Ver vista previa",
  "content.createdWithAI": "Creado con IA",
  "content.createdManually": "Creado manualmente",
  "content.refreshMetrics": "Actualizar métricas",
  "content.viewMetrics": "Ver métricas",
  "content.facebookMetrics": "Métricas de Facebook",
  "content.reactions": "reacciones",
  "content.comments": "comentarios",
  "content.shares": "compartidos",
  "content.openPost": "Abrir publicación",
  "content.analyticsError": "No se pudieron cargar las métricas de Facebook.",
  "content.previewError": "No se pudo cargar la vista previa.",
  "content.statusLabel.published": "Publicado",
  "content.statusLabel.approved": "Aprobado",
  "content.statusLabel.rejected": "Rechazado",
  "content.statusLabel.pending": "Pendiente de revisión",
  "analytics.loading": "Cargando contenido…",
  "analytics.eyebrow": "Mide lo que importa",
  "analytics.title": "Resultados",
  "analytics.description":
    "Resultados disponibles de las publicaciones de este negocio.",
  "analytics.refreshing": "Actualizando…",
  "analytics.refreshMetrics": "Actualizar métricas",
  "analytics.sourceNote":
    "Los datos disponibles aquí son métricas de Facebook. No se muestran tendencias ni métricas de TikTok en esta vista.",
  "analytics.querying": "Consultando métricas de Facebook…",
  "analytics.loadError": "No se pudieron procesar las analíticas.",
  "analytics.facebookMetrics": "Métricas de Facebook",
  "analytics.confirmedPosts": "Publicaciones confirmadas",
  "analytics.facebookHistory": "Historial de Facebook",
  "analytics.reactions": "Reacciones",
  "analytics.comments": "Comentarios",
  "analytics.shares": "Compartidos",
  "analytics.accessibleTotal": "Total de datos accesibles",
  "analytics.noData": "Sin datos disponibles",
  "analytics.unavailableOne":
    "{count} publicación no tiene métricas disponibles. Puede deberse a restricciones de acceso o a que se eliminó en Facebook.",
  "analytics.unavailableMany":
    "{count} publicaciones no tienen métricas disponibles. Puede deberse a restricciones de acceso o a que se eliminaron en Facebook.",
  "analytics.detail": "Detalle",
  "analytics.postsAnalyzed": "Publicaciones analizadas",
  "analytics.withData": "{count} con datos",
  "analytics.noFacebookPosts": "Aún no hay publicaciones de Facebook",
  "analytics.postsWillAppear":
    "Las métricas aparecerán cuando haya publicaciones confirmadas.",
  "analytics.noAvailableMetrics": "No hay métricas disponibles",
  "analytics.postsNoMetrics":
    "Hay {count} publicaciones confirmadas, pero Facebook no devolvió datos accesibles.",
  "analytics.viewPost": "Ver publicación",
  "sofia.title": "Habla con Sofía",
  "sofia.description": "Tu estratega de marketing con inteligencia artificial.",
  "sofia.currentConversation": "CONVERSACIÓN ACTUAL",
  "sofia.currentTitle": "Conversación actual",
  "sofia.newConversationTitle": "Nueva conversación",
  "sofia.active": "Activa",
  "sofia.notStarted": "Sin iniciar",
  "sofia.newConversation": "Nueva conversación",
  "sofia.history": "Historial",
  "sofia.previousConversations": "Conversaciones anteriores",
  "sofia.noConversations": "Todavía no hay conversaciones guardadas.",
  "sofia.current": "Actual",
  "sofia.messages": "Mensajes de la conversación con Sofía",
  "sofia.loadingConversation": "Cargando conversación…",
  "sofia.greeting":
    "¡Hola! Soy Sofía. Cuéntame qué producto quieres promocionar o qué idea tienes para tu negocio.",
  "sofia.you": "Tú",
  "sofia.thinking": "Sofía está preparando una respuesta…",
  "sofia.retryMessage": "Reintentar mensaje",
  "sofia.retryDraft": "Reintentar borrador",
  "sofia.retryLoad": "Reintentar carga",
  "sofia.messageLabel": "Mensaje para Sofía",
  "sofia.loadingPlaceholder": "Cargando conversación…",
  "sofia.messagePlaceholder": "Escribe tu mensaje para Sofía…",
  "sofia.sending": "Enviando…",
  "sofia.send": "Enviar",
  "sofia.generating": "Sofía y Leo están trabajando…",
  "sofia.createDraft": "Crear borrador con Leo",
  "sofia.draftCreated":
    "Borrador creado: {title}. Puedes revisarlo en Aprobaciones.",
  "sofia.conversationLoadError": "No se pudo cargar la conversación.",
  "sofia.historyLoadError": "No se pudo actualizar el historial.",
  "sofia.contactError": "No se pudo contactar a Sofía.",
  "sofia.draftError": "No se pudo generar el borrador.",
  "sofia.dateUnavailable": "Fecha no disponible",
  "sofia.newCampaign": "Nueva campaña",
  "campaigns.noBusiness": "Selecciona un negocio para gestionar sus campañas.",
  "campaigns.eyebrow": "Planifica",
  "campaigns.title": "Campañas",
  "campaigns.description":
    "Define objetivos y organiza el contenido de tu negocio. Las campañas son opcionales.",
  "campaigns.new": "Nueva campaña",
  "campaigns.organization": "Organización del trabajo",
  "campaigns.planTitle": "Tu plan de marketing",
  "campaigns.planDescription":
    "Selecciona una campaña para consultar sus objetivos y progreso.",
  "campaigns.refresh": "Actualizar",
  "campaigns.loading": "Cargando campañas…",
  "campaigns.loadError":
    "No se pudieron cargar las campañas. Inténtalo de nuevo.",
  "campaigns.saveError": "No se pudo guardar la campaña.",
  "campaigns.emptyTitle": "Aún no hay campañas",
  "campaigns.emptyDescription":
    "Crea una para definir un objetivo y dar estructura a tu contenido.",
  "campaigns.edit": "Editar campaña",
  "campaigns.name": "Nombre",
  "campaigns.objective": "Objetivo",
  "campaigns.status": "Estado",
  "campaigns.startDate": "Fecha inicial (opcional)",
  "campaigns.endDate": "Fecha final (opcional)",
  "campaigns.saving": "Guardando…",
  "campaigns.save": "Guardar campaña",
  "campaigns.cancel": "Cancelar",
  "campaigns.deleting": "Eliminando…",
  "campaigns.delete": "Eliminar campaña",
  "campaigns.deleteConfirm":
    '¿Eliminar permanentemente la campaña "{name}"? Sus borradores, aprobaciones y publicaciones se conservarán sin asignar a una campaña.',
  "campaigns.deleted":
    "Campaña eliminada correctamente. Su contenido e historial se conservaron.",
  "campaigns.status.draft": "Borrador",
  "campaigns.status.active": "Activa",
  "campaigns.status.paused": "Pausada",
  "campaigns.status.completed": "Completada",
  "campaigns.status.archived": "Archivada",
  "campaigns.draftStatus.pending": "Pendiente de aprobación",
  "campaigns.draftStatus.approved": "Aprobado",
  "campaigns.draftStatus.rejected": "Rechazado",
  "campaigns.progressLabel": "Progreso de {name}",
  "campaigns.published": "{progress}% · {published} publicados de {total}",
  "campaigns.pendingRejected": "{pending} pendientes · {rejected} rechazados",
  "campaigns.dateUnavailable": "Sin fecha",
  "campaigns.publishProgress": "Progreso de publicación",
  "campaigns.confirmedProgress":
    "Solo cuentan las publicaciones confirmadas en Facebook o TikTok, una vez por contenido. Aprobar, descargar o copiar no cuenta como publicar. Los rechazados siguen pendientes; los eliminados sin publicar se excluyen.",
  "campaigns.publishedCount": "{count} publicados",
  "campaigns.pendingCount": "{count} pendientes de publicación",
  "campaigns.rejectedCount": "{count} rechazados",
  "campaigns.associatedContent": "Contenido asociado",
  "campaigns.noCountableContent":
    "Esta campaña no tiene contenido contabilizable todavía.",
  "campaigns.postStatus.published": "Publicado",
  "campaigns.postStatus.pending": "Pendiente de publicación",
  "campaigns.deletedHistory": "Eliminado (historial conservado)",
  "campaigns.detach": "Desvincular",
  "campaigns.detachDraft": "Desvincular {title}",
  "campaigns.approvalLocation":
    "Gestiona las aprobaciones y publicaciones desde Aprobaciones. Para archivar esta campaña, cambia su estado en Editar campaña.",
  "campaigns.associateExisting": "Asociar contenido existente",
  "campaigns.selectUnassigned": "Selecciona contenido sin campaña",
  "campaigns.associate": "Asociar",
  "campaigns.noAvailableContent":
    "No hay contenido disponible sin campaña. Puedes crear contenido con Sofía y Leo o desvincularlo de otra campaña.",
  "businessForm.title": "Agregar negocio",
  "businessForm.description":
    "Cuéntanos sobre tu negocio para que el equipo IA pueda crear estrategias y contenido personalizado.",
  "businessForm.name": "Nombre del negocio",
  "businessForm.namePlaceholder": "Ej. Latitude Food Fusion",
  "businessForm.industry": "Tipo de negocio",
  "businessForm.industryPlaceholder":
    "Ej. Restaurante, entretenimiento, tienda online",
  "businessForm.descriptionLabel": "Descripción",
  "businessForm.descriptionPlaceholder":
    "Describe tu negocio y lo que lo hace especial",
  "businessForm.products": "Productos o servicios",
  "businessForm.productsPlaceholder":
    "Ej. Platos especiales, servicios o líneas de productos",
  "businessForm.audience": "Público objetivo",
  "businessForm.audiencePlaceholder": "¿A qué tipo de clientes quieres llegar?",
  "businessForm.area": "Zona de servicio",
  "businessForm.areaPlaceholder": "Ej. Richmond, Virginia",
  "businessForm.voice": "Estilo de comunicación",
  "businessForm.voicePlaceholder": "Ej. Familiar, alegre, profesional",
  "businessForm.website": "Sitio web",
  "businessForm.goals": "Objetivos de marketing",
  "businessForm.goalsPlaceholder":
    "Ej. Aumentar pedidos, conseguir reservas, atraer clientes",
  "businessForm.platforms": "Redes sociales preferidas",
  "businessForm.platformsPlaceholder": "Ej. Instagram, Facebook, TikTok",
  "businessForm.frequency": "Frecuencia de publicaciones",
  "businessForm.chooseFrequency": "Seleccionar frecuencia",
  "businessForm.frequency.daily": "Todos los días",
  "businessForm.frequency.five": "5 veces por semana",
  "businessForm.frequency.three": "3 veces por semana",
  "businessForm.frequency.weekly": "Una vez por semana",
  "businessForm.frequency.manual": "Según sea necesario",
  "businessForm.saveError":
    "No se pudo guardar el negocio. Inténtalo de nuevo.",
  "businessForm.cancel": "Cancelar",
  "businessForm.saving": "Guardando…",
  "businessForm.save": "Guardar negocio",
  "facebook.eyebrow": "Redes sociales",
  "facebook.title": "Conexión con Facebook",
  "facebook.description":
    "Vincula una página de Facebook para publicar contenido desde AI Marketing Studio.",
  "facebook.selectPage": "Seleccionar página",
  "facebook.settings": "Configuración",
  "facebook.manageTitle": "Administra tus publicaciones desde un solo lugar",
  "facebook.manageDescription":
    "Autoriza tu cuenta de Facebook y selecciona la página que deseas administrar.",
  "facebook.connect": "Conectar Facebook",
  "facebook.reconnect": "Reconectar Facebook",
  "facebook.processing": "Procesando conexión…",
  "facebook.connected": "Conectada",
  "facebook.verifyError": "No se pudo verificar la conexión de Facebook.",
  "facebook.startError": "No se pudo iniciar la conexión con Facebook.",
  "facebook.pagesError": "No se pudieron recuperar las páginas de Facebook.",
  "facebook.wrongBusiness":
    "Selecciona el negocio correcto antes de continuar.",
  "facebook.selectPageError": "No se pudo conectar la página seleccionada.",
  "facebook.connectedPage": "Página conectada: {name}",
  "facebook.loading": "Procesando conexión…",
  "facebook.choosePageTitle": "Selecciona una página",
  "facebook.choosePageDescription":
    "Elige la página que deseas conectar con este negocio.",
  "instagram.title": "Conexión con Instagram",
  "instagram.description":
    "Autoriza la cuenta profesional vinculada a la página de Facebook de este negocio.",
  "instagram.connectionOnly":
    "La conexión con Instagram está disponible para configurar y verificar la cuenta. Actualmente no se admite publicar en Instagram.",
  "instagram.account": "Cuenta de Instagram",
  "instagram.status.notConnected": "No conectada",
  "instagram.status.linked": "Vinculada · faltan permisos",
  "instagram.status.connected": "Conectada y autorizada",
  "instagram.status.reauthorize": "Requiere reconexión",
  "instagram.status.permission": "Permisos insuficientes",
  "instagram.status.discovery": "No se pudo verificar",
  "instagram.callback.connected":
    "Instagram quedó conectado y autorizado por Meta.",
  "instagram.callback.linked":
    "La cuenta está vinculada, pero falta el permiso para publicar. Revisa Meta y vuelve a conectar.",
  "instagram.callback.notConnected":
    "La página autorizada no devolvió una cuenta profesional de Instagram vinculada.",
  "instagram.callback.reauthorize":
    "Meta requiere una nueva autorización. Revisa los permisos e inténtalo otra vez.",
  "instagram.callback.permission":
    "Meta no concedió todos los permisos solicitados. Revisa la configuración de Instagram Login.",
  "instagram.callback.discovery":
    "Meta no permitió verificar la página y la cuenta de Instagram. Revisa el acceso a la página.",
  "instagram.callback.invalid":
    "La solicitud de conexión expiró o ya se utilizó. Inicia una conexión nueva.",
  "instagram.callback.declined": "No se completó la autorización de Instagram.",
  "instagram.callback.received": "Se recibió la respuesta de Meta.",
  "instagram.verifyError": "No se pudo verificar la conexión de Instagram.",
  "instagram.connectError": "No se pudo iniciar la conexión con Instagram.",
  "instagram.status.loading": "Verificando",
  "instagram.page": "Página asociada: {name}",
  "instagram.missingPermissions": "Permisos pendientes: {permissions}",
  "instagram.opening": "Abriendo Meta…",
  "instagram.connect": "Conectar Instagram",
  "instagram.reconnect": "Reconectar Instagram",
  "instagram.loading": "Verificando el estado guardado de Instagram…",
  "instagram.retry": "Reintentar verificación",
  "instagram.noBusiness": "Selecciona un negocio para administrar Instagram.",
  "tiktok.eyebrow": "Redes sociales",
  "tiktok.title": "Conexión con TikTok",
  "tiktok.description":
    "Autoriza TikTok para este negocio y revisa el estado de la cuenta conectada.",
  "tiktok.manualOnly":
    "La publicación en TikTok es únicamente mediante exportación manual. Conectar una cuenta no publica contenido desde esta aplicación.",
  "tiktok.connectedStatus": "Conectada",
  "tiktok.reviewAccess": "Revisar acceso",
  "tiktok.notConnected": "No conectada",
  "tiktok.checking": "Verificando",
  "tiktok.available": "La autorización de TikTok está disponible",
  "tiktok.eligibility":
    "La publicación depende de los permisos concedidos y de la elegibilidad de la cuenta. La conexión no garantiza que TikTok acepte cada publicación.",
  "tiktok.connect": "Conectar TikTok",
  "tiktok.reconnect": "Reconectar TikTok",
  "tiktok.loading": "Verificando el estado de TikTok…",
  "tiktok.verified": "Se verificó la cuenta de TikTok para este negocio.",
  "tiktok.wrongBusiness":
    "Verifica que hayas seleccionado el negocio correcto.",
  "tiktok.verifyError":
    "No se pudo verificar la conexión de TikTok. Inténtalo de nuevo.",
  "tiktok.connectError": "No se pudo iniciar TikTok.",
  "tiktok.account": "Cuenta de TikTok",
  "tiktok.status": "Estado: {status}",
  "tiktok.unverified": "sin verificar",
  "tiktok.retry": "Reintentar verificación",
  "approval.eyebrow": "Revisa antes de publicar",
  "approval.title": "Contenido y aprobaciones",
  "approval.description":
    "Aprueba el contenido antes de iniciar una publicación.",
  "approval.pendingCount": "{count} pendientes",
  "approval.status.pending": "Pendiente de aprobación",
  "approval.status.approved": "Aprobado",
  "approval.status.rejected": "Rechazado",
  "approval.caption": "Texto de la publicación",
  "approval.actions": "Acciones para {title}",
  "approval.destinationOptional": "Destino de publicación (opcional):",
  "approval.manualDestination":
    "Deja Facebook sin seleccionar para aprobarlo para uso manual. TikTok solo permite exportación manual; Instagram no admite publicaciones.",
  "approval.approving": "Aprobando…",
  "approval.approve": "✓ Aprobar",
  "approval.processing": "Procesando…",
  "approval.reject": "Rechazar",
  "approval.edit": "Editar",
  "approval.finalApproved": "✓ Aprobado",
  "approval.finalRejected": "✕ Rechazado",
  "approval.confirmVideo":
    "¿Enviar este video y su descripción a Facebook? Puede tardar unos minutos.",
  "approval.confirmImage":
    "¿Publicar esta imagen y su descripción en Facebook?",
  "approval.confirmText": "¿Publicar este texto en Facebook?",
  "approval.publishing": "Publicando…",
  "approval.publishFacebook": "Publicar en Facebook",
  "approval.publishedFacebook": "✓ Publicado en Facebook",
  "approval.publishingStatus":
    "La publicación está en proceso. Actualiza para verificar su estado.",
  "approval.needsReview":
    "Publicación por verificar. Revisa Facebook antes de volver a intentar.",
  "approval.verifyFacebook": "Verificar publicación en Facebook",
  "approval.downloading": "Descargando video…",
  "approval.downloadTikTok": "⬇ Descargar video para TikTok",
  "approval.captionCopied": "✓ Descripción copiada",
  "approval.copyCaption": "Copiar descripción y hashtags",
  "approval.deleting": "Eliminando…",
  "approval.delete": "Eliminar",
  "approval.empty": "Todavía no hay borradores para revisar.",
  "draftEdit.title": "Título",
  "draftEdit.caption": "Texto de la publicación",
  "draftEdit.saving": "Guardando…",
  "draftEdit.save": "Guardar cambios",
  "draftEdit.cancel": "Cancelar",
  "media.ariaLabel": "Multimedia y herramientas para el borrador",
  "media.videoAssets": "Multimedia del video",
  "media.postImage": "Imagen de la publicación",
  "media.imageGenerating":
    "La imagen se está generando. Esto puede tardar unos minutos.",
  "media.imageFailed": "La generación anterior no se completó.",
  "media.imageReady": "La imagen está guardada y lista para visualizar.",
  "media.imageFor": "Imagen para {title}",
  "media.generatingImage": "Generando imagen…",
  "media.retryImage": "Reintentar imagen",
  "media.createImage": "✦ Generar imagen",
  "media.loadingImage": "Cargando imagen…",
  "media.refreshPreview": "Actualizar vista previa",
  "media.viewImage": "Ver imagen",
  "media.videoPost": "Video de la publicación",
  "media.loadingVideo": "Cargando video…",
  "media.closeVideo": "Cerrar video",
  "media.viewVideo": "🎬 Ver video",
  "media.videoUnsupported": "Tu navegador no admite la reproducción de video.",
  "media.heygenScript": "🎬 Guion para HeyGen",
  "media.copied": "✓ Copiado",
  "media.copyScript": "Copiar guion",
  "media.closeHeygen": "Cerrar generación de video",
  "media.createHeygen": "Crear o recuperar video con HeyGen",
  "media.closeUpload": "Cerrar carga de video",
  "media.uploadVideo": "🎬 Subir video MP4",
  "media.noImagePrompt":
    "Este borrador no tiene una descripción de imagen generada por IA.",
  "media.imageEditor": "✦ Editar imagen con IA",
  "media.imageInstructions":
    "Describe los cambios que deseas. La imagen original se conservará hasta que aceptes una versión nueva.",
  "media.revisionReady": "Versión nueva lista para revisar",
  "media.original": "Original",
  "media.viewOriginal": "Ver original",
  "media.newVersion": "Versión nueva",
  "media.noPreview": "No se recibió una vista previa. Actualiza el estado.",
  "media.acceptRevision": "✓ Aceptar nueva versión",
  "media.keepOriginal": "Conservar original",
  "media.revisionGenerating":
    "La nueva imagen se está generando. No solicites otra hasta confirmar el resultado.",
  "media.instructionsLabel": "Instrucciones para la IA",
  "media.instructionsPlaceholder":
    "Ejemplo: Mejora la iluminación y cambia el fondo por una mesa elegante.",
  "media.suggestion.lighting": "Mejorar iluminación",
  "media.suggestion.background": "Cambiar el fondo",
  "media.suggestion.professional": "Estilo más profesional",
  "media.generatingRevision": "Generando nueva versión…",
  "media.generateRevision": "✦ Generar nueva versión",
  "media.costNotice":
    "La generación con IA puede tener un costo adicional. Se solicitará confirmación antes de continuar.",
  "media.refreshStatus": "Actualizar estado",
  "heygen.title": "Crear video con HeyGen",
  "heygen.loadingVideo": "Cargando video…",
  "heygen.loadingAvatars": "Cargando avatares…",
  "heygen.noAvatars": "No hay avatares disponibles con estos filtros.",
  "heygen.selectAvatar": "Selecciona un avatar",
  "heygen.loadingMoreAvatars": "Cargando…",
  "heygen.loadMoreAvatars": "Cargar más avatares",
  "heygen.loadingVoices": "Cargando voces…",
  "heygen.noVoices": "No hay voces disponibles con estos filtros.",
  "heygen.selectVoice": "Selecciona una voz",
  "heygen.loadingMoreVoices": "Cargando…",
  "heygen.loadMoreVoices": "Cargar más voces",
  "heygen.progress.submitting": "Enviando solicitud a HeyGen…",
  "heygen.progress.checking": "Consultando el estado guardado…",
  "heygen.progress.recovering": "Enviando y confirmando la solicitud…",
  "heygen.progress.processing": "HeyGen está generando el video…",
  "heygen.progress.storing": "Guardando el video en almacenamiento privado…",
  "heygen.status.uncertain":
    "No sabemos si HeyGen recibió la solicitud. Recupera el estado antes de solicitar otro video.",
  "heygen.status.failed":
    "HeyGen no pudo generar el video. Revisa los datos antes de autorizar una nueva generación.",
  "heygen.status.stored":
    "Video guardado de forma privada. Puedes verlo antes de aprobar el contenido.",
  "heygen.status.storageFailed":
    "El video no se pudo adjuntar. El borrador puede haber cambiado. Contacta al administrador.",
  "heygen.status.completed":
    "El video está generado. Recupera el estado para completar su almacenamiento privado.",
  "heygen.status.processing":
    "HeyGen está procesando tu video. Puede tardar unos minutos.",
  "heygen.status.checked": "Revisa el guion y selecciona un avatar y una voz.",
  "heygen.status.checking": "Consultando el estado del video…",
  "heygen.previewError":
    "No se pudo abrir el video. Solicita una nueva vista previa.",
  "heygen.previewExpired":
    "La vista previa venció o no está disponible. Actualízala para volver a ver el video.",
  "heygen.recovering": "Consultando…",
  "heygen.recover": "Recuperar estado del video",
  "heygen.ariaLabel": "Generación de video con HeyGen",
  "heygen.configure":
    "Configura tu avatar, voz y guion antes de generar el video.",
  "heygen.script": "Guion del video",
  "heygen.scriptHelp":
    "Hasta 5.000 caracteres. El texto se conserva tal como lo escribas.",
  "heygen.formatNotice":
    "Video vertical · 1080p. HeyGen consume créditos de API. El costo exacto no está disponible aquí.",
  "heygen.generate": "Generar video con HeyGen",
  "heygen.confirmNotice":
    "Selecciona un avatar y una voz, y confirma antes de enviar la solicitud pagada.",
  "heygen.previewLoading": "Cargando video…",
  "heygen.previewRefresh": "Actualizar vista previa privada",
  "heygen.noAutoAction":
    "Generar un video no aprueba ni publica este contenido.",
  "heygen.confirmPaid":
    "¿Generar este video con HeyGen? Esta acción consume créditos de API y puede tener un costo. No se aprobará ni publicará automáticamente.",
  "heygen.busyOtherOperation":
    "Espera a que termine la otra operación del borrador antes de recuperar el video.",
  "heygen.closeAssets": "Cerrar recursos de HeyGen",
  "heygen.exploreAssets": "Explorar avatares y voces de HeyGen",
  "heygen.assetsTitle": "Seleccionar recursos de HeyGen",
  "heygen.assetsDescription":
    "Explora los recursos disponibles en la cuenta conectada. Esta selección no genera videos ni consume créditos.",
  "heygen.availability": "Disponibilidad",
  "heygen.myAvatars": "Mis avatares",
  "heygen.publicAvatars": "Avatares públicos",
  "heygen.avatarType": "Tipo de avatar",
  "heygen.retryAvatars": "Reintentar carga de avatares",
  "heygen.avatar": "Avatar",
  "heygen.selectedAvatar": "Avatar seleccionado",
  "heygen.avatarTypeLabel": "Tipo: {type} · ID: {id}",
  "heygen.defaultVoice": "Voz predeterminada: {id}",
  "heygen.supportedEngines": "Motores compatibles: {engines}",
  "heygen.avatarPreview": "Vista previa de {name}",
  "heygen.avatarType.all": "Todos los tipos",
  "heygen.avatarType.digitalTwin": "Gemelo digital",
  "heygen.avatarType.photo": "Avatar de foto",
  "heygen.avatarType.studio": "Avatar de estudio",
  "heygen.avatarLoadError": "No se pudieron cargar los avatares.",
  "heygen.voiceLoadError": "No se pudieron cargar las voces.",
  "heygen.voices": "Voces",
  "heygen.myVoices": "Voces de mi cuenta",
  "heygen.publicVoices": "Voces públicas",
  "heygen.retryVoices": "Reintentar carga de voces",
  "heygen.voice": "Voz",
  "heygen.defaultVoiceFor": "Voz predeterminada de {name}",
  "heygen.selectedVoice": "Voz seleccionada",
  "heygen.selectActiveAssets":
    "Selecciona un avatar disponible y una voz activa de la lista para continuar.",
  "heygen.selectedVoiceLabel": "Voz seleccionada: {name}",
  "videoUpload.title": "Subir video",
  "videoUpload.choosePrompt": "Selecciona tu video",
  "videoUpload.dropHelp":
    "Arrastra un archivo MP4 aquí o selecciónalo desde tu dispositivo.",
  "videoUpload.choose": "Elegir video",
  "videoUpload.none": "Ningún archivo seleccionado",
  "videoUpload.remove": "Quitar video seleccionado",
  "videoUpload.uploading": "Subiendo video…",
  "videoUpload.upload": "Subir video",
  "videoUpload.doNotClose":
    "Estamos subiendo tu video. No cierres esta página.",
  "videoUpload.mp4Only": "Solo se permiten archivos de video MP4.",
  "videoUpload.error": "No se pudo subir el video.",
  "media.confirmGenerate":
    "¿Generar una imagen con IA? Esta operación puede generar un cargo en la API de OpenAI.",
  "media.generationUncertain":
    "No se pudo confirmar la generación. Actualiza la página antes de intentar nuevamente.",
  "media.imageLoadError": "No se pudo cargar la imagen. Inténtalo nuevamente.",
  "media.revisionStatusError": "No se pudo consultar el estado de la edición.",
  "media.confirmRevision":
    "¿Crear una nueva imagen con IA? Esta solicitud puede generar un cargo adicional en OpenAI. La original se conservará.",
  "media.revisionUncertain":
    "No se pudo confirmar la generación. Consulta el estado antes de volver a intentarlo para evitar cargos duplicados.",
  "media.confirmAccept": "¿Usar la nueva versión para esta publicación?",
  "media.revisionDecisionError":
    "No se pudo confirmar el cambio. Actualiza la página y comprueba el resultado.",
  "media.captionCopyError": "No se pudo copiar la descripción.",
  "media.downloadError": "No se pudo descargar el video.",
  "media.scriptCopyError":
    "No se pudo copiar el guion. Selecciona el texto para copiarlo.",
  "media.videoPreviewError": "No se pudo cargar el video.",
  "approval.tiktokPublishError":
    "No se pudo confirmar la publicación en TikTok. Verifica el estado antes de intentar nuevamente.",
  "approval.facebookPublishError":
    "No se pudo confirmar la publicación. Revisa Facebook antes de intentar nuevamente.",
  "approval.tiktokVerifyError":
    "No se pudo verificar la publicación en TikTok. Inténtalo nuevamente más tarde.",
  "approval.facebookVerifyError":
    "No se pudo verificar el video. Inténtalo nuevamente más tarde.",
  "approval.approveError":
    "No se pudo aprobar el borrador. Inténtalo de nuevo.",
  "draft.deleteConfirm":
    "¿Eliminar este elemento de Aprobaciones? Las publicaciones ya realizadas en redes sociales no se eliminarán.",
  "draft.deleteError":
    "No se pudo eliminar el elemento. Si hay una operación en curso, espera a que termine e inténtalo de nuevo.",
  "draft.rejectConfirm":
    "¿Rechazar esta publicación? Se conservará en el historial.",
  "draft.rejectError": "No se pudo rechazar el borrador. Inténtalo de nuevo.",
  "draft.saveError": "No se pudo guardar el borrador. Inténtalo de nuevo.",
  "draft.generationError":
    "No se pudo generar el contenido. Inténtalo de nuevo.",
  "draft.requiredFields": "El título y el texto no pueden estar vacíos.",
  "nav.home": "Resumen",
  "nav.campaigns": "Campañas",
  "nav.content": "Contenido",
  "nav.aiTeam": "Equipo IA",
  "nav.approvals": "Aprobaciones",
  "nav.analytics": "Analíticas",
  "nav.settings": "Configuración",
  "nav.workspace": "Espacio de trabajo",
  "nav.main": "Navegación principal",
  "nav.open": "Abrir navegación principal",
  "nav.close": "Cerrar navegación",
  "nav.pendingApprovals": "{count} elementos por revisar",
  "nav.pendingReview": "{count} elementos por revisar",
  "shell.marketingStudio": "Estudio de marketing",
  "shell.selectBusiness": "Seleccionar negocio",
  "shell.noBusinesses": "Sin negocios",
  "shell.addBusiness": "Agregar negocio",
  "shell.accountMenu": "Abrir menú de {name}",
  "shell.myAccount": "Mi cuenta",
  "shell.workAccount": "Cuenta de trabajo",
  "shell.signOut": "Cerrar sesión",
  "shell.refreshAccess": "Actualizar acceso al espacio",
  "shell.permissionsUnavailable":
    "No se pudieron verificar los permisos del negocio.",
  "shell.retryPermissions": "Volver a verificar acceso",
  "business.loadError": "No se pudieron cargar los negocios.",
  "access.title": "Esta cuenta no puede acceder al espacio de trabajo",
  "access.body":
    "Inicia sesión con una cuenta autorizada o comunícate con el propietario del espacio.",
  "access.signOut": "Cerrar sesión",
  "auth.welcome": "Te damos la bienvenida",
  "auth.continue": "Inicia sesión para seguir creando grandes ideas.",
  "auth.recover": "Restablecer contraseña",
  "auth.recoverHelp": "Te enviaremos un enlace para recuperar el acceso.",
  "auth.newPassword": "Crear una nueva contraseña",
  "auth.newPasswordHelp": "Elige una contraseña nueva para tu cuenta.",
  "auth.email": "Correo electrónico",
  "auth.password": "Contraseña",
  "auth.passwordNew": "Nueva contraseña",
  "auth.forgot": "¿Olvidaste tu contraseña?",
  "auth.showPassword": "Mostrar contraseña",
  "auth.hidePassword": "Ocultar contraseña",
  "auth.processing": "Procesando…",
  "auth.signIn": "Iniciar sesión",
  "auth.sendLink": "Enviar enlace",
  "auth.savePassword": "Guardar nueva contraseña",
  "auth.backToSignIn": "Volver a iniciar sesión",
  "auth.privateAccess": "Acceso privado",
  "auth.creativeSpace": "Tu espacio creativo",
  "auth.heroHeadline": "Ideas inteligentes.\nMarketing extraordinario.",
  "auth.heroDescription":
    "Crea contenido, organiza campañas y haz crecer tus marcas con IA.",
  "auth.emailPlaceholder": "tu@correo.com",
  "auth.accessibility": "Acceso privado y seguro",
  "auth.unknownError": "Ocurrió un error. Inténtalo de nuevo.",
  "auth.resetLinkSent":
    "Si existe una cuenta con ese correo, recibirás un enlace para restablecer la contraseña.",
  "auth.passwordMin": "La contraseña debe tener al menos 12 caracteres.",
  "auth.passwordSaved": "La contraseña se actualizó correctamente.",
  "auth.signInError":
    "No se pudo iniciar sesión. Revisa tus datos e inténtalo de nuevo.",
  "language.interface": "Idioma de la interfaz",
  "language.conversation": "Idioma de las conversaciones con IA",
  "language.content": "Idioma del contenido de marketing",
  "language.explanation":
    "Estos ajustes son independientes. Los cambios solo afectan el contenido nuevo.",
  "language.saveError":
    "El idioma se guardó en este dispositivo, pero no se pudo sincronizar con tu cuenta.",
  "language.accountLoading": "Cargando preferencias de la cuenta…",
  "language.accountError":
    "No se pudieron cargar las preferencias de la cuenta.",
  "language.updateError": "No se pudo guardar la preferencia de idioma.",
  "language.interfaceSaved": "Se guardó el idioma de la interfaz.",
  "language.conversationSaved": "Se guardó el idioma de conversación.",
  "language.contentSaved": "Se guardó el idioma del contenido.",
  "language.choose": "Elegir idioma de la interfaz",
  "language.settingsTitle": "Preferencias de idioma",
  "language.settingsHelp":
    "Elige por separado el idioma de la interfaz, las conversaciones con IA y el contenido de marketing nuevo.",
  "language.saveConversation": "Guardar idioma de conversación",
  "language.saveContent": "Guardar idioma del contenido",
  "language.loadingBusiness": "Cargando la preferencia de idioma del negocio…",
  "language.noBusiness":
    "Selecciona un negocio para definir el idioma del contenido.",
  "language.preferenceSaved": "Preferencia guardada.",
  "language.preferenceError":
    "No se pudo guardar la preferencia. Inténtalo de nuevo.",
  "settings.introTitle": "Configuración",
  "settings.introEyebrow": "Tu espacio de trabajo",
  "settings.introDescription":
    "Administra tu cuenta, preferencias de idioma y conexiones del negocio.",
  "settings.accountTab": "Cuenta",
  "settings.integrationsTab": "Integraciones",
  "settings.accountTitle": "Información de la cuenta",
  "settings.accountDescription": "Datos asociados a tu sesión actual.",
  "settings.displayName": "Nombre para mostrar",
  "settings.displayNamePlaceholder": "Mi cuenta",
  "settings.displayNameHelp":
    "Este nombre aparece en tu espacio de trabajo. Máximo 80 caracteres.",
  "settings.displayNameRequired": "Escribe un nombre para mostrar.",
  "settings.displayNameTooLong":
    "El nombre no puede superar los 80 caracteres.",
  "settings.displayNameSaved": "Nombre para mostrar actualizado.",
  "settings.displayNameSaveError":
    "No se pudo guardar el nombre. Inténtalo de nuevo.",
  "settings.email": "Correo electrónico",
  "settings.emailUnavailable": "No disponible",
  "settings.profileNote":
    "Tu nombre de perfil es privado y solo se usa para personalizar tu cuenta.",
  "settings.socialTitle": "Cuentas sociales",
  "settings.socialDescription":
    "Las conexiones y publicaciones se administran por negocio.",
  "settings.selectBusiness": "Selecciona un negocio para continuar.",
  "settings.noBusiness": "No hay un negocio seleccionado.",
  "settings.connectionsRestricted":
    "Tu rol no puede administrar conexiones sociales. Pídele ayuda a un propietario o administrador.",
  "settings.integrationNavigation": "Secciones de configuración",
  "usage.heygenTitle": "Límite de generación de HeyGen",
  "usage.heygenNote":
    "Es un límite de intentos configurado por el operador, no un precio ni un saldo de suscripción.",
  "usage.loading": "Cargando uso de generación…",
  "usage.unavailable": "No se pudo cargar el uso de generación.",
  "usage.unconfigured":
    "No hay un límite configurado. No se pueden generar videos nuevos; el contenido existente y su recuperación siguen disponibles.",
  "usage.attempts": "{used} de {limit} intentos de generación utilizados",
  "usage.active": "{count} trabajos de generación activos",
  "usage.remaining": "{count} intentos restantes",
  "usage.lifetime": "Límite de por vida; no se restablece automáticamente.",
  "account.statusActive": "Cuenta del espacio de trabajo activa",
  "account.statusActiveHelp":
    "El acceso de la cuenta y los permisos de negocio están disponibles para esta sesión.",
  "capability.available": "Disponible",
  "capability.unavailable": "No disponible",
  "settings.featuresTitle": "Disponibilidad de funciones",
  "settings.facebookPublishing": "Publicación en Facebook",
  "settings.tiktokDirect": "Publicación directa en TikTok",
  "settings.tiktokManual": "Exportación manual para TikTok",
  "settings.instagramConnection": "Conexión con Instagram",
  "settings.instagramPublishing": "Publicación en Instagram",
  "settings.miaAnalysis": "Analítica de Mía",
  "subscription.title": "Información de suscripción",
  "subscription.notice":
    "El estado de suscripción aparecerá aquí cuando haya un servicio de facturación autorizado.",
};

export type Translate = (
  key: MessageKey,
  values?: Record<string, string | number>,
) => string;

type LocalizationContextValue = {
  locale: Language;
  setInterfaceLanguage: (language: Language) => Promise<void>;
  saveAccountPreferences: (
    preferences: Partial<AccountResponse["preferences"]>,
  ) => Promise<void>;
  t: Translate;
  account: AccountResponse | null;
  accountLoading: boolean;
  accountError: Error | null;
  preferenceError: boolean;
  refreshAccount: () => Promise<void>;
};

const deviceLanguageKey = "ai-marketing-studio:interface-language";
const userLanguageKey = (userId: string) =>
  `ai-marketing-studio:interface-language:${userId}`;

function storedLanguage(key: string): Language | null {
  try {
    const value = window.localStorage.getItem(key);
    return value === "en" || value === "es" ? value : null;
  } catch {
    return null;
  }
}

function saveLanguage(key: string, value: Language) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Account persistence remains authoritative when browser storage is unavailable.
  }
}

function formatMessage(
  message: string,
  values?: Record<string, string | number>,
) {
  if (!values) return message;
  return message.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key)
      ? String(values[key])
      : match,
  );
}

const defaultContext: LocalizationContextValue = {
  locale: "en",
  setInterfaceLanguage: async () => {},
  saveAccountPreferences: async () => {},
  t: (key, values) => formatMessage(en[key], values),
  account: null,
  accountLoading: false,
  accountError: null,
  preferenceError: false,
  refreshAccount: async () => {},
};

const LocalizationContext =
  createContext<LocalizationContextValue>(defaultContext);

export function LocalizationProvider({
  userId,
  children,
}: {
  userId: string | null;
  children: ReactNode;
}) {
  const [locale, setLocale] = useState<Language>(
    () => storedLanguage(deviceLanguageKey) ?? "en",
  );
  const [accountState, setAccountState] = useState<{
    userId: string;
    value: AccountResponse;
  } | null>(null);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [accountErrorState, setAccountErrorState] = useState<{
    userId: string;
    error: Error;
  } | null>(null);
  const [preferenceErrorState, setPreferenceErrorState] = useState<{
    userId: string;
    error: boolean;
  } | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const account =
    userId && accountState?.userId === userId ? accountState.value : null;
  const accountLoading = Boolean(userId) && loadedUserId !== userId;
  const accountError =
    userId && accountErrorState?.userId === userId
      ? accountErrorState.error
      : null;
  const preferenceError = Boolean(
    userId &&
    preferenceErrorState?.userId === userId &&
    preferenceErrorState.error,
  );

  const refreshAccount = useCallback(async () => {
    setRefreshVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    let active = true;
    if (!userId) return;
    getAccount()
      .then(async (result) => {
        if (!active) return;
        const explicitLanguage =
          storedLanguage(userLanguageKey(userId)) ??
          storedLanguage(deviceLanguageKey);
        const effectiveLanguage =
          explicitLanguage ?? result.preferences.interface_language;
        setAccountState({ userId, value: result });
        setAccountErrorState(null);
        setLocale(effectiveLanguage);
        saveLanguage(userLanguageKey(userId), effectiveLanguage);
        if (
          explicitLanguage &&
          explicitLanguage !== result.preferences.interface_language
        ) {
          try {
            await updateAccountPreferences({
              interface_language: explicitLanguage,
            });
          } catch {
            if (active) setPreferenceErrorState({ userId, error: true });
          }
        }
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setAccountErrorState({
          userId,
          error:
            cause instanceof Error
              ? cause
              : new Error("Account preferences could not be loaded."),
        });
      })
      .finally(() => {
        if (active) setLoadedUserId(userId);
      });

    return () => {
      active = false;
    };
  }, [userId, refreshVersion]);

  const saveAccountPreferences = useCallback(
    async (preferences: Partial<AccountResponse["preferences"]>) => {
      if (!userId) throw new Error("An authenticated account is required.");
      const updated = await updateAccountPreferences(preferences);
      setAccountState((current) =>
        current?.userId === userId
          ? {
              userId,
              value: { ...current.value, preferences: updated },
            }
          : current,
      );
    },
    [userId],
  );

  const setInterfaceLanguage = useCallback(
    async (language: Language) => {
      setLocale(language);
      saveLanguage(deviceLanguageKey, language);
      if (!userId) return;
      saveLanguage(userLanguageKey(userId), language);
      setPreferenceErrorState({ userId, error: false });
      try {
        await saveAccountPreferences({
          interface_language: language,
        });
      } catch {
        setPreferenceErrorState({ userId, error: true });
      }
    },
    [userId, saveAccountPreferences],
  );

  const t = useCallback<Translate>(
    (key, values) => formatMessage((locale === "es" ? es : en)[key], values),
    [locale],
  );

  const value = useMemo(
    () => ({
      locale,
      setInterfaceLanguage,
      saveAccountPreferences,
      t,
      account,
      accountLoading,
      accountError,
      preferenceError,
      refreshAccount,
    }),
    [
      locale,
      setInterfaceLanguage,
      saveAccountPreferences,
      t,
      account,
      accountLoading,
      accountError,
      preferenceError,
      refreshAccount,
    ],
  );

  return (
    <LocalizationContext.Provider value={value}>
      {children}
    </LocalizationContext.Provider>
  );
}

export function useLocalization() {
  return useContext(LocalizationContext);
}

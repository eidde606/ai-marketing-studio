import {
  useCallback,
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
import {
  initializeDefaultLocalizationContext,
  LocalizationContext,
} from "./localizationContext";

const en = {
  "app.name": "AI Marketing Studio",
  "common.loading": "Loading...",
  "common.retry": "Try again",
  "common.refresh": "Refresh",
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
  "legal.navigation": "Legal and support",
  "legal.link.privacy": "Privacy",
  "legal.link.terms": "Terms",
  "legal.link.subscriptions": "Subscriptions",
  "legal.link.deletion": "Data deletion",
  "legal.link.contact": "Contact",
  "legal.language": "Page language",
  "legal.draftStatus": "Draft — not yet effective",
  "legal.draftNotice":
    "This page is a draft pending owner, operational, and legal review. It is not an effective policy.",
  "legal.contact.title": "Contact & Support",
  "legal.contact.intro":
    "Send a message to Nazbort Tech LLC about AI Marketing Studio. Do not include passwords, access tokens, or payment-card details.",
  "legal.contact.name": "Full name",
  "legal.contact.email": "Email address",
  "legal.contact.category": "Inquiry category",
  "legal.contact.message": "Message",
  "legal.contact.submit": "Send message",
  "legal.contact.sending": "Sending…",
  "legal.contact.privacy":
    "Your message is sent to the configured support destination. The application does not save a separate copy. Support mailbox retention is controlled by its operator.",
  "legal.contact.success":
    "Your message was submitted. Please keep a copy for your records.",
  "legal.contact.error":
    "We couldn't send your message. Please try again later.",
  "legal.contact.unavailable":
    "Support email is not configured. Please try again later.",
  "legal.contact.rateLimited":
    "Too many requests. Please wait before sending another message.",
  "legal.contact.category.general": "General inquiries",
  "legal.contact.category.technical": "Technical support",
  "legal.contact.category.billing": "Billing and subscriptions",
  "legal.contact.category.privacy": "Privacy and data deletion",
  "legal.contact.category.problem": "Report a problem",
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
  "agent.miaRole": "Analytics specialist",
  "agent.available": "Available",
  "agent.planned": "Planned",
  "agent.miaPlanned": "Ready to interpret available Facebook metrics",
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
    "Sebastián helps shape the strategy, and Valeria turns it into content. Results only include data the connected platforms provide.",
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
    "Observed metrics come from Facebook published posts only. Instagram and TikTok analytics are not available. Edian's recommendations are AI suggestions, not observed results.",
  "analytics.querying": "Checking Facebook metrics…",
  "analytics.loadError": "Analytics could not be processed.",
  "analytics.providerError":
    "Facebook could not provide metrics right now. Please try refreshing in a moment.",
  "analytics.reauthorizationRequired":
    "Facebook authorization has expired. Reconnect the Page in Settings to refresh its metrics.",
  "analytics.permissionRequiredOne":
    "Facebook is missing permission to read engagement for {count} post. Review Page permissions in Settings.",
  "analytics.permissionRequiredMany":
    "Facebook is missing permission to read engagement for {count} posts. Review Page permissions in Settings.",
  "analytics.postUnavailableOne":
    "Facebook could not find this published post or does not provide engagement for it.",
  "analytics.postUnavailableMany":
    "Facebook could not find these published posts or does not provide engagement for them.",
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
  "analytics.edianEyebrow": "AI analytics specialist",
  "analytics.edianDescription":
    "Ask Edian to interpret the available Facebook metrics. This is a separate, quota-limited analysis and does not run when you open or refresh this page.",
  "analytics.edianAction": "Analyze with Edian",
  "analytics.edianLoading": "Edian is analyzing Facebook metrics…",
  "analytics.edianNoMetrics":
    "Facebook has no accessible engagement metrics for these published posts.",
  "analytics.integrationUnavailable":
    "Facebook metrics are currently unavailable. Instagram and TikTok analytics are not connected to this experience.",
  "analytics.interpretError":
    "Edian could not prepare recommendations. Please try again later.",
  "analytics.quotaError":
    "The Edian analysis allowance for this customer is exhausted.",
  "analytics.observed": "Observed Facebook metrics",
  "analytics.edianObservedPosts": "Based on {count} published posts",
  "analytics.edianMetricCoverage": "Available for {available} of {count} posts",
  "analytics.recommendations": "Edian recommendations",
  "analytics.actionTitle": "Turn insights into action",
  "analytics.actionDescription":
    "Bring these observed results to Sebastián and decide what to do next.",
  "analytics.discussWithSebastian": "Discuss with Sebastián",
  "analytics.strategyHandoffIntro":
    "Please review these Facebook metrics for this business. A dash means unavailable, not zero:",
  "analytics.strategyHandoffSummary": "Edian's observed summary: {summary}",
  "analytics.strategyHandoffRecommendations":
    "Edian's suggestions to review: {recommendations}",
  "analytics.strategyHandoffQuestion":
    "What next step would you recommend based only on these available results?",
  "analytics.cachedAnalysis":
    "These recommendations were reused because the underlying metrics have not changed.",
  "sofia.agentName": "Sebastián",
  "sofia.title": "Talk with Sebastián",
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
  "sofia.messages": "Messages with Sebastián",
  "sofia.loadingConversation": "Loading conversation…",
  "sofia.greeting":
    "Hi! I'm Sebastián. Tell me what product you'd like to promote or share an idea for your business.",
  "sofia.you": "You",
  "sofia.thinking": "Sebastián is preparing a response…",
  "sofia.retryMessage": "Retry message",
  "sofia.retryDraft": "Retry draft",
  "sofia.retryLoad": "Retry loading",
  "sofia.messageLabel": "Message for Sebastián",
  "sofia.loadingPlaceholder": "Loading conversation…",
  "sofia.messagePlaceholder": "Write a message to Sebastián…",
  "sofia.sending": "Sending…",
  "sofia.send": "Send",
  "sofia.generating": "Sebastián and Valeria are working…",
  "sofia.createDraft": "Create a draft with Valeria",
  "sofia.draftCreated":
    "Draft created: {title}. Review it in the Review section.",
  "sofia.conversationLoadError": "Conversation could not be loaded.",
  "sofia.historyLoadError": "Conversation history could not be refreshed.",
  "sofia.contactError": "Sebastián could not be reached.",
  "sofia.providerUnavailable":
    "Sebastián is temporarily unavailable. Please try again later.",
  "sofia.providerThrottled":
    "Sebastián is handling many requests right now. Please wait a moment and try again.",
  "sofia.requestLimited":
    "Too many requests were received. Please wait a moment before trying again.",
  "sofia.accessRequired":
    "AI access is not currently available for this workspace. Review your billing options.",
  "sofia.quotaTitle": "Sebastián's request allowance has been reached",
  "sofia.quotaUsage":
    "You've used {used} of {limit} Sebastián requests during your {period}.",
  "sofia.quotaChecking": "Checking your current usage…",
  "sofia.quotaUsageUnavailable":
    "Your request allowance is reached. Current usage details could not be loaded.",
  "sofia.trialPeriod": "14-day trial",
  "sofia.trialPeriodEnding": "14-day trial, ending {date}",
  "sofia.billingPeriod": "current billing period",
  "sofia.billingPeriodEnding": "current billing period, ending {date}",
  "sofia.valeriaAvailable":
    "Valeria has {remaining} content generations available to create a draft independently.",
  "sofia.viewPlans": "View plans",
  "sofia.continueWithValeria": "Continue with Valeria",
  "sofia.draftError":
    "Valeria couldn't create this draft. Please try again. If the problem persists, contact support.",
  "sofia.draftQuotaExceeded":
    "Valeria's content-generation allowance has been reached. Review billing for usage and renewal details.",
  "sofia.draftConversationMissing":
    "This conversation doesn't contain a brief for Valeria. Send Sebastián a message with the content you want, then try again.",
  "sofia.draftContextTooLarge":
    "This conversation has too much context to create a draft. Start a new conversation with a shorter brief and try again.",
  "sofia.draftRequestInvalid":
    "The draft request couldn't be validated. Try again; if the problem persists, contact support.",
  "sofia.draftProviderThrottled":
    "Valeria is handling many requests right now. Wait a moment, then retry.",
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
  "campaigns.refreshing": "Refreshing…",
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
  "campaigns.discardTitle": "Discard unsaved changes?",
  "campaigns.discardDescription":
    'Your changes to "{name}" will be lost. This cannot be undone.',
  "campaigns.discardConfirm": "Discard changes",
  "campaigns.deleting": "Deleting…",
  "campaigns.delete": "Delete campaign",
  "campaigns.deleteTitle": "Delete campaign?",
  "campaigns.deleteConfirm":
    'Only the campaign "{name}" will be deleted. Its content, approvals, history, and published posts will be kept without a campaign. No posts will be deleted.',
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
    "No unassigned content is available. You can create content with Sebastián and Valeria or remove it from another campaign.",
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
  "facebook.multiplePagesWarning":
    "Publishing requires exactly one Facebook Page connected to this business. Disconnect extra Pages and keep the intended Page connected.",
  "facebook.connect": "Connect Facebook",
  "facebook.reconnect": "Reconnect Facebook",
  "facebook.processing": "Connecting…",
  "facebook.connected": "Connected",
  "facebook.statusChecking": "Checking connection…",
  "facebook.statusDisconnected": "Not connected",
  "facebook.reauthorize": "Authorization required",
  "facebook.statusUnavailable": "Connection status unavailable",
  "facebook.retry": "Retry connection status",
  "facebook.noBusiness": "Select a business to manage Facebook.",
  "facebook.verifyError": "Facebook connection could not be verified.",
  "facebook.startError":
    "Facebook authorization could not be started. If the problem continues, ask an administrator to check the Meta connection setup.",
  "facebook.pagesError": "Facebook Pages could not be retrieved.",
  "facebook.wrongBusiness": "Select the correct business before continuing.",
  "facebook.handoffExpired":
    "This Facebook authorization expired or is no longer valid. Start the connection again.",
  "facebook.handoffSignIn":
    "Sign in to the account that started this Facebook connection.",
  "facebook.handoffAuthorization":
    "The account that started this connection must have permission to manage this business's social accounts.",
  "facebook.handoffBusinessUnavailable":
    "This Facebook connection belongs to a business unavailable to the current account. Sign in with the account that started the connection.",
  "facebook.handoffSignOut": "Sign out",
  "facebook.dismissResult": "Dismiss",
  "facebook.selectPageError": "The selected Page could not be connected.",
  "facebook.connectedPage": "Page connected: {name}",
  "facebook.loading": "Processing connection…",
  "facebook.choosePageTitle": "Choose a Page",
  "facebook.choosePageDescription":
    "Choose the Page you want to connect to this business.",
  "facebook.disconnect": "Disconnect",
  "facebook.disconnecting": "Disconnecting…",
  "facebook.disconnectConfirm":
    "Disconnect this Facebook Page from the selected business?",
  "facebook.disconnectDialogTitle": "Disconnect Facebook Page?",
  "facebook.disconnectDialogDescription":
    'This disconnects "{name}" from this business only. Its Instagram connection is stored separately and will remain, but it is linked through this Page. To revoke Meta access, remove AI Marketing Studio in your Meta account settings.',
  "facebook.confirmDisconnect": "Disconnect Page",
  "facebook.disconnected":
    "Facebook Page disconnected from this business. To revoke Meta access, remove AI Marketing Studio in your Meta account settings.",
  "facebook.disconnectError": "Facebook Page could not be disconnected.",
  "facebook.callbackDeclined": "Facebook authorization was not completed.",
  "facebook.callbackInvalid":
    "The Facebook connection request expired or was already used. Start again.",
  "facebook.callbackNoPages":
    "No eligible Facebook Pages were found for this account.",
  "facebook.callbackError":
    "Facebook could not complete the connection. Check the Page permissions and try again.",
  "instagram.title": "Connect Instagram",
  "instagram.description":
    "Connect a Facebook Page to this business first, then authorize its linked professional Instagram account.",
  "instagram.connectionOnly":
    "Instagram connection is available for account setup and verification. Publishing to Instagram is not currently supported.",
  "instagram.account": "Instagram account",
  "instagram.status.notConnected": "Not connected",
  "instagram.status.linked": "Linked · permissions missing",
  "instagram.status.connected": "Connected and authorized",
  "instagram.status.reauthorize": "Reauthorization required",
  "instagram.status.permission": "Insufficient permissions",
  "instagram.status.discovery": "Could not verify",
  "instagram.status.attention": "Action needed",
  "instagram.status.unavailable": "Connection status unavailable",
  "instagram.status.configuration": "Setup required",
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
  "instagram.facebookRequired":
    "Connect a Facebook Page to this business before connecting Instagram.",
  "instagram.facebookMultiplePages":
    "Keep exactly one Facebook Page connected to this business before connecting Instagram, so the linked account is unambiguous.",
  "instagram.configurationRequired":
    "Instagram connection setup is incomplete. Ask an administrator to check the Meta configuration.",
  "instagram.permissionHelp":
    "Meta has not granted all access needed to verify this account. Review the connection and try again.",
  "instagram.status.loading": "Checking…",
  "instagram.page": "Facebook Page: {name}",
  "instagram.opening": "Opening Meta…",
  "instagram.connect": "Connect Instagram",
  "instagram.reconnect": "Reconnect Instagram",
  "instagram.loading": "Checking saved Instagram connection…",
  "instagram.retry": "Retry verification",
  "instagram.noBusiness": "Select a business to manage Instagram.",
  "instagram.disconnect": "Disconnect",
  "instagram.disconnecting": "Disconnecting…",
  "instagram.disconnectConfirm":
    "Disconnect this Instagram account from the selected business?",
  "instagram.disconnectDialogTitle": "Disconnect Instagram account?",
  "instagram.disconnectDialogDescription":
    'This disconnects "{account}" from this business. The linked Facebook Page "{page}" will remain connected. To revoke Meta access, remove AI Marketing Studio in your Meta account settings.',
  "instagram.connectedPageFallback": "the connected Facebook Page",
  "instagram.confirmDisconnect": "Disconnect Instagram",
  "instagram.disconnected":
    "Instagram disconnected from this business. To revoke Meta access, remove AI Marketing Studio in your Meta account settings.",
  "instagram.disconnectError": "Instagram could not be disconnected.",
  "tiktok.eyebrow": "Social accounts",
  "tiktok.title": "Connect TikTok",
  "tiktok.description":
    "Authorize TikTok for this business and check the connected account status.",
  "tiktok.manualOnly":
    "Direct TikTok posting is disabled for this application. Use manual export until the required Content Posting API permissions and provider audit are in place.",
  "tiktok.directPublishingEnabled":
    "Direct TikTok publishing is enabled by this application's configuration, but account eligibility, permissions and provider approval still apply.",
  "tiktok.connectedStatus": "Connected",
  "tiktok.reviewAccess": "Review access",
  "tiktok.notConnected": "Not connected",
  "tiktok.statusUnavailable": "Connection status unavailable",
  "tiktok.authorizationIncomplete": "Authorization needs review",
  "tiktok.noBusiness": "Select a business to manage TikTok.",
  "tiktok.checking": "Checking…",
  "tiktok.connectionSetup":
    "Connection availability is checked when you authorize an account. Posting availability is shown separately.",
  "tiktok.eligibility":
    "Publishing depends on permissions and account eligibility. A connection does not guarantee TikTok will accept every post.",
  "tiktok.connect": "Connect TikTok",
  "tiktok.reconnect": "Reconnect TikTok",
  "tiktok.loading": "Checking TikTok status…",
  "tiktok.verified": "TikTok account verified for this business.",
  "tiktok.wrongBusiness": "Check that you selected the correct business.",
  "tiktok.verifyError": "TikTok connection could not be verified. Try again.",
  "tiktok.connectError":
    "TikTok authorization could not be started. If the problem continues, ask an administrator to check the TikTok connection setup.",
  "tiktok.account": "TikTok account",
  "tiktok.status": "Status: {status}",
  "tiktok.unverified": "unverified",
  "tiktok.retry": "Retry verification",
  "tiktok.reauthorize": "Authorization required",
  "tiktok.disconnect": "Disconnect",
  "tiktok.disconnecting": "Disconnecting…",
  "tiktok.disconnectConfirm":
    "Disconnect this TikTok account from the selected business?",
  "tiktok.disconnected":
    "TikTok disconnected from this business. To revoke access, remove AI Marketing Studio in your TikTok account settings.",
  "tiktok.disconnectError": "TikTok could not be disconnected.",
  "tiktok.callbackDeclined": "TikTok authorization was not completed.",
  "tiktok.callbackInvalid":
    "The TikTok connection request expired or was already used. Start again.",
  "tiktok.callbackError":
    "TikTok could not complete the connection. Check the app permissions and try again.",
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
    "Leave all destinations unchecked to approve for manual use. TikTok supports manual export only.",
  "approval.connectedFacebook": "Connected Page: {name}",
  "approval.connectedInstagram": "Connected Instagram: {username}",
  "approval.noPublishingAccounts":
    "Connect Facebook or an authorized Instagram professional account to enable direct publishing.",
  "approval.loadingConnections": "Checking connected publishing accounts…",
  "approval.instagramReason.textDraft":
    "This is a text draft. Instagram publishing requires an image draft.",
  "approval.instagramReason.videoDraft":
    "This is a video draft. Instagram image publishing requires an image draft.",
  "approval.instagramReason.imageNotStarted":
    "Image generation has not started. Generate an image before selecting Instagram.",
  "approval.instagramReason.imageGenerating":
    "Image generation is still in progress. Wait for it to finish before selecting Instagram.",
  "approval.instagramReason.imageFailed":
    "Image generation failed. Generate or retry the image before selecting Instagram.",
  "approval.instagramReason.imageMissing":
    "The completed image file is missing. Generate or attach an image first.",
  "approval.instagramReason.jpegOnly":
    "This image is {format}; Instagram requires a JPEG (.jpg or .jpeg).",
  "approval.instagramReason.unknownFormat": "not a recognized image format",
  "approval.instagramReason.captionTooLong":
    "This caption exceeds Instagram's 2,200-character limit.",
  "approval.facebookConnectionUnavailable":
    "The selected Facebook Page is no longer available. Refresh the connected accounts and try again.",
  "approval.instagramConnectionUnavailable":
    "The selected Instagram account is no longer available. Refresh the connected accounts and try again.",
  "approval.publishingAccountUnavailable":
    "The previously selected publishing account is not currently connected.",
  "approval.instagramMediaRequirements":
    "Instagram supports completed JPEG images up to 8 MB and captions up to 2,200 characters.",
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
  "approval.confirmInstagramImage":
    "Publish this approved JPEG image and caption to the connected Instagram account?",
  "approval.publishInstagram": "Publish to Instagram",
  "approval.retryInstagram": "Retry Instagram",
  "approval.publishedInstagram": "✓ Published to Instagram",
  "approval.viewInstagramPost": "View Instagram post",
  "approval.instagramRetrySafe":
    "Instagram confirmed this attempt did not publish. Retrying is safe.",
  "approval.instagramNeedsReview":
    "Instagram may have published this post. Check the account before taking further action.",
  "approval.instagramPublishError":
    "Instagram publishing did not complete. The saved platform status is shown below.",
  "approval.instagramStatusRefreshError":
    "Instagram's result could not be refreshed. Reload drafts before retrying.",
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
  "media.heygenScript": "🎬 AI video script",
  "media.copied": "✓ Copied",
  "media.copyScript": "Copy script",
  "media.closeHeygen": "Close video generation",
  "media.createHeygen": "Create or recover AI video",
  "media.closeUpload": "Close video upload",
  "media.uploadVideo": "🎬 Upload MP4 video",
  "media.openImageUpload": "Upload an image",
  "media.cancelImageUpload": "Close image upload",
  "media.imageUploadHelp":
    "Choose a JPEG, PNG, or WebP image. PNG and WebP files are converted to JPEG.",
  "media.uploadImage": "Upload image",
  "media.uploadingImage": "Uploading image…",
  "media.uploadImageProgress": "Preparing and uploading your image…",
  "media.imageUploadError": "Image could not be uploaded. Try again.",
  "media.imageTooLarge": "Image exceeds the 20 MB limit.",
  "media.reuseImage": "Choose an existing image",
  "media.cancelImageReuse": "Close image library",
  "media.existingImageHelp":
    "Images are available only from drafts in this business. A JPEG copy will be prepared for this draft.",
  "media.loadingReusableImages": "Loading this business's images…",
  "media.noReusableImages": "No completed images are available to reuse.",
  "media.useExistingImage": "Use this image",
  "media.reusingImage": "Preparing image…",
  "media.imageReuseError": "Existing images could not be loaded or reused.",
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
  "heygen.title": "AI Video Studio",
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
  "heygen.progress.submitting": "Submitting your video request…",
  "heygen.progress.checking": "Checking the saved status…",
  "heygen.progress.recovering": "Sending and confirming the request…",
  "heygen.progress.processing": "Your AI video is being generated…",
  "heygen.progress.storing": "Saving the video to private storage…",
  "heygen.status.uncertain":
    "The video service may have received this request. Check its status before requesting another video.",
  "heygen.status.failed":
    "The video could not be generated. Review the details before authorizing another generation.",
  "heygen.status.stored":
    "Video saved privately. Preview it before approving the content.",
  "heygen.status.storageFailed":
    "The video could not be attached. The draft may have changed. Contact an administrator.",
  "heygen.status.completed":
    "The video was generated. Recover its status to finish saving it privately.",
  "heygen.status.processing":
    "Your AI video is processing. This may take a few minutes.",
  "heygen.status.checked": "Review the script and select an avatar and voice.",
  "heygen.status.checking": "Checking video status…",
  "heygen.previewError": "Video could not be opened. Request a new preview.",
  "heygen.previewExpired":
    "The preview expired or is unavailable. Refresh it to view the video again.",
  "heygen.recovering": "Checking…",
  "heygen.recover": "Recover video status",
  "heygen.ariaLabel": "AI video generation",
  "heygen.configure":
    "Configure your avatar, voice, and script before generating a video.",
  "heygen.script": "Video script",
  "heygen.scriptHelp":
    "Up to 5,000 characters. Your text is preserved as written.",
  "heygen.formatNotice":
    "AI avatar videos are generated with HeyGen. Vertical video · 1080p. API credit usage and exact cost are not available here.",
  "heygen.generate": "Generate AI video",
  "heygen.confirmNotice":
    "Choose an avatar and voice. You will confirm before sending the paid request.",
  "heygen.previewLoading": "Loading video…",
  "heygen.previewRefresh": "Refresh private preview",
  "heygen.noAutoAction":
    "Generating a video does not approve or publish this content.",
  "heygen.confirmPaid":
    "Generate this AI video? This uses API credits and may incur a charge. It will not be approved or published automatically.",
  "heygen.busyOtherOperation":
    "Wait for the other draft operation to finish before recovering the video.",
  "heygen.closeAssets": "Close video assets",
  "heygen.exploreAssets": "Explore avatars and voices",
  "heygen.assetsTitle": "Select video assets",
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
    "Facebook publication could not be completed. Ensure exactly one Facebook Page is connected and that it has the required permissions before retrying.",
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
  "draft.generationContextTooLarge":
    "This business has too much saved context for content generation. Shorten its profile or recent drafts, then try again.",
  "draft.generationInvalidInput":
    "The generation request could not be validated. Check the selected business and try again.",
  "draft.generationQuotaExceeded":
    "Valeria's content-generation allowance has been used. Review your plan for the next available period.",
  "draft.generationAccessRequired":
    "Content generation is not available for this business plan. Review the available plans.",
  "draft.generationProviderThrottled":
    "The content provider is temporarily busy. Wait a moment and try again.",
  "draft.requiredFields": "Title and post text cannot be empty.",
  "nav.home": "Home",
  "nav.campaigns": "Campaigns",
  "nav.content": "Content",
  "nav.aiTeam": "AI team",
  "nav.approvals": "Review",
  "nav.analytics": "Results",
  "nav.billing": "Billing",
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
  "auth.createAccount": "Create account",
  "auth.createAccountHelp":
    "Create a secure account to set up your business workspace.",
  "auth.policyDisclosure":
    "Review these draft policies (not yet effective) before creating an account:",
  "auth.registerTrialHelp":
    "Create your account, then activate your workspace to start an eligible 14-day trial.",
  "auth.noAccount": "New to AI Marketing Studio?",
  "auth.trialAvailable": "Start a 14-day free trial. No credit card required.",
  "auth.trialUnavailable": "The 14-day free trial is currently unavailable.",
  "auth.registrationChecking": "Checking registration availability…",
  "auth.registrationOpen": "Registration is open.",
  "auth.registrationOpenNoTrial":
    "Account registration is open, but free trials are currently unavailable.",
  "auth.registrationUnavailable": "Registration is currently unavailable.",
  "auth.registrationCheckFailed":
    "We couldn't check registration status, so sign-up is unavailable right now.",
  "auth.accountCreated": "Your account is ready. Continue to your workspace.",
  "auth.verifyEmail":
    "Check your email to verify your address before signing in.",
  "auth.registrationError":
    "Account setup could not be completed. If you already have an account, sign in or reset your password.",
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
  "auth.continueWithGoogle": "Continue with Google",
  "auth.continueWithFacebook": "Continue with Facebook",
  "auth.continueWithApple": "Continue with Apple",
  "auth.socialSignIn": "Continue with a social account",
  "auth.connecting": "Connecting…",
  "auth.providerUnavailable":
    "Social sign-in is not configured or available for this account flow.",
  "auth.oauthSignInError":
    "Couldn't start {provider} sign-in. Please try again.",
  "auth.oauthCallbackError":
    "Provider sign-in could not be completed. Try again or use email and password.",
  "auth.googleSignInError": "Google sign-in could not be started. Try again.",
  "registration.provisioning": "Securing your new workspace…",
  "registration.provisioningFailed": "Your account could not be set up yet",
  "registration.provisioningHelp":
    "Check your connection and try again. Your sign-in is still secure.",
  "registration.verifyEmail":
    "Verify your email address, then sign in again to finish setting up your workspace.",
  "tutorial.title": "Product guide",
  "language.interface": "Interface language",
  "language.conversation": "AI conversation language",
  "language.content": "Marketing content language",
  "language.interfaceHelp":
    "Controls application navigation, labels, and interface text.",
  "language.conversationHelp":
    "Sets the language Sebastián and other AI assistants use when responding.",
  "language.contentHelp":
    "Sets the preferred language for new captions, scripts, and marketing content.",
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
  "language.saveInterface": "Save interface language",
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
  "settings.membershipRole": "Business role",
  "settings.role.owner": "Owner",
  "settings.role.admin": "Admin",
  "settings.role.member": "Member",
  "settings.businessProfile": "Business profile",
  "settings.businessProfileHelp":
    "Keep the information used for your marketing workspace up to date.",
  "settings.businessNameRequired": "Enter a business name.",
  "settings.businessEditRestricted":
    "Only owners and admins can edit this business.",
  "settings.businessSaveError": "Business information could not be saved.",
  "settings.businessSaved": "Business information saved.",
  "trial.loading": "Loading account status…",
  "trial.loadError": "Account status could not be loaded.",
  "trial.accountStatus": "Account access",
  "trial.operatorAccess": "Operator access",
  "trial.noTrial": "No trial or subscription is active for this workspace.",
  "trial.active": "Free trial",
  "trial.expired": "Trial ended",
  "trial.daysRemaining": "{count} days remaining in your trial.",
  "trial.expiredHelp":
    "Your content remains available. A subscription is required to resume AI generation and publishing.",
  "trial.generationsUsed": "Valeria generations used: {used} of {limit}.",
  "trial.sofiaUsed": "Sebastián requests used: {used} of {limit}.",
  "trial.heygenUsed": "AI video generations used: {used} of {limit}.",
  "trial.feature.leo": "Valeria generation",
  "trial.feature.sofia": "Sebastián requests",
  "trial.feature.facebook": "Facebook publishing",
  "trial.feature.heygen": "AI video generation",
  "trial.feature.image": "AI image generation and revisions",
  "trial.usageTitle": "Trial usage",
  "trial.featureTitle": "Included features",
  "trial.featureStatus.available": "Available",
  "trial.featureStatus.limited": "Limited",
  "trial.featureStatus.unavailable": "Unavailable",
  "trial.featureStatus.planned": "Planned",
  "trial.notIncluded": "Not included",
  "trial.feature.analytics": "Edian analytics",
  "trial.feature.campaigns": "Campaign creation",
  "trial.featureAvailable": "Available",
  "trial.featureUnavailable": "Unavailable",
  "trial.status.active": "An active subscription is recorded.",
  "trial.status.past_due": "Subscription access requires attention.",
  "trial.status.canceled": "This subscription has been canceled.",
  "trial.status.unavailable": "No subscription entitlement is available.",
  "trial.status.expired": "The trial has ended.",
  "trial.status.operator": "Operator access is granted.",
  "trial.status.trialing": "A trial is in progress.",
  "trial.subscriptionUnavailable":
    "Manage your subscription and payment method from the Billing page.",
  "billing.eyebrow": "Account",
  "billing.title": "Billing",
  "billing.description":
    "Review your trial, usage, and subscription for this workspace.",
  "billing.noBusiness": "Select a business workspace to view its billing.",
  "billing.loading": "Loading billing details…",
  "billing.loadError": "Billing details could not be loaded.",
  "billing.accountTitle": "Your subscription",
  "billing.accountHelp": "Your access is enforced by the server.",
  "billing.subscriptionStatus": "Status",
  "billing.daysRemaining": "Trial time remaining",
  "billing.days": "{count} days",
  "billing.trialEnds": "Trial ends",
  "billing.nextRenewal": "Current period ends",
  "billing.noCardTrial":
    "Your 14-day trial starts without a credit card. Add billing only when you choose to upgrade.",
  "billing.upgradeEyebrow": "One monthly plan",
  "billing.priceInCheckout": "Monthly price shown in secure checkout",
  "billing.planDescription":
    "Keep using your workspace and AI tools with a recurring monthly subscription.",
  "billing.upgrade": "Upgrade with Stripe",
  "billing.manageSubscription": "Manage or cancel subscription",
  "billing.noRefundCheckout":
    "All subscription payments are non-refundable, except where required by applicable law. Cancel to stop future renewals; cancellation does not refund a payment already processed.",
  "billing.subscriptionPolicy": "Read the Subscription & Cancellation Policy",
  "billing.portalCancellationNotice":
    "Cancellation is not complete until Stripe confirms the change and this page reflects the updated status.",
  "billing.openingCheckout": "Opening secure checkout…",
  "billing.openingPortal": "Opening billing portal…",
  "billing.adminOnly": "Only workspace owners and admins can manage billing.",
  "billing.notConfigured":
    "Secure billing is not configured in this environment.",
  "billing.operatorPlan": "This workspace has operator-granted access.",
  "billing.usageTitle": "Workspace usage",
  "billing.monthlyUsage": "Usage resets with the monthly billing period.",
  "billing.trialUsage": "Usage for this workspace's 14-day trial.",
  "billing.usage.businesses": "Business workspaces",
  "billing.usage.leo": "Valeria generations",
  "billing.usage.sofia": "Sebastián requests",
  "billing.usage.edian": "Edian analyses",
  "billing.usage.campaigns": "Campaigns",
  "billing.usage.heygen": "AI video generations",
  "billing.comingSoon":
    "Subscription checkout is not available yet. Continue using your workspace during the trial.",
  "billing.paymentFailed":
    "A subscription payment failed. AI usage is paused until billing is resolved; your saved data remains available.",
  "billing.cancelScheduled":
    "Stripe confirms cancellation for {date}. If the account remains in good standing, paid access remains available until the recorded period end.",
  "billing.checkoutReturn":
    "Checkout returned successfully. Subscription access updates after Stripe confirms the subscription.",
  "billing.portalReturn":
    "You returned from Stripe. Refresh billing details to confirm any subscription changes.",
  "billing.actionError":
    "The secure billing session could not be started. Try again.",
  "billing.notAvailable": "Not available",
  "billing.status.trialing": "14-day free trial",
  "billing.status.active": "Subscription active",
  "billing.status.past_due": "Payment needs attention",
  "billing.status.canceled": "Subscription canceled",
  "billing.status.expired": "Trial ended",
  "billing.status.operator": "Operator access",
  "billing.status.unavailable": "Billing unavailable",
  "onboarding.loading": "Loading your setup…",
  "onboarding.loadError":
    "Your saved setup could not be loaded. Refresh and retry.",
  "onboarding.retry": "Retry loading setup",
  "onboarding.saveError": "Your progress could not be saved. Try again.",
  "onboarding.activateError":
    "Your workspace could not be created. Your saved setup is still available.",
  "onboarding.stepCount": "Step {step} of {total}",
  "onboarding.step1Title": "Welcome to your workspace",
  "onboarding.step1Description":
    "Choose your interface and AI languages. You can change them later.",
  "onboarding.step2Title": "Tell us about your business",
  "onboarding.step2Description":
    "A few details help Sebastián and Valeria create more relevant work.",
  "onboarding.step3Title": "Choose your marketing goals",
  "onboarding.step3Description": "Select the outcomes you want to focus on.",
  "onboarding.step4Title": "Describe your audience and platforms",
  "onboarding.step4Description":
    "These details are optional and can be updated later.",
  "onboarding.step5Title": "Connect social accounts later",
  "onboarding.step5Description":
    "You can skip this step and connect accounts from Settings.",
  "onboarding.step6Title": "Review and create your workspace",
  "onboarding.step6Description": "Your workspace is private to your business.",
  "onboarding.goalsLegend": "Marketing goals",
  "onboarding.goalAwareness": "Increase awareness",
  "onboarding.goalProducts": "Promote products",
  "onboarding.goalLeads": "Generate leads",
  "onboarding.goalEngagement": "Increase engagement",
  "onboarding.goalServices": "Promote services",
  "onboarding.platformsLegend": "Platforms you may use",
  "onboarding.socialCapabilities":
    "Connect supported accounts later from Settings.",
  "onboarding.socialFacebook":
    "Facebook: supported publishing for connected Pages.",
  "onboarding.socialInstagram":
    "Instagram: connection is available; publishing is not yet supported.",
  "onboarding.socialTikTok":
    "TikTok: prepare content for manual export; direct publishing is not available.",
  "onboarding.socialSkipHelp":
    "No social accounts are connected during this setup.",
  "onboarding.skipSocial": "Skip for now",
  "onboarding.continue": "Continue",
  "onboarding.next": "Next",
  "onboarding.back": "Back",
  "onboarding.finish": "Create workspace",
  "onboarding.businessNameFallback": "Your business",
  "onboarding.trialDisclosure":
    "Trial access is only shown when server-side eligibility and trial controls are enabled. Billing is not available.",
  "tutorial.stepCount": "Step {step} of {total}",
  "tutorial.progress": "Product guide progress",
  "tutorial.welcomeTitle": "Welcome to your marketing workspace",
  "tutorial.welcomeBody":
    "Your dashboard brings planning, content, review, and results together. Take this short guide to see how each part works.",
  "tutorial.dashboardTitle": "Your dashboard and navigation",
  "tutorial.dashboardBody":
    "Use the dashboard to see your work. The sidebar takes you to campaigns, content, review, results, and settings.",
  "tutorial.sofiaTitle": "Sebastián plans your marketing",
  "tutorial.sofiaBody":
    "Sebastián helps clarify goals and prepare a structured brief. He does not publish content.",
  "tutorial.leoTitle": "Valeria creates content",
  "tutorial.leoBody":
    "Valeria turns approved direction into drafts such as captions and scripts. You review every draft before it can be published.",
  "tutorial.miaTitle": "Edian interprets Facebook engagement",
  "tutorial.miaBody":
    "Ask Edian to interpret available metrics from up to 10 confirmed Facebook posts. Instagram and TikTok analytics, historical trends, conversions, and revenue are not available. Recommendations are suggestions, not observed results.",
  "tutorial.creationTitle": "Quick Create",
  "tutorial.creationBody":
    "Use the dashboard action to start a short content request. Review the draft before approving or publishing it.",
  "tutorial.guidedTitle": "Guided creation with Sebastián",
  "tutorial.guidedBody":
    "Use Sebastián's planning conversation to clarify a goal and brief before asking Valeria to create a draft.",
  "tutorial.campaignTitle": "Campaigns are optional",
  "tutorial.campaignBody":
    "Create a campaign when you want to group work around an objective. You can also create content without a campaign.",
  "tutorial.reviewTitle": "Review before approval",
  "tutorial.reviewBody":
    "Check drafts in Review. Business permissions determine who can approve or publish.",
  "tutorial.publishingTitle": "Know the supported destinations",
  "tutorial.publishingBody":
    "Facebook Page publishing is supported. TikTok content is exported manually. Instagram can be connected, but publishing is not available.",
  "tutorial.trialTitle": "Usage and account settings",
  "tutorial.trialBody":
    "When enabled, trial dates and AI usage are enforced by the server. Subscription checkout is not available, and no payment details are collected.",
  "tutorial.skip": "Skip guide",
  "tutorial.saveAndExit": "Save and exit",
  "tutorial.back": "Back",
  "tutorial.next": "Next",
  "tutorial.finish": "Finish",
  "tutorial.resume": "Resume product guide",
  "tutorial.restart": "Restart guide",
  "tutorial.completeEyebrow": "Your next step",
  "tutorial.completeTitle": "You're ready to grow your business!",
  "tutorial.completeBody":
    "Explore your account options or head to the dashboard and put your plan into action.",
  "tutorial.explorePlans": "Explore subscription plans",
  "tutorial.continueDashboard": "Continue to dashboard",
  "tutorial.saveError": "Your guide completion could not be saved. Try again.",
  "tutorial.loadError": "Your saved guide progress could not be loaded.",
  "settings.socialTitle": "Social accounts",
  "settings.socialDescription":
    "Connections and publishing are managed per business.",
  "settings.selectBusiness": "Select a business to continue.",
  "settings.noBusiness": "No business selected.",
  "settings.connectionsRestricted":
    "Your role can't manage social connections. Ask a business owner or admin.",
  "settings.integrationNavigation": "Settings sections",
  "usage.heygenTitle": "AI Video Studio usage",
  "usage.heygenNote":
    "Video generation is provided by HeyGen. This is an operator-configured attempt limit, not a price or subscription balance.",
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
  "capability.limited": "Limited",
  "capability.planned": "Planned",
  "capability.unavailable": "Not available",
  "settings.featuresTitle": "Feature availability",
  "settings.facebookPublishing": "Facebook publishing",
  "settings.tiktokDirect": "TikTok direct publishing",
  "settings.tiktokManual": "TikTok manual export",
  "settings.instagramConnection": "Instagram connection",
  "settings.instagramPublishing": "Instagram publishing",
  "settings.miaAnalysis": "Edian analytics",
  "settings.facebookPublishingDetail":
    "Publish approved posts to connected Facebook Pages.",
  "settings.tiktokDirectDetail":
    "Direct publishing is not currently supported.",
  "settings.tiktokManualDetail":
    "Prepare and export content for manual posting.",
  "settings.instagramConnectionDetail":
    "Connect an account; connection does not enable publishing.",
  "settings.instagramPublishingDetail":
    "Instagram publishing is not currently supported.",
  "settings.miaAnalysisDetail":
    "Edian interprets available Facebook engagement metrics after you request an analysis. Instagram and TikTok analytics are unavailable.",
  "subscription.title": "Subscription information",
  "subscription.notice":
    "Subscription status will appear here when an authorized billing service is available.",
} as const;

type MessageKey = keyof typeof en;

const es: Record<MessageKey, string> = {
  "app.name": "AI Marketing Studio",
  "common.loading": "Cargando...",
  "common.retry": "Intentar de nuevo",
  "common.refresh": "Actualizar",
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
  "legal.navigation": "Legal y soporte",
  "legal.link.privacy": "Privacidad",
  "legal.link.terms": "Términos",
  "legal.link.subscriptions": "Suscripciones",
  "legal.link.deletion": "Eliminación de datos",
  "legal.link.contact": "Contacto",
  "legal.language": "Idioma de la página",
  "legal.draftStatus": "Borrador — aún no vigente",
  "legal.draftNotice":
    "Esta página es un borrador pendiente de revisión del propietario, operativa y legal. No es una política vigente.",
  "legal.contact.title": "Contacto y soporte",
  "legal.contact.intro":
    "Envía un mensaje a Nazbort Tech LLC sobre AI Marketing Studio. No incluyas contraseñas, tokens ni datos de tarjetas.",
  "legal.contact.name": "Nombre completo",
  "legal.contact.email": "Correo electrónico",
  "legal.contact.category": "Categoría de consulta",
  "legal.contact.message": "Mensaje",
  "legal.contact.submit": "Enviar mensaje",
  "legal.contact.sending": "Enviando…",
  "legal.contact.privacy":
    "Tu mensaje se envía al destinatario de soporte configurado. La aplicación no guarda una copia adicional. El operador del buzón controla su conservación.",
  "legal.contact.success":
    "Tu mensaje fue enviado. Guarda una copia para tus registros.",
  "legal.contact.error": "No pudimos enviar tu mensaje. Inténtalo más tarde.",
  "legal.contact.unavailable":
    "El correo de soporte no está configurado. Inténtalo más tarde.",
  "legal.contact.rateLimited":
    "Hay demasiadas solicitudes. Espera antes de enviar otro mensaje.",
  "legal.contact.category.general": "Consultas generales",
  "legal.contact.category.technical": "Soporte técnico",
  "legal.contact.category.billing": "Facturación y suscripciones",
  "legal.contact.category.privacy": "Privacidad y eliminación de datos",
  "legal.contact.category.problem": "Reportar un problema",
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
  "agent.miaRole": "Especialista en analítica",
  "agent.available": "Disponible",
  "agent.planned": "Planeada",
  "agent.miaPlanned":
    "Lista para interpretar las métricas disponibles de Facebook",
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
    "Sebastián ayuda a definir la estrategia y Valeria la convierte en contenido. Los resultados solo incluyen datos disponibles de las plataformas conectadas.",
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
    "Las métricas observadas provienen únicamente de publicaciones de Facebook. Las analíticas de Instagram y TikTok no están disponibles. Las recomendaciones de Edian son sugerencias de IA, no resultados observados.",
  "analytics.querying": "Consultando métricas de Facebook…",
  "analytics.loadError": "No se pudieron procesar las analíticas.",
  "analytics.providerError":
    "Facebook no pudo proporcionar las métricas en este momento. Intenta actualizar en unos instantes.",
  "analytics.reauthorizationRequired":
    "La autorización de Facebook venció. Vuelve a conectar la página en Configuración para actualizar sus métricas.",
  "analytics.permissionRequiredOne":
    "Facebook no tiene permiso para leer la interacción de {count} publicación. Revisa los permisos de la página en Configuración.",
  "analytics.permissionRequiredMany":
    "Facebook no tiene permiso para leer la interacción de {count} publicaciones. Revisa los permisos de la página en Configuración.",
  "analytics.postUnavailableOne":
    "Facebook no encontró esta publicación o no proporciona datos de interacción para ella.",
  "analytics.postUnavailableMany":
    "Facebook no encontró estas publicaciones o no proporciona datos de interacción para ellas.",
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
  "analytics.edianEyebrow": "Especialista de analítica con IA",
  "analytics.edianDescription":
    "Pídele a Edian que interprete las métricas disponibles de Facebook. Este análisis es independiente, tiene un límite de uso y no se ejecuta al abrir o actualizar esta página.",
  "analytics.edianAction": "Analizar con Edian",
  "analytics.edianLoading": "Edian está analizando las métricas de Facebook…",
  "analytics.edianNoMetrics":
    "Facebook no tiene métricas de interacción accesibles para estas publicaciones.",
  "analytics.integrationUnavailable":
    "Las métricas de Facebook no están disponibles ahora. Las analíticas de Instagram y TikTok no forman parte de esta experiencia.",
  "analytics.interpretError":
    "Edian no pudo preparar recomendaciones. Inténtalo más tarde.",
  "analytics.quotaError":
    "Se agotó el límite de análisis de Edian para este cliente.",
  "analytics.observed": "Métricas observadas de Facebook",
  "analytics.edianObservedPosts": "Basado en {count} publicaciones",
  "analytics.edianMetricCoverage":
    "Disponible en {available} de {count} publicaciones",
  "analytics.recommendations": "Recomendaciones de Edian",
  "analytics.actionTitle": "Convierte los hallazgos en acciones",
  "analytics.actionDescription":
    "Comparte estos resultados observados con Sebastián y decide qué hacer después.",
  "analytics.discussWithSebastian": "Conversar con Sebastián",
  "analytics.strategyHandoffIntro":
    "Revisa estas métricas de Facebook de este negocio. Un guion indica que el dato no está disponible, no que sea cero:",
  "analytics.strategyHandoffSummary": "Resumen observado por Edian: {summary}",
  "analytics.strategyHandoffRecommendations":
    "Sugerencias de Edian para revisar: {recommendations}",
  "analytics.strategyHandoffQuestion":
    "¿Qué siguiente paso recomendarías basándote únicamente en estos resultados disponibles?",
  "analytics.cachedAnalysis":
    "Se reutilizaron estas recomendaciones porque las métricas subyacentes no han cambiado.",
  "sofia.agentName": "Sebastián",
  "sofia.title": "Habla con Sebastián",
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
  "sofia.messages": "Mensajes de la conversación con Sebastián",
  "sofia.loadingConversation": "Cargando conversación…",
  "sofia.greeting":
    "¡Hola! Soy Sebastián. Cuéntame qué producto quieres promocionar o qué idea tienes para tu negocio.",
  "sofia.you": "Tú",
  "sofia.thinking": "Sebastián está preparando una respuesta…",
  "sofia.retryMessage": "Reintentar mensaje",
  "sofia.retryDraft": "Reintentar borrador",
  "sofia.retryLoad": "Reintentar carga",
  "sofia.messageLabel": "Mensaje para Sebastián",
  "sofia.loadingPlaceholder": "Cargando conversación…",
  "sofia.messagePlaceholder": "Escribe tu mensaje para Sebastián…",
  "sofia.sending": "Enviando…",
  "sofia.send": "Enviar",
  "sofia.generating": "Sebastián y Valeria están trabajando…",
  "sofia.createDraft": "Crear borrador con Valeria",
  "sofia.draftCreated":
    "Borrador creado: {title}. Puedes revisarlo en Aprobaciones.",
  "sofia.conversationLoadError": "No se pudo cargar la conversación.",
  "sofia.historyLoadError": "No se pudo actualizar el historial.",
  "sofia.contactError": "No se pudo contactar a Sebastián.",
  "sofia.providerUnavailable":
    "Sebastián no está disponible temporalmente. Inténtalo de nuevo más tarde.",
  "sofia.providerThrottled":
    "Sebastián está atendiendo muchas solicitudes. Espera un momento y vuelve a intentarlo.",
  "sofia.requestLimited":
    "Se recibieron demasiadas solicitudes. Espera un momento antes de volver a intentarlo.",
  "sofia.accessRequired":
    "El acceso a la IA no está disponible actualmente para este espacio. Revisa las opciones de facturación.",
  "sofia.quotaTitle": "Se alcanzó el límite de solicitudes de Sebastián",
  "sofia.quotaUsage":
    "Has usado {used} de {limit} solicitudes de Sebastián durante tu {period}.",
  "sofia.quotaChecking": "Consultando tu uso actual…",
  "sofia.quotaUsageUnavailable":
    "Alcanzaste el límite de solicitudes. No se pudo cargar el uso actual.",
  "sofia.trialPeriod": "prueba de 14 días",
  "sofia.trialPeriodEnding": "prueba de 14 días, termina el {date}",
  "sofia.billingPeriod": "período de facturación actual",
  "sofia.billingPeriodEnding":
    "período de facturación actual, termina el {date}",
  "sofia.valeriaAvailable":
    "Valeria tiene {remaining} generaciones de contenido disponibles para crear un borrador de forma independiente.",
  "sofia.viewPlans": "Ver planes",
  "sofia.continueWithValeria": "Continuar con Valeria",
  "sofia.draftError":
    "Valeria no pudo crear el borrador. Inténtalo nuevamente. Si el problema continúa, contacta con soporte.",
  "sofia.draftQuotaExceeded":
    "Se alcanzó el límite de generación de contenido de Valeria. Consulta la facturación para ver el uso y la renovación.",
  "sofia.draftConversationMissing":
    "Esta conversación no incluye instrucciones para Valeria. Envía a Sebastián un mensaje con el contenido que deseas y vuelve a intentarlo.",
  "sofia.draftContextTooLarge":
    "Esta conversación tiene demasiado contexto para crear un borrador. Inicia una conversación nueva con instrucciones más breves.",
  "sofia.draftRequestInvalid":
    "No se pudo validar la solicitud del borrador. Inténtalo nuevamente; si el problema continúa, contacta con soporte.",
  "sofia.draftProviderThrottled":
    "Valeria está recibiendo muchas solicitudes. Espera un momento y vuelve a intentarlo.",
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
  "campaigns.refreshing": "Actualizando…",
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
  "campaigns.discardTitle": "¿Descartar los cambios sin guardar?",
  "campaigns.discardDescription":
    'Se perderán los cambios de "{name}". Esta acción no se puede deshacer.',
  "campaigns.discardConfirm": "Descartar cambios",
  "campaigns.deleting": "Eliminando…",
  "campaigns.delete": "Eliminar campaña",
  "campaigns.deleteTitle": "¿Eliminar campaña?",
  "campaigns.deleteConfirm":
    'Solo se eliminará la campaña "{name}". Su contenido, aprobaciones, historial y publicaciones se conservarán sin asignar a una campaña. No se eliminarán publicaciones.',
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
    "No hay contenido disponible sin campaña. Puedes crear contenido con Sebastián y Valeria o desvincularlo de otra campaña.",
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
  "facebook.multiplePagesWarning":
    "Para publicar, debe haber exactamente una página de Facebook conectada a este negocio. Desconecta las páginas adicionales y deja conectada la que deseas usar.",
  "facebook.connect": "Conectar Facebook",
  "facebook.reconnect": "Reconectar Facebook",
  "facebook.processing": "Procesando conexión…",
  "facebook.connected": "Conectada",
  "facebook.statusChecking": "Verificando conexión…",
  "facebook.statusDisconnected": "No conectada",
  "facebook.reauthorize": "Requiere autorización",
  "facebook.statusUnavailable": "Estado de conexión no disponible",
  "facebook.retry": "Reintentar estado de conexión",
  "facebook.noBusiness": "Selecciona un negocio para administrar Facebook.",
  "facebook.verifyError": "No se pudo verificar la conexión de Facebook.",
  "facebook.startError":
    "No se pudo iniciar la autorización de Facebook. Si el problema continúa, pide a un administrador que revise la configuración de Meta.",
  "facebook.pagesError": "No se pudieron recuperar las páginas de Facebook.",
  "facebook.wrongBusiness":
    "Selecciona el negocio correcto antes de continuar.",
  "facebook.handoffExpired":
    "La autorización de Facebook expiró o ya no es válida. Inicia la conexión nuevamente.",
  "facebook.handoffSignIn":
    "Inicia sesión con la cuenta que comenzó esta conexión de Facebook.",
  "facebook.handoffAuthorization":
    "La cuenta que inició esta conexión debe tener permiso para administrar las redes sociales de este negocio.",
  "facebook.handoffBusinessUnavailable":
    "Esta conexión de Facebook pertenece a un negocio que no está disponible para la cuenta actual. Inicia sesión con la cuenta que comenzó la conexión.",
  "facebook.handoffSignOut": "Cerrar sesión",
  "facebook.dismissResult": "Cerrar",
  "facebook.selectPageError": "No se pudo conectar la página seleccionada.",
  "facebook.connectedPage": "Página conectada: {name}",
  "facebook.loading": "Procesando conexión…",
  "facebook.choosePageTitle": "Selecciona una página",
  "facebook.choosePageDescription":
    "Elige la página que deseas conectar con este negocio.",
  "facebook.disconnect": "Desconectar",
  "facebook.disconnecting": "Desconectando…",
  "facebook.disconnectConfirm":
    "¿Desconectar esta página de Facebook del negocio seleccionado?",
  "facebook.disconnectDialogTitle": "¿Desconectar la página de Facebook?",
  "facebook.disconnectDialogDescription":
    'Esta acción solo desconecta "{name}" de este negocio. La conexión de Instagram se conserva por separado, pero está vinculada a esta página. Para revocar el acceso de Meta, elimina AI Marketing Studio en la configuración de tu cuenta de Meta.',
  "facebook.confirmDisconnect": "Desconectar página",
  "facebook.disconnected":
    "La página de Facebook se desconectó de este negocio. Para revocar el acceso de Meta, elimina AI Marketing Studio en la configuración de tu cuenta de Meta.",
  "facebook.disconnectError": "No se pudo desconectar la página de Facebook.",
  "facebook.callbackDeclined": "No se completó la autorización de Facebook.",
  "facebook.callbackInvalid":
    "La solicitud de conexión de Facebook expiró o ya se utilizó. Inicia otra.",
  "facebook.callbackNoPages":
    "No se encontraron páginas de Facebook disponibles para esta cuenta.",
  "facebook.callbackError":
    "Facebook no pudo completar la conexión. Revisa los permisos de la página e inténtalo otra vez.",
  "instagram.title": "Conexión con Instagram",
  "instagram.description":
    "Primero conecta una página de Facebook a este negocio y luego autoriza la cuenta profesional de Instagram vinculada.",
  "instagram.connectionOnly":
    "La conexión con Instagram está disponible para configurar y verificar la cuenta. Actualmente no se admite publicar en Instagram.",
  "instagram.account": "Cuenta de Instagram",
  "instagram.status.notConnected": "No conectada",
  "instagram.status.linked": "Vinculada · faltan permisos",
  "instagram.status.connected": "Conectada y autorizada",
  "instagram.status.reauthorize": "Requiere reconexión",
  "instagram.status.permission": "Permisos insuficientes",
  "instagram.status.discovery": "No se pudo verificar",
  "instagram.status.attention": "Acción necesaria",
  "instagram.status.unavailable": "Estado de conexión no disponible",
  "instagram.status.configuration": "Configuración necesaria",
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
  "instagram.facebookRequired":
    "Conecta una página de Facebook a este negocio antes de conectar Instagram.",
  "instagram.facebookMultiplePages":
    "Deja conectada exactamente una página de Facebook a este negocio antes de conectar Instagram para que la cuenta vinculada sea inequívoca.",
  "instagram.configurationRequired":
    "La configuración de Instagram está incompleta. Pide a un administrador que revise Meta.",
  "instagram.permissionHelp":
    "Meta no concedió todo el acceso necesario para verificar esta cuenta. Revisa la conexión e inténtalo de nuevo.",
  "instagram.status.loading": "Verificando",
  "instagram.page": "Página asociada: {name}",
  "instagram.opening": "Abriendo Meta…",
  "instagram.connect": "Conectar Instagram",
  "instagram.reconnect": "Reconectar Instagram",
  "instagram.loading": "Verificando el estado guardado de Instagram…",
  "instagram.retry": "Reintentar verificación",
  "instagram.noBusiness": "Selecciona un negocio para administrar Instagram.",
  "instagram.disconnect": "Desconectar",
  "instagram.disconnecting": "Desconectando…",
  "instagram.disconnectConfirm":
    "¿Desconectar esta cuenta de Instagram del negocio seleccionado?",
  "instagram.disconnectDialogTitle": "¿Desconectar la cuenta de Instagram?",
  "instagram.disconnectDialogDescription":
    'Esta acción desconecta "{account}" de este negocio. La página de Facebook asociada "{page}" seguirá conectada. Para revocar el acceso de Meta, elimina AI Marketing Studio en la configuración de tu cuenta de Meta.',
  "instagram.connectedPageFallback": "la página de Facebook conectada",
  "instagram.confirmDisconnect": "Desconectar Instagram",
  "instagram.disconnected":
    "Instagram se desconectó de este negocio. Para revocar el acceso de Meta, elimina AI Marketing Studio en la configuración de tu cuenta de Meta.",
  "instagram.disconnectError": "No se pudo desconectar Instagram.",
  "tiktok.eyebrow": "Redes sociales",
  "tiktok.title": "Conexión con TikTok",
  "tiktok.description":
    "Autoriza TikTok para este negocio y revisa el estado de la cuenta conectada.",
  "tiktok.manualOnly":
    "La publicación directa en TikTok está desactivada en esta aplicación. Usa la exportación manual hasta contar con los permisos necesarios de Content Posting API y la auditoría del proveedor.",
  "tiktok.directPublishingEnabled":
    "La publicación directa en TikTok está habilitada por la configuración de esta aplicación, pero siguen aplicando la elegibilidad de la cuenta, los permisos y la aprobación del proveedor.",
  "tiktok.connectedStatus": "Conectada",
  "tiktok.reviewAccess": "Revisar acceso",
  "tiktok.notConnected": "No conectada",
  "tiktok.statusUnavailable": "Estado de conexión no disponible",
  "tiktok.authorizationIncomplete": "La autorización necesita revisión",
  "tiktok.noBusiness": "Selecciona un negocio para administrar TikTok.",
  "tiktok.checking": "Verificando",
  "tiktok.connectionSetup":
    "La disponibilidad de la conexión se comprueba al autorizar una cuenta. La disponibilidad para publicar se muestra por separado.",
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
  "tiktok.connectError":
    "No se pudo iniciar la autorización de TikTok. Si el problema continúa, pide a un administrador que revise la configuración.",
  "tiktok.account": "Cuenta de TikTok",
  "tiktok.status": "Estado: {status}",
  "tiktok.unverified": "sin verificar",
  "tiktok.retry": "Reintentar verificación",
  "tiktok.reauthorize": "Requiere autorización",
  "tiktok.disconnect": "Desconectar",
  "tiktok.disconnecting": "Desconectando…",
  "tiktok.disconnectConfirm":
    "¿Desconectar esta cuenta de TikTok del negocio seleccionado?",
  "tiktok.disconnected":
    "TikTok se desconectó de este negocio. Para revocar el acceso, elimina AI Marketing Studio en la configuración de tu cuenta de TikTok.",
  "tiktok.disconnectError": "No se pudo desconectar TikTok.",
  "tiktok.callbackDeclined": "No se completó la autorización de TikTok.",
  "tiktok.callbackInvalid":
    "La solicitud de conexión de TikTok expiró o ya se utilizó. Inicia otra.",
  "tiktok.callbackError":
    "TikTok no pudo completar la conexión. Revisa los permisos de la aplicación e inténtalo otra vez.",
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
    "Deja todos los destinos sin seleccionar para aprobarlo para uso manual. TikTok solo permite exportación manual.",
  "approval.connectedFacebook": "Página conectada: {name}",
  "approval.connectedInstagram": "Instagram conectado: {username}",
  "approval.noPublishingAccounts":
    "Conecta Facebook o una cuenta profesional autorizada de Instagram para habilitar la publicación directa.",
  "approval.loadingConnections": "Comprobando las cuentas conectadas…",
  "approval.instagramReason.textDraft":
    "Este borrador es de texto. Instagram requiere un borrador de imagen.",
  "approval.instagramReason.videoDraft":
    "Este borrador es un video. La publicación de imágenes en Instagram requiere un borrador de imagen.",
  "approval.instagramReason.imageNotStarted":
    "La generación de imagen aún no ha comenzado. Genera una imagen antes de seleccionar Instagram.",
  "approval.instagramReason.imageGenerating":
    "La generación de imagen sigue en curso. Espera a que termine antes de seleccionar Instagram.",
  "approval.instagramReason.imageFailed":
    "Falló la generación de imagen. Genera o vuelve a intentar la imagen antes de seleccionar Instagram.",
  "approval.instagramReason.imageMissing":
    "Falta el archivo de imagen completado. Genera o adjunta una imagen primero.",
  "approval.instagramReason.jpegOnly":
    "Esta imagen es {format}; Instagram requiere JPEG (.jpg o .jpeg).",
  "approval.instagramReason.unknownFormat":
    "un formato de imagen no reconocido",
  "approval.instagramReason.captionTooLong":
    "El texto supera el límite de 2.200 caracteres de Instagram.",
  "approval.facebookConnectionUnavailable":
    "La página de Facebook seleccionada ya no está disponible. Actualiza las cuentas conectadas e inténtalo de nuevo.",
  "approval.instagramConnectionUnavailable":
    "La cuenta de Instagram seleccionada ya no está disponible. Actualiza las cuentas conectadas e inténtalo de nuevo.",
  "approval.publishingAccountUnavailable":
    "La cuenta de publicación seleccionada anteriormente no está conectada en este momento.",
  "approval.instagramMediaRequirements":
    "Instagram admite imágenes JPEG completadas de hasta 8 MB y descripciones de hasta 2.200 caracteres.",
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
  "approval.confirmInstagramImage":
    "¿Publicar esta imagen JPEG aprobada y su descripción en la cuenta conectada de Instagram?",
  "approval.publishInstagram": "Publicar en Instagram",
  "approval.retryInstagram": "Reintentar Instagram",
  "approval.publishedInstagram": "✓ Publicado en Instagram",
  "approval.viewInstagramPost": "Ver publicación de Instagram",
  "approval.instagramRetrySafe":
    "Instagram confirmó que este intento no se publicó. Es seguro reintentarlo.",
  "approval.instagramNeedsReview":
    "Es posible que Instagram haya publicado esta entrada. Revisa la cuenta antes de continuar.",
  "approval.instagramPublishError":
    "No se completó la publicación en Instagram. El estado guardado aparece abajo.",
  "approval.instagramStatusRefreshError":
    "No se pudo actualizar el resultado de Instagram. Recarga los borradores antes de reintentar.",
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
  "media.heygenScript": "🎬 Guion de video con IA",
  "media.copied": "✓ Copiado",
  "media.copyScript": "Copiar guion",
  "media.closeHeygen": "Cerrar generación de video",
  "media.createHeygen": "Crear o recuperar video con IA",
  "media.closeUpload": "Cerrar carga de video",
  "media.uploadVideo": "🎬 Subir video MP4",
  "media.openImageUpload": "Subir una imagen",
  "media.cancelImageUpload": "Cerrar la carga de imagen",
  "media.imageUploadHelp":
    "Elige una imagen JPEG, PNG o WebP. Los archivos PNG y WebP se convierten a JPEG.",
  "media.uploadImage": "Subir imagen",
  "media.uploadingImage": "Subiendo imagen…",
  "media.uploadImageProgress": "Preparando y subiendo la imagen…",
  "media.imageUploadError": "No se pudo subir la imagen. Inténtalo nuevamente.",
  "media.imageTooLarge": "La imagen supera el límite de 20 MB.",
  "media.reuseImage": "Elegir una imagen existente",
  "media.cancelImageReuse": "Cerrar la biblioteca de imágenes",
  "media.existingImageHelp":
    "Solo están disponibles imágenes de borradores de esta empresa. Se preparará una copia JPEG para este borrador.",
  "media.loadingReusableImages": "Cargando las imágenes de esta empresa…",
  "media.noReusableImages":
    "No hay imágenes completas disponibles para reutilizar.",
  "media.useExistingImage": "Usar esta imagen",
  "media.reusingImage": "Preparando imagen…",
  "media.imageReuseError":
    "No se pudieron cargar o reutilizar las imágenes existentes.",
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
  "heygen.title": "AI Video Studio",
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
  "heygen.progress.submitting": "Enviando tu solicitud de video…",
  "heygen.progress.checking": "Consultando el estado guardado…",
  "heygen.progress.recovering": "Enviando y confirmando la solicitud…",
  "heygen.progress.processing": "Se está generando tu video con IA…",
  "heygen.progress.storing": "Guardando el video en almacenamiento privado…",
  "heygen.status.uncertain":
    "Es posible que el servicio de video haya recibido la solicitud. Consulta su estado antes de solicitar otro video.",
  "heygen.status.failed":
    "No se pudo generar el video. Revisa los datos antes de autorizar una nueva generación.",
  "heygen.status.stored":
    "Video guardado de forma privada. Puedes verlo antes de aprobar el contenido.",
  "heygen.status.storageFailed":
    "El video no se pudo adjuntar. El borrador puede haber cambiado. Contacta al administrador.",
  "heygen.status.completed":
    "El video está generado. Recupera el estado para completar su almacenamiento privado.",
  "heygen.status.processing":
    "Tu video con IA se está procesando. Puede tardar unos minutos.",
  "heygen.status.checked": "Revisa el guion y selecciona un avatar y una voz.",
  "heygen.status.checking": "Consultando el estado del video…",
  "heygen.previewError":
    "No se pudo abrir el video. Solicita una nueva vista previa.",
  "heygen.previewExpired":
    "La vista previa venció o no está disponible. Actualízala para volver a ver el video.",
  "heygen.recovering": "Consultando…",
  "heygen.recover": "Recuperar estado del video",
  "heygen.ariaLabel": "Generación de video con IA",
  "heygen.configure":
    "Configura tu avatar, voz y guion antes de generar el video.",
  "heygen.script": "Guion del video",
  "heygen.scriptHelp":
    "Hasta 5.000 caracteres. El texto se conserva tal como lo escribas.",
  "heygen.formatNotice":
    "Los videos con avatar se generan con HeyGen. Video vertical · 1080p. El uso de créditos de API y el costo exacto no están disponibles aquí.",
  "heygen.generate": "Generar video con IA",
  "heygen.confirmNotice":
    "Selecciona un avatar y una voz, y confirma antes de enviar la solicitud pagada.",
  "heygen.previewLoading": "Cargando video…",
  "heygen.previewRefresh": "Actualizar vista previa privada",
  "heygen.noAutoAction":
    "Generar un video no aprueba ni publica este contenido.",
  "heygen.confirmPaid":
    "¿Generar este video con IA? Esta acción consume créditos de API y puede tener un costo. No se aprobará ni publicará automáticamente.",
  "heygen.busyOtherOperation":
    "Espera a que termine la otra operación del borrador antes de recuperar el video.",
  "heygen.closeAssets": "Cerrar recursos de video",
  "heygen.exploreAssets": "Explorar avatares y voces",
  "heygen.assetsTitle": "Seleccionar recursos de video",
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
    "No se pudo completar la publicación en Facebook. Asegúrate de que haya exactamente una página de Facebook conectada y que tenga los permisos necesarios antes de volver a intentarlo.",
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
  "draft.generationContextTooLarge":
    "Este negocio tiene demasiado contexto guardado para generar contenido. Acorta el perfil o los borradores recientes e inténtalo de nuevo.",
  "draft.generationInvalidInput":
    "No se pudo validar la solicitud de generación. Revisa el negocio seleccionado e inténtalo de nuevo.",
  "draft.generationQuotaExceeded":
    "Se agotó el límite de generación de contenido de Valeria. Revisa tu plan para conocer el próximo período disponible.",
  "draft.generationAccessRequired":
    "La generación de contenido no está disponible con el plan de este negocio. Revisa los planes disponibles.",
  "draft.generationProviderThrottled":
    "El proveedor de contenido está temporalmente ocupado. Espera un momento e inténtalo de nuevo.",
  "draft.requiredFields": "El título y el texto no pueden estar vacíos.",
  "nav.home": "Resumen",
  "nav.campaigns": "Campañas",
  "nav.content": "Contenido",
  "nav.aiTeam": "Equipo IA",
  "nav.approvals": "Aprobaciones",
  "nav.analytics": "Analíticas",
  "nav.billing": "Facturación",
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
  "auth.createAccount": "Crear cuenta",
  "auth.createAccountHelp":
    "Crea una cuenta segura para configurar el espacio de trabajo de tu negocio.",
  "auth.policyDisclosure":
    "Revisa estos borradores (aún no vigentes) antes de crear una cuenta:",
  "auth.registerTrialHelp":
    "Crea tu cuenta y activa tu espacio para comenzar una prueba de 14 días si cumples los requisitos.",
  "auth.noAccount": "¿Primera vez en AI Marketing Studio?",
  "auth.trialAvailable":
    "Comienza una prueba gratuita de 14 días. No se requiere tarjeta de crédito.",
  "auth.trialUnavailable": "La prueba gratuita de 14 días no está disponible.",
  "auth.registrationChecking": "Comprobando la disponibilidad del registro…",
  "auth.registrationOpen": "El registro está disponible.",
  "auth.registrationOpenNoTrial":
    "El registro está disponible, pero las pruebas gratuitas no lo están.",
  "auth.registrationUnavailable": "El registro no está disponible actualmente.",
  "auth.registrationCheckFailed":
    "No se pudo comprobar el estado del registro; no está disponible por ahora.",
  "auth.accountCreated":
    "Tu cuenta está lista. Continúa a tu espacio de trabajo.",
  "auth.verifyEmail":
    "Revisa tu correo y verifica la dirección antes de iniciar sesión.",
  "auth.registrationError":
    "No se pudo completar la configuración. Si ya tienes una cuenta, inicia sesión o restablece tu contraseña.",
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
  "auth.continueWithGoogle": "Continuar con Google",
  "auth.continueWithFacebook": "Continuar con Facebook",
  "auth.continueWithApple": "Continuar con Apple",
  "auth.socialSignIn": "Continuar con una cuenta social",
  "auth.connecting": "Conectando…",
  "auth.providerUnavailable":
    "El inicio de sesión social no está configurado o disponible para este flujo de cuenta.",
  "auth.oauthSignInError":
    "No se pudo iniciar sesión con {provider}. Inténtalo de nuevo.",
  "auth.oauthCallbackError":
    "No se pudo completar el inicio de sesión del proveedor. Inténtalo de nuevo o usa tu correo y contraseña.",
  "auth.googleSignInError":
    "No se pudo iniciar sesión con Google. Inténtalo de nuevo.",
  "registration.provisioning": "Protegiendo tu nuevo espacio de trabajo…",
  "registration.provisioningFailed": "Aún no se pudo configurar tu cuenta",
  "registration.provisioningHelp":
    "Comprueba tu conexión e inténtalo de nuevo. Tu acceso sigue siendo seguro.",
  "registration.verifyEmail":
    "Verifica tu correo electrónico y vuelve a iniciar sesión para terminar de configurar tu espacio.",
  "tutorial.title": "Guía del producto",
  "settings.membershipRole": "Rol en el negocio",
  "settings.role.owner": "Propietario",
  "settings.role.admin": "Administrador",
  "settings.role.member": "Miembro",
  "settings.businessProfile": "Perfil del negocio",
  "settings.businessProfileHelp":
    "Mantén al día la información de tu espacio de marketing.",
  "settings.businessNameRequired": "Escribe el nombre del negocio.",
  "settings.businessEditRestricted":
    "Solo los propietarios y administradores pueden editar este negocio.",
  "settings.businessSaveError":
    "No se pudo guardar la información del negocio.",
  "settings.businessSaved": "Se guardó la información del negocio.",
  "trial.loading": "Cargando el estado de la cuenta…",
  "trial.loadError": "No se pudo cargar el estado de la cuenta.",
  "trial.accountStatus": "Acceso de la cuenta",
  "trial.operatorAccess": "Acceso de operador",
  "trial.noTrial":
    "No hay una prueba ni una suscripción activa para este espacio.",
  "trial.active": "Prueba gratuita",
  "trial.expired": "La prueba terminó",
  "trial.daysRemaining": "Quedan {count} días de prueba.",
  "trial.expiredHelp":
    "Tu contenido sigue disponible. Se requiere una suscripción para reanudar la generación con IA y la publicación.",
  "trial.generationsUsed": "Generaciones de Valeria usadas: {used} de {limit}.",
  "trial.sofiaUsed": "Solicitudes de Sebastián usadas: {used} de {limit}.",
  "trial.heygenUsed": "Generaciones de video con IA usadas: {used} de {limit}.",
  "trial.feature.leo": "Generación con Valeria",
  "trial.feature.sofia": "Solicitudes de Sebastián",
  "trial.feature.facebook": "Publicación en Facebook",
  "trial.feature.heygen": "Generación de video con IA",
  "trial.feature.image": "Generación y revisión de imágenes con IA",
  "trial.usageTitle": "Uso de la prueba",
  "trial.featureTitle": "Funciones incluidas",
  "trial.featureStatus.available": "Disponible",
  "trial.featureStatus.limited": "Limitada",
  "trial.featureStatus.unavailable": "No disponible",
  "trial.featureStatus.planned": "Planeada",
  "trial.notIncluded": "No incluido",
  "trial.feature.analytics": "Analíticas de Edian",
  "trial.feature.campaigns": "Creación de campañas",
  "trial.featureAvailable": "Disponible",
  "trial.featureUnavailable": "No disponible",
  "trial.status.active": "Hay una suscripción activa registrada.",
  "trial.status.past_due": "El acceso de la suscripción requiere atención.",
  "trial.status.canceled": "Esta suscripción se canceló.",
  "trial.status.unavailable": "No hay una suscripción disponible.",
  "trial.status.expired": "La prueba terminó.",
  "trial.status.operator": "Se concedió acceso de operador.",
  "trial.status.trialing": "Hay una prueba en curso.",
  "trial.subscriptionUnavailable":
    "Administra tu suscripción y método de pago desde la página Facturación.",
  "billing.eyebrow": "Cuenta",
  "billing.title": "Facturación",
  "billing.description":
    "Consulta la prueba, el uso y la suscripción de este espacio de trabajo.",
  "billing.noBusiness":
    "Selecciona un espacio de negocio para ver su facturación.",
  "billing.loading": "Cargando los detalles de facturación…",
  "billing.loadError": "No se pudieron cargar los detalles de facturación.",
  "billing.accountTitle": "Tu suscripción",
  "billing.accountHelp": "El acceso se aplica desde el servidor.",
  "billing.subscriptionStatus": "Estado",
  "billing.daysRemaining": "Tiempo de prueba restante",
  "billing.days": "{count} días",
  "billing.trialEnds": "Fin de la prueba",
  "billing.nextRenewal": "Fin del período actual",
  "billing.noCardTrial":
    "La prueba de 14 días comienza sin tarjeta de crédito. Agrega facturación solo cuando decidas mejorar tu plan.",
  "billing.upgradeEyebrow": "Un plan mensual",
  "billing.priceInCheckout": "El precio mensual se mostrará en el pago seguro",
  "billing.planDescription":
    "Sigue usando tu espacio y las herramientas de IA con una suscripción mensual recurrente.",
  "billing.upgrade": "Mejorar con Stripe",
  "billing.manageSubscription": "Administrar o cancelar suscripción",
  "billing.noRefundCheckout":
    "Todos los pagos de suscripción no son reembolsables, excepto cuando la ley aplicable lo exija. Cancela para detener futuras renovaciones; cancelar no reembolsa pagos ya procesados.",
  "billing.subscriptionPolicy":
    "Lee la Política de suscripciones y cancelación",
  "billing.portalCancellationNotice":
    "La cancelación no se completa hasta que Stripe confirme el cambio y esta página muestre el estado actualizado.",
  "billing.openingCheckout": "Abriendo el pago seguro…",
  "billing.openingPortal": "Abriendo el portal de facturación…",
  "billing.adminOnly":
    "Solo los propietarios y administradores pueden gestionar la facturación.",
  "billing.notConfigured":
    "La facturación segura no está configurada en este entorno.",
  "billing.operatorPlan": "Este espacio tiene acceso otorgado por el operador.",
  "billing.usageTitle": "Uso del espacio",
  "billing.monthlyUsage": "El uso se restablece con el período mensual.",
  "billing.trialUsage": "Uso durante la prueba de 14 días de este espacio.",
  "billing.usage.businesses": "Espacios de negocio",
  "billing.usage.leo": "Generaciones de Valeria",
  "billing.usage.sofia": "Solicitudes de Sebastián",
  "billing.usage.edian": "Análisis de Edian",
  "billing.usage.campaigns": "Campañas",
  "billing.usage.heygen": "Generaciones de video con IA",
  "billing.comingSoon":
    "El pago de suscripciones aún no está disponible. Sigue usando tu espacio durante la prueba.",
  "billing.paymentFailed":
    "Falló un pago de la suscripción. El uso de IA está pausado hasta resolver la facturación; tus datos guardados siguen disponibles.",
  "billing.cancelScheduled":
    "Stripe confirma la cancelación para {date}. Si la cuenta sigue al día, el acceso pagado continúa hasta el fin del período registrado.",
  "billing.checkoutReturn":
    "Regresaste del pago. El acceso a la suscripción se actualizará cuando Stripe la confirme.",
  "billing.portalReturn":
    "Regresaste de Stripe. Actualiza la facturación para confirmar los cambios de suscripción.",
  "billing.actionError":
    "No se pudo iniciar la sesión segura de facturación. Inténtalo de nuevo.",
  "billing.notAvailable": "No disponible",
  "billing.status.trialing": "Prueba gratuita de 14 días",
  "billing.status.active": "Suscripción activa",
  "billing.status.past_due": "El pago requiere atención",
  "billing.status.canceled": "Suscripción cancelada",
  "billing.status.expired": "Prueba finalizada",
  "billing.status.operator": "Acceso de operador",
  "billing.status.unavailable": "Facturación no disponible",
  "onboarding.loading": "Cargando la configuración…",
  "onboarding.loadError":
    "No se pudo cargar la configuración guardada. Actualiza e inténtalo de nuevo.",
  "onboarding.retry": "Volver a cargar la configuración",
  "onboarding.saveError": "No se pudo guardar el progreso. Inténtalo de nuevo.",
  "onboarding.activateError":
    "No se pudo crear el espacio. La configuración guardada sigue disponible.",
  "onboarding.stepCount": "Paso {step} de {total}",
  "onboarding.step1Title": "Te damos la bienvenida a tu espacio",
  "onboarding.step1Description":
    "Elige los idiomas de la interfaz y de la IA. Puedes cambiarlos más adelante.",
  "onboarding.step2Title": "Cuéntanos sobre tu negocio",
  "onboarding.step2Description":
    "Algunos datos ayudan a Sebastián y Valeria a crear contenido más relevante.",
  "onboarding.step3Title": "Elige tus objetivos de marketing",
  "onboarding.step3Description":
    "Selecciona los resultados en los que quieres enfocarte.",
  "onboarding.step4Title": "Describe tu audiencia y plataformas",
  "onboarding.step4Description":
    "Estos datos son opcionales y puedes actualizarlos más adelante.",
  "onboarding.step5Title": "Conecta tus cuentas sociales más tarde",
  "onboarding.step5Description":
    "Puedes omitir este paso y conectar cuentas desde Configuración.",
  "onboarding.step6Title": "Revisa y crea tu espacio de trabajo",
  "onboarding.step6Description": "Tu espacio será privado para tu negocio.",
  "onboarding.goalsLegend": "Objetivos de marketing",
  "onboarding.goalAwareness": "Aumentar el reconocimiento",
  "onboarding.goalProducts": "Promocionar productos",
  "onboarding.goalLeads": "Generar contactos",
  "onboarding.goalEngagement": "Aumentar la interacción",
  "onboarding.goalServices": "Promocionar servicios",
  "onboarding.platformsLegend": "Plataformas que podrías usar",
  "onboarding.socialCapabilities":
    "Más adelante podrás conectar cuentas compatibles desde Configuración.",
  "onboarding.socialFacebook":
    "Facebook: publicaciones disponibles en páginas conectadas.",
  "onboarding.socialInstagram":
    "Instagram: se puede conectar; la publicación aún no está disponible.",
  "onboarding.socialTikTok":
    "TikTok: prepara contenido para exportarlo manualmente; no hay publicación directa.",
  "onboarding.socialSkipHelp":
    "No se conecta ninguna cuenta social durante esta configuración.",
  "onboarding.skipSocial": "Omitir por ahora",
  "onboarding.continue": "Continuar",
  "onboarding.next": "Siguiente",
  "onboarding.back": "Atrás",
  "onboarding.finish": "Crear espacio",
  "onboarding.businessNameFallback": "Tu negocio",
  "onboarding.trialDisclosure":
    "El acceso de prueba solo se mostrará cuando estén habilitados los controles y la elegibilidad del servidor. La facturación no está disponible.",
  "tutorial.stepCount": "Paso {step} de {total}",
  "tutorial.progress": "Progreso de la guía del producto",
  "tutorial.welcomeTitle": "Te damos la bienvenida a tu espacio de marketing",
  "tutorial.welcomeBody":
    "Tu panel reúne planificación, contenido, revisión y resultados. Esta guía breve explica cómo funciona cada sección.",
  "tutorial.dashboardTitle": "El panel y la navegación",
  "tutorial.dashboardBody":
    "Consulta tu trabajo en el panel. La barra lateral te lleva a campañas, contenido, revisión, resultados y configuración.",
  "tutorial.sofiaTitle": "Sebastián planifica tu marketing",
  "tutorial.sofiaBody":
    "Sebastián ayuda a aclarar objetivos y preparar un resumen estructurado. No publica contenido.",
  "tutorial.leoTitle": "Valeria crea contenido",
  "tutorial.leoBody":
    "Valeria convierte las instrucciones aprobadas en borradores, como textos y guiones. Tú revisas cada borrador antes de publicarlo.",
  "tutorial.miaTitle": "Edian interpreta la interacción en Facebook",
  "tutorial.miaBody":
    "Pídele a Edian que interprete las métricas disponibles de hasta 10 publicaciones confirmadas de Facebook. Las analíticas de Instagram y TikTok, las tendencias históricas, las conversiones y los ingresos no están disponibles. Las recomendaciones son sugerencias, no resultados observados.",
  "tutorial.creationTitle": "Creación rápida",
  "tutorial.creationBody":
    "Usa la acción del panel para iniciar una solicitud breve de contenido. Revisa el borrador antes de aprobarlo o publicarlo.",
  "tutorial.guidedTitle": "Creación guiada con Sebastián",
  "tutorial.guidedBody":
    "Usa la conversación de planificación de Sebastián para aclarar el objetivo y preparar instrucciones antes de pedirle a Valeria un borrador.",
  "tutorial.campaignTitle": "Las campañas son opcionales",
  "tutorial.campaignBody":
    "Crea una campaña si quieres agrupar trabajo por objetivo. También puedes crear contenido sin una campaña.",
  "tutorial.reviewTitle": "Revisa antes de aprobar",
  "tutorial.reviewBody":
    "Revisa los borradores en Revisión. Los permisos del negocio determinan quién puede aprobar o publicar.",
  "tutorial.publishingTitle": "Destinos de publicación disponibles",
  "tutorial.publishingBody":
    "Se admite la publicación en páginas de Facebook. El contenido de TikTok se exporta manualmente. Instagram se puede conectar, pero no se puede publicar.",
  "tutorial.trialTitle": "Uso y configuración de la cuenta",
  "tutorial.trialBody":
    "Cuando esté habilitado, el servidor aplicará las fechas de prueba y el uso de IA. La compra de suscripciones no está disponible y no se recopilan datos de pago.",
  "tutorial.skip": "Omitir guía",
  "tutorial.saveAndExit": "Guardar y salir",
  "tutorial.back": "Atrás",
  "tutorial.next": "Siguiente",
  "tutorial.finish": "Finalizar",
  "tutorial.resume": "Reanudar la guía",
  "tutorial.restart": "Reiniciar la guía",
  "tutorial.completeEyebrow": "Tu siguiente paso",
  "tutorial.completeTitle": "¡Ya puedes hacer crecer tu negocio!",
  "tutorial.completeBody":
    "Explora las opciones de tu cuenta o vuelve al panel para poner tu plan en marcha.",
  "tutorial.explorePlans": "Explorar planes de suscripción",
  "tutorial.continueDashboard": "Continuar al panel",
  "tutorial.saveError":
    "No se pudo guardar la finalización de la guía. Inténtalo de nuevo.",
  "tutorial.loadError": "No se pudo cargar el progreso guardado de la guía.",
  "language.interface": "Idioma de la interfaz",
  "language.conversation": "Idioma de las conversaciones con IA",
  "language.content": "Idioma del contenido de marketing",
  "language.interfaceHelp":
    "Controla la navegación, las etiquetas y el texto de la aplicación.",
  "language.conversationHelp":
    "Define el idioma que usan Sebastián y otros asistentes de IA al responder.",
  "language.contentHelp":
    "Define el idioma preferido para nuevos textos, guiones y contenido de marketing.",
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
  "language.saveInterface": "Guardar idioma de la interfaz",
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
  "usage.heygenTitle": "Uso de AI Video Studio",
  "usage.heygenNote":
    "La generación de video la ofrece HeyGen. Es un límite de intentos configurado por el operador, no un precio ni un saldo de suscripción.",
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
  "capability.limited": "Limitada",
  "capability.planned": "Planeada",
  "capability.unavailable": "No disponible",
  "settings.featuresTitle": "Disponibilidad de funciones",
  "settings.facebookPublishing": "Publicación en Facebook",
  "settings.tiktokDirect": "Publicación directa en TikTok",
  "settings.tiktokManual": "Exportación manual para TikTok",
  "settings.instagramConnection": "Conexión con Instagram",
  "settings.instagramPublishing": "Publicación en Instagram",
  "settings.miaAnalysis": "Analítica de Edian",
  "settings.facebookPublishingDetail":
    "Publica contenido aprobado en páginas de Facebook conectadas.",
  "settings.tiktokDirectDetail":
    "La publicación directa aún no está disponible.",
  "settings.tiktokManualDetail":
    "Prepara y exporta contenido para publicarlo manualmente.",
  "settings.instagramConnectionDetail":
    "Conecta una cuenta; la conexión no habilita publicaciones.",
  "settings.instagramPublishingDetail":
    "La publicación en Instagram aún no está disponible.",
  "settings.miaAnalysisDetail":
    "Edian interpreta las métricas de interacción disponibles de Facebook cuando solicitas un análisis. Las analíticas de Instagram y TikTok no están disponibles.",
  "subscription.title": "Información de suscripción",
  "subscription.notice":
    "El estado de suscripción aparecerá aquí cuando haya un servicio de facturación autorizado.",
};

export type Translate = (
  key: MessageKey,
  values?: Record<string, string | number>,
) => string;

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

initializeDefaultLocalizationContext({
  locale: "en",
  setInterfaceLanguage: async () => true,
  saveAccountPreferences: async () => {},
  t: (key, values) => formatMessage(en[key], values),
  account: null,
  accountLoading: false,
  accountError: null,
  preferenceError: false,
  refreshAccount: async () => {},
});

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
      if (!userId) return true;
      saveLanguage(userLanguageKey(userId), language);
      setPreferenceErrorState({ userId, error: false });
      try {
        await saveAccountPreferences({
          interface_language: language,
        });
        return true;
      } catch {
        setPreferenceErrorState({ userId, error: true });
        return false;
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

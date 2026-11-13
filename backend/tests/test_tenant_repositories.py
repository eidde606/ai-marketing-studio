"""Negative persistence tests use contexts obtained from the real access service."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.orm import Session

from app.features.access.permissions import Permission
from app.features.access.principal import Principal
from app.features.access.service import require_permission
from app.features.analytics import repository as analytics
from app.features.businesses import repository as businesses
from app.features.campaigns import repository as campaigns
from app.features.content import repository as content
from app.features.drafts import repository as drafts
from app.features.facebook import repository as facebook
from app.features.instagram import repository as instagram
from app.features.media import repository as media
from app.features.tiktok import repository as tiktok
from app.models import (Business, BusinessMembership, Campaign, Conversation, ConversationMessage,
                        Draft, FacebookOAuthState, HeyGenGenerationAttempt, ImageRevision,
                        InstagramConnection, InstagramOAuthState, SocialAccount, TikTokOAuthState, User)

NOW = datetime.now(timezone.utc)
ISSUER = "https://repository-tests.invalid"


def seed_tenants(engine):
    with Session(engine) as db:
        for business in ("a", "b"):
            db.add(Business(id=business, name=business))
            db.add(User(id=business, auth_issuer=ISSUER, auth_subject=business))
        db.flush()
        for business in ("a", "b"):
            db.add(BusinessMembership(id=business, business_id=business, user_id=business, role="owner"))
            db.add(Campaign(id=f"{business}-campaign", business_id=business, name="Campaign", objective="Objective"))
            db.add(Conversation(id=f"{business}-conversation", business_id=business))
            for status in ("pending", "approved"):
                db.add(Draft(id=f"{business}-{status}", business_id=business, title="Content", caption="Caption",
                             platform="facebook", status=status, image_prompt="Image"))
            for platform in ("facebook", "tiktok"):
                db.add(SocialAccount(id=f"{business}-{platform}", business_id=business, platform=platform,
                                     platform_account_id=f"{business}-provider-{platform}", account_name=platform,
                                     encrypted_access_token="private", connection_status="connected"))
            db.add(InstagramConnection(business_id=business, status="not_connected"))
            for model in (FacebookOAuthState, TikTokOAuthState, InstagramOAuthState):
                values = dict(state_hash=f"{business}-{model.__name__}", business_id=business,
                              user_id=business, expires_at=NOW + timedelta(hours=1))
                if model is InstagramOAuthState:
                    values["facebook_page_id"] = f"{business}-provider-facebook"
                db.add(model(**values))
        db.flush()
        for business in ("a", "b"):
            for index in range(3):
                db.add(ConversationMessage(id=f"{business}-message-{index}", conversation_id=f"{business}-conversation",
                                           role="user", content=business, created_at=NOW + timedelta(seconds=index)))
            db.add(ImageRevision(id=f"{business}-revision", draft_id=f"{business}-pending",
                                 original_image_path=f"businesses/{business}/original.png", instructions="Edit", status="generating"))
            db.add(HeyGenGenerationAttempt(id=f"{business}-attempt", business_id=business,
                    draft_id=f"{business}-pending", user_id=business, request_fingerprint="hash",
                    idempotency_key=f"{business}-key", avatar_id="avatar", voice_id="voice", script="Script",
                    aspect_ratio="9:16", resolution="720p", status="PROCESSING", storage_status="PENDING",
                    first_submitted_at=NOW, created_at=NOW, updated_at=NOW))
        db.commit()


def context(db, business="a"):
    return require_permission(db, Principal(ISSUER, business), business, Permission.READ)


@pytest.fixture
def tenant_db(isolated_client):
    _, engine = isolated_client
    seed_tenants(engine)
    with Session(engine) as db:
        yield db, context(db)


@pytest.mark.parametrize("read", [drafts.get_draft_scoped, facebook.get_draft_scoped,
                                 tiktok.get_draft_scoped, analytics.get_draft_scoped])
def test_foreign_draft_never_returned_even_if_cached(tenant_db, read):
    db, scope = tenant_db
    db.get(Draft, "b-pending")
    assert read(db, scope, "b-pending") is None
    assert read(db, scope, "a-pending").business_id == "a"
    assert drafts.lock_draft_scoped(db, scope, "b-pending") is None


def test_explicit_context_no_default_or_raw_business_id(tenant_db):
    db, scope = tenant_db
    for invalid in (None, "a", {}, Principal(ISSUER, "a")):
        with pytest.raises(TypeError):
            drafts.get_draft_scoped(db, invalid, "a-pending")
    with pytest.raises(TypeError):
        drafts.get_draft_scoped(db, "a-pending")
    assert businesses.get_business_scoped(db, scope).id == "a"


def test_update_and_soft_delete_use_tenant_and_eligibility_predicates(tenant_db):
    db, scope = tenant_db
    assert not drafts.update_draft_scoped(db, scope, "b-pending", expected_status="pending", values={"title": "stolen"})
    assert drafts.soft_delete_if_idle_scoped(db, scope, "b-pending", NOW) is None
    assert not drafts.update_draft_scoped(db, scope, "a-approved", expected_status="pending", values={"title": "changed"})
    assert drafts.update_draft_scoped(db, scope, "a-pending", expected_status="pending", values={"caption": "Updated"})
    db.get(Draft, "a-approved").facebook_publish_status = "publishing"
    db.flush()
    assert drafts.soft_delete_if_idle_scoped(db, scope, "a-approved", NOW) is None
    # Generating image revisions retain the original deletion exclusion.
    assert drafts.soft_delete_if_idle_scoped(db, scope, "a-pending", NOW) is None
    db.get(ImageRevision, "a-revision").status = "rejected"
    db.flush()
    assert drafts.soft_delete_if_idle_scoped(db, scope, "a-pending", NOW) == "a-pending"
    db.commit()
    assert db.get(Draft, "b-pending").deleted_at is None
    assert db.get(Draft, "b-pending").title == "Content"
    with pytest.raises(ValueError):
        drafts.update_draft_scoped(db, scope, "a-approved", expected_status="approved", values={"business_id": "b"})


def test_campaign_associations_counts_and_corrupt_relationships(tenant_db):
    db, scope = tenant_db
    assert not campaigns.change_association_scoped(db, scope, "b-campaign", "a-pending", attach=True)
    assert not campaigns.change_association_scoped(db, scope, "a-campaign", "b-pending", attach=True)
    assert campaigns.change_association_scoped(db, scope, "a-campaign", "a-pending", attach=True)
    db.commit()
    # Existing schema permits this corrupt relationship; scoped reads must not leak it.
    db.get(Draft, "b-pending").campaign_id = "a-campaign"
    db.commit()
    cached = db.get(Campaign, "a-campaign")
    assert len(cached.drafts) == 2
    campaign = campaigns.find_campaign_scoped(db, scope, "a-campaign")
    assert [d.id for d in campaign.drafts] == ["a-pending"]
    assert campaigns.draft_count_scoped(db, scope, "a-campaign") == 1
    assert campaigns.draft_count_scoped(db, scope, "b-campaign") == 0
    assert campaigns.find_campaign_scoped(db, scope, "b-campaign") is None
    assert not campaigns.delete_campaign_scoped(db, scope, "b-campaign")
    assert not campaigns.change_association_scoped(db, scope, "a-campaign", "b-pending", attach=False)


def test_campaign_delete_unlinks_only_owned_drafts(tenant_db):
    db, scope = tenant_db
    assert campaigns.change_association_scoped(db, scope, "a-campaign", "a-pending", attach=True)
    db.commit()
    assert campaigns.delete_campaign_scoped(db, scope, "a-campaign")
    db.commit()
    assert db.get(Draft, "a-pending").campaign_id is None
    assert db.get(Campaign, "b-campaign") is not None


def test_messages_and_pagination(tenant_db):
    db, scope = tenant_db
    assert content.get_conversation_scoped(db, scope, "b-conversation") is None
    assert content.list_messages_scoped(db, scope, "b-conversation") == []
    assert content.add_message_scoped(db, scope, "b-conversation", role="assistant", content="Wrong") is None
    assert content.add_message_scoped(db, scope, "a-conversation", role="assistant", content="Allowed")
    db.commit()
    for offset in range(5):
        result = content.list_messages_scoped(db, scope, "a-conversation", limit=1, offset=offset)
        assert all(m.conversation_id == "a-conversation" for m in result)
    assert len(content.list_conversations_scoped(db, scope)) == 1
    assert {d.business_id for d in drafts.list_drafts_scoped(db, scope)} == {"a"}
    assert len(campaigns.list_campaigns_scoped(db, scope)) == 1
    assert campaigns.list_campaigns_scoped(db, scope, offset=1) == []
    with pytest.raises(ValueError):
        content.list_messages_scoped(db, scope, "a-conversation", limit=10000)
    with pytest.raises(InvalidRequestError):
        content.get_conversation_scoped(db, scope, "a-conversation").messages


@pytest.mark.parametrize("repo,platform", [(facebook, "facebook"), (tiktok, "tiktok")])
def test_social_accounts_are_scoped(tenant_db, repo, platform):
    db, scope = tenant_db
    assert repo.get_account_scoped(db, scope, f"b-{platform}") is None
    assert repo.get_account_scoped(db, scope, f"a-{platform}").business_id == "a"
    assert [a.id for a in repo.list_accounts_scoped(db, scope)] == [f"a-{platform}"]
    assert repo.list_accounts_scoped(db, scope, offset=1) == []
    assert analytics.get_connected_facebook_account_scoped(db, scope).id == "a-facebook"


def test_publication_claims_reject_foreign_drafts_and_accounts(tenant_db):
    db, scope = tenant_db
    assert not facebook.claim_publication_scoped(db, scope, "b-approved")
    assert not tiktok.claim_publication_scoped(db, scope, "a-approved", "b-tiktok")
    assert not tiktok.claim_publication_scoped(db, scope, "b-approved", "a-tiktok")
    assert facebook.claim_publication_scoped(db, scope, "a-approved")
    assert not facebook.claim_publication_scoped(db, scope, "a-approved")
    assert tiktok.claim_publication_scoped(db, scope, "a-approved", "a-tiktok")
    db.commit()
    assert db.get(Draft, "b-approved").facebook_publish_status == "not_published"
    assert db.get(Draft, "b-approved").tiktok_account_id is None
    assert not tiktok.save_refreshed_credentials_scoped(db, scope, "b-tiktok",
        encrypted_access_token="changed", encrypted_refresh_token="changed", token_expires_at=NOW)
    assert not instagram.update_connection_scoped(db, scope, {"facebook_page_id": "b-provider-facebook"})
    assert instagram.update_connection_scoped(db, scope, {"status": "permission_error"})
    db.commit()
    assert db.get(InstagramConnection, "b").status == "not_connected"


@pytest.mark.parametrize("repo,model", [(facebook, FacebookOAuthState), (tiktok, TikTokOAuthState),
                                        (instagram, InstagramOAuthState)])
def test_oauth_consume_tenant_user_and_one_time(tenant_db, repo, model):
    db, scope = tenant_db
    foreign = f"b-{model.__name__}"
    own = f"a-{model.__name__}"
    assert repo.consume_oauth_state_scoped(db, scope, foreign, "b", NOW) is None
    assert repo.consume_oauth_state_scoped(db, scope, own, "b", NOW) is None
    assert repo.consume_oauth_state_scoped(db, scope, own, "a", NOW + timedelta(days=1)) is None
    assert repo.consume_oauth_state_scoped(db, scope, own, "a", NOW) is not None
    assert repo.consume_oauth_state_scoped(db, scope, own, "a", NOW) is None
    db.commit()
    assert db.get(model, foreign) is not None


def test_media_reads_locks_and_mutations(tenant_db):
    db, scope = tenant_db
    assert media.get_revision_scoped(db, scope, "b-pending", "b-revision") is None
    assert media.list_revisions_scoped(db, scope, "b-pending") == []
    assert not media.mark_revision_failed_scoped(db, scope, "b-revision")
    assert not media.save_ready_revision_scoped(db, scope, "b-revision", "businesses/a/edit.png")
    assert media.save_ready_revision_scoped(db, scope, "a-revision", "businesses/a/edit.png")
    assert media.get_attempt_scoped(db, scope, "b-attempt") is None
    assert media.lock_attempt_scoped(db, scope, "b-attempt") == (None, None)
    assert media.latest_attempt_scoped(db, scope, "b-pending") is None
    assert not media.update_attempt_scoped(db, scope, "b-attempt", expected_status="PROCESSING",
                                          expected_updated_at=NOW, values={"status": "FAILED"})
    draft, attempt = media.lock_attempt_scoped(db, scope, "a-attempt")
    assert (draft.id, attempt.id) == ("a-pending", "a-attempt")
    assert media.update_attempt_scoped(db, scope, attempt.id, expected_status=attempt.status,
                                      expected_updated_at=attempt.updated_at, values={"status": "FAILED"})
    assert not media.reserve_image_generation_scoped(db, scope, "b-pending", "gen", NOW)
    assert media.reserve_image_generation_scoped(db, scope, "a-pending", "gen", NOW)
    assert not media.save_generated_image_scoped(db, scope, "b-pending", "gen", "businesses/a/image.png")
    assert not media.save_generated_image_scoped(db, scope, "a-pending", "wrong", "businesses/a/image.png")
    assert media.save_generated_image_scoped(db, scope, "a-pending", "gen", "businesses/a/image.png")
    db.commit()
    assert db.get(ImageRevision, "b-revision").status == "generating"
    assert db.get(HeyGenGenerationAttempt, "b-attempt").status == "PROCESSING"
    assert db.get(Draft, "b-pending").image_status == "not_started"


def test_mismatched_attempt_parent_and_storage_paths(tenant_db):
    db, scope = tenant_db
    # A broken historical relationship must not be resolved by attempt.business_id alone.
    db.get(HeyGenGenerationAttempt, "a-attempt").draft_id = "b-approved"
    db.commit()
    assert media.get_attempt_scoped(db, scope, "a-attempt") is None
    assert media.lock_attempt_scoped(db, scope, "a-attempt") == (None, None)
    with pytest.raises(ValueError):
        media.save_ready_revision_scoped(db, scope, "a-revision", "businesses/b/private.png")
    with pytest.raises(ValueError):
        media.save_ready_revision_scoped(db, scope, "a-revision", "businesses/a/../b/private.png")


def test_inserts_enforce_tenant_and_parent_ownership(tenant_db):
    db, scope = tenant_db
    with pytest.raises(ValueError):
        drafts.add_draft_scoped(db, scope, Draft(business_id="b", title="No", caption="No", platform="facebook"))
    assert drafts.add_draft_scoped(db, scope, Draft(title="No", caption="No", platform="facebook", campaign_id="b-campaign")) is None
    assert media.add_revision_scoped(db, scope, ImageRevision(draft_id="b-pending",
        original_image_path="businesses/a/source.png", instructions="No")) is None
    assert instagram.add_oauth_state_scoped(db, scope, InstagramOAuthState(state_hash="bad-link",
        user_id="a", facebook_page_id="b-provider-facebook", expires_at=NOW)) is None
    new_id = drafts.add_draft_scoped(db, scope, Draft(title="Good", caption="Yes", platform="facebook"))
    conversation_id = content.add_conversation_scoped(db, scope, Conversation())
    campaign_id = campaigns.add_campaign_scoped(db, scope, Campaign(name="Good", objective="Goal"))
    db.commit()
    assert drafts.get_draft_scoped(db, scope, new_id).business_id == "a"
    assert content.get_conversation_scoped(db, scope, conversation_id).business_id == "a"
    assert campaigns.find_campaign_scoped(db, scope, campaign_id).business_id == "a"
    with pytest.raises(ValueError):
        drafts.add_draft_scoped(db, scope, db.get(Draft, "b-pending"))


def test_remaining_mutations_and_handoff_records(tenant_db):
    db, scope = tenant_db
    assert not campaigns.update_campaign_scoped(db, scope, "b-campaign", {"name": "Wrong"})
    assert campaigns.update_campaign_scoped(db, scope, "a-campaign", {"name": "Updated"})
    for repo, field in ((facebook, "facebook_publish_status"), (tiktok, "tiktok_publish_status")):
        assert not repo.save_publication_scoped(db, scope, "b-approved", expected_status="not_published", values={field: "needs_review"})
        assert repo.save_publication_scoped(db, scope, "a-approved", expected_status="not_published", values={field: "needs_review"})
    assert not facebook.reset_publication_scoped(db, scope, "b-approved")
    assert facebook.reset_publication_scoped(db, scope, "a-approved")
    assert not facebook.update_account_scoped(db, scope, "b-facebook", {"account_name": "Wrong"})
    assert facebook.update_account_scoped(db, scope, "a-facebook", {"account_name": "Updated"})
    assert not media.update_revision_scoped(db, scope, "b-pending", "b-revision", expected_status="generating", status="failed")
    assert media.update_revision_scoped(db, scope, "a-pending", "a-revision", expected_status="generating", status="failed")
    assert not media.update_draft_media_scoped(db, scope, "b-pending", expected_video_status="not_started", values={"video_status": "uploading"})
    assert media.update_draft_media_scoped(db, scope, "a-pending", expected_video_status="not_started", values={"video_status": "uploading"})
    for business in ("a", "b"):
        db.get(FacebookOAuthState, f"{business}-FacebookOAuthState").selection_token_hash = f"{business}-handoff"
    db.flush()
    assert facebook.get_pending_selection_scoped(db, scope, "b-handoff", "b", NOW, lock=True) is None
    assert not facebook.delete_pending_selection_scoped(db, scope, "b-handoff", "b")
    assert facebook.get_pending_selection_scoped(db, scope, "a-handoff", "a", NOW, lock=True)
    assert facebook.delete_pending_selection_scoped(db, scope, "a-handoff", "a")
    db.commit()
    assert db.get(Campaign, "b-campaign").name == "Campaign"
    assert db.get(SocialAccount, "b-facebook").account_name == "facebook"
    assert db.get(Draft, "b-pending").video_status == "not_started"


def test_generation_failures_and_stale_recovery_are_scoped(tenant_db):
    db, scope = tenant_db
    assert not media.mark_revision_rejected_scoped(db, scope, "b-revision")
    assert media.mark_revision_rejected_scoped(db, scope, "a-revision")
    assert media.reserve_image_generation_scoped(db, scope, "a-pending", "g", NOW)
    assert not media.mark_image_generation_failed_scoped(db, scope, "b-pending", "g")
    assert not media.mark_image_generation_failed_scoped(db, scope, "a-pending", "other")
    assert not media.reset_image_generation_scoped(db, scope, "b-pending", NOW + timedelta(hours=1))
    assert not media.reset_image_generation_scoped(db, scope, "a-pending", NOW - timedelta(hours=1))
    assert media.reset_image_generation_scoped(db, scope, "a-pending", NOW + timedelta(hours=1))
    db.commit()
    assert db.get(Draft, "b-pending").image_status == "not_started"


def test_scoped_provider_and_media_inserts(tenant_db):
    db, scope = tenant_db
    for repo, model in ((facebook, FacebookOAuthState), (tiktok, TikTokOAuthState), (instagram, InstagramOAuthState)):
        values = dict(state_hash=f"new-{model.__name__}", user_id="a", expires_at=NOW + timedelta(hours=1))
        if model is InstagramOAuthState:
            values["facebook_page_id"] = "a-provider-facebook"
        key = repo.add_oauth_state_scoped(db, scope, model(**values))
        assert key == values["state_hash"]
    for repo, platform in ((facebook, "facebook"), (tiktok, "tiktok")):
        account = SocialAccount(platform=platform, platform_account_id="new", account_name="New", encrypted_access_token="secret")
        key = repo.add_account_scoped(db, scope, account)
        assert repo.get_account_scoped(db, scope, key).business_id == "a"
        with pytest.raises(ValueError):
            repo.add_account_scoped(db, scope, SocialAccount(platform="wrong"))
    key = media.add_revision_scoped(db, scope, ImageRevision(draft_id="a-pending",
        original_image_path="businesses/a/original.png", instructions="New"))
    assert media.get_revision_scoped(db, scope, "a-pending", key)
    attempt = HeyGenGenerationAttempt(draft_id="a-pending", user_id="a", request_fingerprint="new",
        idempotency_key="new", avatar_id="a", voice_id="v", script="S", aspect_ratio="9:16", resolution="720p",
        status="FAILED", first_submitted_at=NOW, created_at=NOW, updated_at=NOW)
    key = media.add_attempt_scoped(db, scope, attempt)
    assert media.get_attempt_scoped(db, scope, key).business_id == "a"
    # A foreign parent prevents insertion even when the attempt claims tenant A.
    attempt = HeyGenGenerationAttempt(draft_id="b-pending", user_id="a", request_fingerprint="foreign",
        idempotency_key="foreign", avatar_id="a", voice_id="v", script="S", aspect_ratio="9:16", resolution="720p",
        status="FAILED", first_submitted_at=NOW, created_at=NOW, updated_at=NOW)
    assert media.add_attempt_scoped(db, scope, attempt) is None
    db.commit()

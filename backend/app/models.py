from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, JSON, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Business(Base):
    __tablename__ = "businesses"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    target_audience: Mapped[str | None] = mapped_column(String, nullable=True)
    brand_voice: Mapped[str | None] = mapped_column(String, nullable=True)

    # Marketing profile
    industry: Mapped[str | None] = mapped_column(String, nullable=True)
    products_services: Mapped[str | None] = mapped_column(String, nullable=True)
    service_area: Mapped[str | None] = mapped_column(String, nullable=True)
    website_url: Mapped[str | None] = mapped_column(String, nullable=True)
    marketing_goals: Mapped[str | None] = mapped_column(String, nullable=True)
    preferred_platforms: Mapped[str | None] = mapped_column(String, nullable=True)
    posting_frequency: Mapped[str | None] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    drafts: Mapped[list["Draft"]] = relationship(
        back_populates="business",
    )


class Draft(Base):
    __tablename__ = "drafts"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    business_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("businesses.id"),
        nullable=True,
    )

    publish_destinations: Mapped[list[str]] = mapped_column(
        JSON,
        nullable=False,
        default=lambda: ["facebook"],
    )

    # Facebook publishing
    facebook_post_id: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    facebook_publish_status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default="not_published",
        server_default="not_published",
    )

    tiktok_publish_status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default="not_published",
        server_default="not_published",
    )

    tiktok_publish_id: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    tiktok_account_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("social_accounts.id"),
        nullable=True,
    )

    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    title: Mapped[str] = mapped_column(String)
    caption: Mapped[str] = mapped_column(String)
    platform: Mapped[str] = mapped_column(String)
    media_type: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default="text",
        server_default="text",
    )

    status: Mapped[str] = mapped_column(
        String,
        default="pending",
    )

    source: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default="manual",
    )

    # AI-generated marketing image
    image_prompt: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    # Script for HeyGen video creation
    video_script: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    # Private Supabase Storage path, not a public URL
    image_url: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    # HeyGen-generated marketing video
    video_url: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    video_generation_id: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    video_status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default="not_started",
        server_default="not_started",
    )

    image_status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default="not_started",
        server_default="not_started",
    )

    image_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    image_generation_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    business: Mapped["Business | None"] = relationship(
        back_populates="drafts",
    )

    image_revisions: Mapped[list["ImageRevision"]] = relationship(
        back_populates="draft",
    )


class ImageRevision(Base):
    """
    A proposed AI edit of an existing draft image.

    The original image is not replaced until the revision
    is explicitly accepted.
    """

    __tablename__ = "image_revisions"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    draft_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("drafts.id"),
        nullable=False,
        index=True,
    )

    # Storage path of the image used as the reference
    original_image_path: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    # Storage path of the proposed edited image
    revised_image_path: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    # Ángela's instructions, which may be written in Spanish
    instructions: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    # generating, ready, accepted, rejected, failed
    status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default="generating",
        server_default="generating",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    draft: Mapped["Draft"] = relationship(
        back_populates="image_revisions",
    )


class SocialAccount(Base):
    __tablename__ = "social_accounts"

    __table_args__ = (
        UniqueConstraint(
            "business_id",
            "platform",
            "platform_account_id",
            name="uq_social_accounts_business_platform_account",
        ),
    )

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    business_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("businesses.id"),
        nullable=False,
        index=True,
    )

    platform: Mapped[str] = mapped_column(String, nullable=False)

    platform_account_id: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    account_name: Mapped[str] = mapped_column(String, nullable=False)

    encrypted_access_token: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    encrypted_refresh_token: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    token_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    connection_status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default="connected",
        server_default="connected",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    business: Mapped["Business"] = relationship()


class FacebookOAuthState(Base):
    __tablename__ = "facebook_oauth_states"

    state_hash: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
    )

    business_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("businesses.id"),
        nullable=False,
    )

    user_id: Mapped[str] = mapped_column(
        String(36),
        nullable=False,
    )

    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    encrypted_pages: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    selection_token_hash: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        unique=True,
    )


class Conversation(Base):
    """A conversation with Sofía for a specific business."""

    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    business_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("businesses.id"),
        nullable=False,
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    business: Mapped["Business"] = relationship()

    messages: Mapped[list["ConversationMessage"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
    )


class ConversationMessage(Base):
    """One message sent by the owner or Sofía."""

    __tablename__ = "conversation_messages"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    conversation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("conversations.id"),
        nullable=False,
        index=True,
    )

    # "user" or "assistant"
    role: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )

    content: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    conversation: Mapped["Conversation"] = relationship(
        back_populates="messages",
    )


class TikTokOAuthState(Base):
    __tablename__ = "tiktok_oauth_states"

    state_hash: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
    )

    business_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("businesses.id"),
        nullable=False,
    )

    user_id: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

import os
from uuid import UUID, uuid4

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(".env")

MAX_IMAGE_SIZE = 20 * 1024 * 1024  # 20 MB
MAX_VIDEO_SIZE = 100 * 1024 * 1024  # 100 MB


def get_storage_client():
    """Create a Supabase client with server-side credentials."""

    return create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SECRET_KEY"],
    )


def _validate_image_path(
        storage_path: str,
        business_id: str,
) -> str:
    """
    Ensure the requested image belongs to the expected
    business storage directory.

    Note: The API must independently verify that the
    authenticated user owns or can access this business.
    """

    if not business_id or not business_id.strip():
        raise ValueError("Business ID cannot be empty.")

    try:
        UUID(business_id)
    except (ValueError, TypeError):
        raise ValueError("Invalid business ID.") from None

    if not isinstance(storage_path, str):
        raise ValueError("Invalid image storage path.")

    expected_prefix = f"businesses/{business_id}/"

    if not storage_path.startswith(expected_prefix):
        raise ValueError(
            "Image does not belong to the specified business."
        )

    filename = storage_path[len(expected_prefix):]

    if (
            not filename
            or "/" in filename
            or "\\" in filename
            or filename in {".", ".."}
    ):
        raise ValueError("Invalid image storage path.")

    if not filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        raise ValueError("Unsupported image file extension.")

    return storage_path


def upload_marketing_image(
        image_bytes: bytes,
        business_id: str,
        content_type: str = "image/png",
) -> str:
    """Upload an image and return its private storage path."""

    if not image_bytes:
        raise ValueError("Image data cannot be empty.")

    if len(image_bytes) > MAX_IMAGE_SIZE:
        raise ValueError("Image exceeds the 20 MB size limit.")

    extensions = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
    }

    if content_type not in extensions:
        raise ValueError("Unsupported image format.")

    if not business_id or not business_id.strip():
        raise ValueError("Business ID cannot be empty.")

    try:
        UUID(business_id)
    except (ValueError, TypeError):
        raise ValueError("Invalid business ID.") from None

    extension = extensions[content_type]

    storage_path = (
        f"businesses/{business_id}/{uuid4()}.{extension}"
    )

    client = get_storage_client()
    bucket = os.environ["SUPABASE_STORAGE_BUCKET"]

    client.storage.from_(bucket).upload(
        path=storage_path,
        file=image_bytes,
        file_options={
            "content-type": content_type,
            "upsert": "false",
        },
    )

    return storage_path


def download_marketing_image(
        storage_path: str,
        business_id: str,
) -> bytes:
    """
    Download an original image from private Supabase Storage.

    The path must belong to the specified business.

    Returns:
        Raw image bytes suitable for OpenAI image editing.
    """

    validated_path = _validate_image_path(
        storage_path=storage_path,
        business_id=business_id,
    )

    client = get_storage_client()
    bucket = os.environ["SUPABASE_STORAGE_BUCKET"]

    image_bytes = client.storage.from_(bucket).download(
        validated_path
    )

    if not isinstance(image_bytes, bytes):
        raise ValueError(
            "Supabase did not return valid image bytes."
        )

    if not image_bytes:
        raise ValueError("Downloaded image is empty.")

    if len(image_bytes) > MAX_IMAGE_SIZE:
        raise ValueError(
            "Downloaded image exceeds the 20 MB size limit."
        )

    return image_bytes


def get_marketing_image_url(
        storage_path: str,
        expires_in: int = 3600,
) -> str:
    """Create a temporary URL for viewing a private image."""

    if not storage_path or not storage_path.strip():
        raise ValueError("Image storage path cannot be empty.")

    if expires_in < 1 or expires_in > 3600:
        raise ValueError(
            "URL expiration must be between 1 and 3600 seconds."
        )

    client = get_storage_client()
    bucket = os.environ["SUPABASE_STORAGE_BUCKET"]

    response = client.storage.from_(bucket).create_signed_url(
        path=storage_path,
        expires_in=expires_in,
    )

    return response["signedURL"]


def upload_marketing_video(
        video_bytes: bytes,
        business_id: str,
        *,
        storage_path: str | None = None,
        upsert: bool = False,
) -> str:
    """Upload an MP4 video to private Supabase storage."""

    if not video_bytes:
        raise ValueError("Video data cannot be empty.")

    if len(video_bytes) > MAX_VIDEO_SIZE:
        raise ValueError("Video exceeds the 100 MB limit.")

    # Basic MP4 container signature check.
    if video_bytes[4:8] != b"ftyp":
        raise ValueError("Invalid MP4 video format.")

    try:
        UUID(business_id)
    except (ValueError, TypeError, AttributeError):
        raise ValueError("Invalid business ID.") from None

    if storage_path is None:
        storage_path = f"businesses/{business_id}/{uuid4()}.mp4"
    else:
        prefix = f"businesses/{business_id}/"
        suffix = storage_path[len(prefix):] if storage_path.startswith(prefix) else ""
        if (
            not suffix
            or any(part in {"", ".", ".."} for part in suffix.split("/"))
            or "\\" in suffix
            or not suffix.lower().endswith(".mp4")
        ):
            raise ValueError("Invalid video storage path.")

    client = get_storage_client()
    bucket = os.environ["SUPABASE_STORAGE_BUCKET"]

    client.storage.from_(bucket).upload(
        path=storage_path,
        file=video_bytes,
        file_options={
            "content-type": "video/mp4",
            "upsert": "true" if upsert else "false",
        },
    )

    return storage_path

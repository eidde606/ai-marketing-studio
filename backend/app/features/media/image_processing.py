"""Image validation and normalization for Instagram feed publishing."""

import warnings
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

from app.storage_service import MAX_IMAGE_SIZE

MAX_INPUT_IMAGE_BYTES = MAX_IMAGE_SIZE
MAX_INSTAGRAM_IMAGE_BYTES = 8 * 1024 * 1024
MIN_INSTAGRAM_IMAGE_WIDTH = 320
MAX_INSTAGRAM_IMAGE_WIDTH = 1440
MIN_INSTAGRAM_ASPECT_RATIO = 4 / 5
MAX_INSTAGRAM_ASPECT_RATIO = 1.91
MAX_IMAGE_PIXELS = 40_000_000
SUPPORTED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}


class ImageValidationError(ValueError):
    """Image bytes cannot be safely used as an Instagram feed image."""


def _open_image(image_bytes: bytes, *, max_bytes: int) -> Image.Image:
    if not isinstance(image_bytes, bytes) or not image_bytes:
        raise ImageValidationError("Image data cannot be empty.")
    if len(image_bytes) > max_bytes:
        raise ImageValidationError("Image exceeds the allowed size limit.")

    image = None
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            image = Image.open(BytesIO(image_bytes))
            if image.format not in SUPPORTED_IMAGE_FORMATS:
                raise ImageValidationError(
                    "Only JPEG, PNG, and WebP images are supported."
                )
            if getattr(image, "n_frames", 1) != 1:
                raise ImageValidationError(
                    "Animated images are not supported."
                )
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise ImageValidationError(
                    "Image dimensions exceed the supported limit."
                )
            image.load()
            image_format = image.format
            oriented = ImageOps.exif_transpose(image)
            if oriented is image:
                oriented = image.copy()
            oriented.format = image_format
            return oriented
    except ImageValidationError:
        raise
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        OSError,
        UnidentifiedImageError,
        ValueError,
    ) as exc:
        raise ImageValidationError(
            "Upload a valid JPEG, PNG, or WebP image."
        ) from exc
    finally:
        if image is not None:
            image.close()


def _validate_instagram_dimensions(image: Image.Image) -> None:
    width, height = image.size
    ratio = width / height
    if width < MIN_INSTAGRAM_IMAGE_WIDTH:
        raise ImageValidationError(
            "Instagram images must be at least 320 pixels wide."
        )
    if not MIN_INSTAGRAM_ASPECT_RATIO <= ratio <= MAX_INSTAGRAM_ASPECT_RATIO:
        raise ImageValidationError(
            "Instagram image aspect ratio must be between 4:5 and 1.91:1."
        )


def validate_instagram_jpeg(image_bytes: bytes) -> None:
    """Reject JPEGs that do not meet Instagram feed image constraints."""
    if len(image_bytes) > MAX_INSTAGRAM_IMAGE_BYTES:
        raise ImageValidationError(
            "Instagram images must be 8 MB or smaller."
        )
    image = _open_image(image_bytes, max_bytes=MAX_INSTAGRAM_IMAGE_BYTES)
    try:
        if image.format != "JPEG":
            raise ImageValidationError("Instagram publishing requires a JPEG.")
        if image.width > MAX_INSTAGRAM_IMAGE_WIDTH:
            raise ImageValidationError(
                "Instagram image width cannot exceed 1,440 pixels."
            )
        _validate_instagram_dimensions(image)
    finally:
        image.close()


def image_file_extension(image_bytes: bytes) -> str:
    """Return a safe suffix derived from decoded image bytes."""
    image = _open_image(image_bytes, max_bytes=MAX_INPUT_IMAGE_BYTES)
    try:
        return {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}[image.format]
    finally:
        image.close()


def normalize_instagram_jpeg(image_bytes: bytes) -> bytes:
    """Validate, orient, flatten, resize, and encode one feed-ready JPEG."""
    image = _open_image(image_bytes, max_bytes=MAX_INPUT_IMAGE_BYTES)
    try:
        _validate_instagram_dimensions(image)
        if image.width > MAX_INSTAGRAM_IMAGE_WIDTH:
            height = round(
                image.height * MAX_INSTAGRAM_IMAGE_WIDTH / image.width
            )
            resized = image.resize(
                (MAX_INSTAGRAM_IMAGE_WIDTH, height),
                Image.Resampling.LANCZOS,
            )
            image.close()
            image = resized

        if "A" in image.getbands() or "transparency" in image.info:
            rgba = image.convert("RGBA")
            flattened = Image.new("RGB", rgba.size, (255, 255, 255))
            flattened.paste(rgba, mask=rgba.getchannel("A"))
            rgba.close()
            image.close()
            image = flattened
        else:
            converted = image.convert("RGB")
            image.close()
            image = converted

        while True:
            for quality in (92, 88, 84, 80, 76):
                output = BytesIO()
                image.save(
                    output,
                    format="JPEG",
                    quality=quality,
                    optimize=True,
                    progressive=True,
                )
                encoded = output.getvalue()
                if len(encoded) <= MAX_INSTAGRAM_IMAGE_BYTES:
                    validate_instagram_jpeg(encoded)
                    return encoded

            next_width = max(MIN_INSTAGRAM_IMAGE_WIDTH, int(image.width * 0.85))
            if next_width == image.width:
                raise ImageValidationError(
                    "Image could not be compressed to Instagram's 8 MB limit."
                )
            next_height = round(image.height * next_width / image.width)
            resized = image.resize(
                (next_width, next_height),
                Image.Resampling.LANCZOS,
            )
            image.close()
            image = resized

    finally:
        image.close()

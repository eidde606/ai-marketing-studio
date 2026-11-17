import base64
from io import BytesIO

import pytest
from PIL import Image

from app.features.media.image_processing import (
    MAX_INPUT_IMAGE_BYTES,
    MAX_INSTAGRAM_IMAGE_BYTES,
    ImageValidationError,
    image_file_extension,
    normalize_instagram_jpeg,
    validate_instagram_jpeg,
)


def image_bytes(image_format="PNG", size=(640, 480), *, color=(120, 80, 40, 255)):
    image = Image.new("RGBA", size, color)
    output = BytesIO()
    image.save(output, format=image_format)
    return output.getvalue()


def test_png_transparency_is_flattened_to_jpeg():
    source = image_bytes(color=(255, 0, 0, 0))

    result = normalize_instagram_jpeg(source)

    validate_instagram_jpeg(result)
    with Image.open(BytesIO(result)) as converted:
        assert converted.format == "JPEG"
        assert converted.getpixel((0, 0))[0] > 240
        assert converted.getpixel((0, 0))[1] > 240
        assert converted.getpixel((0, 0))[2] > 240


def test_webp_is_converted_and_jpeg_orientation_is_corrected():
    webp = image_bytes("WEBP")
    oriented = Image.new("RGB", (400, 600), "blue")
    exif = oriented.getexif()
    exif[274] = 6
    raw_jpeg = BytesIO()
    oriented.save(raw_jpeg, format="JPEG", exif=exif)

    assert normalize_instagram_jpeg(webp).startswith(b"\xff\xd8\xff")
    assert image_file_extension(webp) == "webp"
    with Image.open(BytesIO(normalize_instagram_jpeg(raw_jpeg.getvalue()))) as result:
        assert result.size == (600, 400)


@pytest.mark.parametrize(
    "source",
    [
        b"not an image",
        image_bytes("PNG", (319, 480)),
        image_bytes("PNG", (640, 1000)),
    ],
)
def test_invalid_or_incompatible_images_are_rejected(source):
    with pytest.raises(ImageValidationError):
        normalize_instagram_jpeg(source)


def test_oversized_input_and_jpeg_output_are_bounded():
    with pytest.raises(ImageValidationError, match="size limit"):
        normalize_instagram_jpeg(b"x" * (MAX_INPUT_IMAGE_BYTES + 1))

    encoded = normalize_instagram_jpeg(image_bytes())
    assert len(encoded) <= MAX_INSTAGRAM_IMAGE_BYTES
    assert encoded.startswith(b"\xff\xd8\xff")


def test_large_valid_images_are_resized_to_instagram_width():
    converted = normalize_instagram_jpeg(
        image_bytes(size=(2000, 1200), color=(40, 100, 180, 255))
    )
    with Image.open(BytesIO(converted)) as image:
        assert image.width == 1440
        assert image.height == 864
    with pytest.raises(ImageValidationError, match="8 MB"):
        validate_instagram_jpeg(b"x" * (MAX_INSTAGRAM_IMAGE_BYTES + 1))


def test_generated_png_is_stored_as_jpeg(monkeypatch):
    from app.features.media import image_provider

    stored = {}

    def upload(**kwargs):
        stored.update(kwargs)
        return "businesses/00000000-0000-0000-0000-000000000001/image.jpg"

    monkeypatch.setattr(image_provider, "upload_marketing_image", upload)
    result = image_provider._save_generated_image(
        base64.b64encode(image_bytes()).decode("ascii"),
        "00000000-0000-0000-0000-000000000001",
    )

    assert result.endswith(".jpg")
    assert stored["content_type"] == "image/jpeg"
    validate_instagram_jpeg(stored["image_bytes"])

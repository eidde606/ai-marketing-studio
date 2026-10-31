import base64
import os
from io import BytesIO

from dotenv import load_dotenv
from openai import OpenAI

from app.storage_service import upload_marketing_image

load_dotenv(".env")

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])


def _save_generated_image(
    image_base64: str,
    business_id: str,
) -> str:
    """Decode an OpenAI image and upload it to private Supabase Storage."""

    if not image_base64:
        raise ValueError("OpenAI did not return image data.")

    image_bytes = base64.b64decode(image_base64, validate=True)

    if not image_bytes:
        raise ValueError("Decoded image data is empty.")

    return upload_marketing_image(
        image_bytes=image_bytes,
        business_id=business_id,
        content_type="image/png",
    )


def generate_marketing_image(
    image_prompt: str,
    business_id: str,
) -> str:
    """Generate a new image and return its private Supabase storage path."""

    if not image_prompt or not image_prompt.strip():
        raise ValueError("Image prompt cannot be empty.")

    if not business_id or not business_id.strip():
        raise ValueError("Business ID cannot be empty.")

    result = client.images.generate(
        model="gpt-image-2.5-flare",
        prompt=image_prompt.strip(),
        size="1024x1024",
        quality="medium",
    )

    if not result.data or not result.data[0].b64_json:
        raise ValueError("OpenAI did not return image data.")

    return _save_generated_image(
        image_base64=result.data[0].b64_json,
        business_id=business_id,
    )


def edit_marketing_image(
    original_image_bytes: bytes,
    edit_instructions: str,
    business_id: str,
) -> str:
    """
    Edit an existing marketing image using OpenAI.

    The original image is used as a visual reference.
    The edited image is uploaded as a NEW private storage object.

    Returns:
        Storage path of the newly generated image.

    Important:
        This function does not replace or delete the original image.
    """

    if not original_image_bytes:
        raise ValueError("Original image cannot be empty.")

    if not edit_instructions or not edit_instructions.strip():
        raise ValueError("Editing instructions cannot be empty.")

    if not business_id or not business_id.strip():
        raise ValueError("Business ID cannot be empty.")

    if len(edit_instructions) > 1000:
        raise ValueError("Editing instructions exceed 1000 characters.")

    # OpenAI accepts image uploads as file-like objects.
    original_image = BytesIO(original_image_bytes)
    original_image.name = "original.png"

    prompt = (
        "Edit the supplied marketing image according to the "
        "following instructions. Preserve the original image's "
        "main subject, product identity, and recognizable details "
        "unless the user explicitly requests a change. "
        "Make the result visually appealing and suitable for "
        "professional social media marketing. "
        "Do not add text, logos, or watermarks unless requested. "
        "Follow these editing instructions, which may be in Spanish:\n\n"
        f"{edit_instructions.strip()}"
    )

    result = client.images.edit(
        model="gpt-image-2.5-flare",
        image=original_image,
        prompt=prompt,
        size="1024x1024",
        quality="medium",
    )

    if not result.data or not result.data[0].b64_json:
        raise ValueError("OpenAI did not return an edited image.")

    return _save_generated_image(
        image_base64=result.data[0].b64_json,
        business_id=business_id,
    )

import os

from cryptography.fernet import Fernet, InvalidToken


def get_cipher() -> Fernet:
    key = os.getenv("TOKEN_ENCRYPTION_KEY")

    if not key:
        raise RuntimeError("TOKEN_ENCRYPTION_KEY is not configured")

    return Fernet(key.encode("utf-8"))


def encrypt_token(token: str) -> str:
    """Encrypt a social media access token before storage."""
    if not token:
        raise ValueError("Cannot encrypt an empty token")

    return get_cipher().encrypt(
        token.encode("utf-8")
    ).decode("utf-8")


def decrypt_token(encrypted_token: str) -> str:
    """Decrypt a stored token for authorized backend operations."""
    try:
        return get_cipher().decrypt(
            encrypted_token.encode("utf-8")
        ).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("Unable to decrypt access token") from exc
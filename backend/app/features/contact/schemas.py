import re
from email.errors import HeaderParseError
from email.headerregistry import Address
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


ContactCategory = Literal[
    "general",
    "technical",
    "billing",
    "privacy",
    "problem",
]


class ContactSubmission(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=254)
    category: ContactCategory
    message: str = Field(min_length=10, max_length=5000)
    website: str = Field(default="", max_length=500)

    @field_validator("name", "email", "message", mode="before")
    @classmethod
    def trim_text(cls, value):
        if not isinstance(value, str):
            return value
        return value.strip()

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("Name contains invalid control characters")
        return value

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        if any(ord(character) < 33 or ord(character) == 127 for character in value):
            raise ValueError("Email contains invalid characters")
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("Email address is invalid")
        try:
            parsed = Address(addr_spec=value)
        except (ValueError, HeaderParseError):
            raise ValueError("Email address is invalid") from None
        if parsed.addr_spec != value:
            raise ValueError("Email address is invalid")
        return value

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str) -> str:
        if any(
            (ord(character) < 32 and character not in "\n\r\t")
            or ord(character) == 127
            for character in value
        ):
            raise ValueError("Message contains invalid control characters")
        return value

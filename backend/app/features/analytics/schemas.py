from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class EdianAnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    locale: Literal["en", "es"]
    idempotency_key: str = Field(min_length=1, max_length=128)

    @field_validator("idempotency_key")
    @classmethod
    def validate_idempotency_key(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("A valid idempotency key is required")
        return normalized

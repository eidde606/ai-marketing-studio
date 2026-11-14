from pydantic import BaseModel, Field, ConfigDict
from app.features.accounts.schemas import Language


class SofiaChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = None
    conversation_language: Language | None = None


class AIGenerationRequest(BaseModel):
    """Language overrides do not grant access or select a different tenant."""
    model_config = ConfigDict(extra="forbid")
    conversation_language: Language | None = None
    marketing_content_language: Language | None = None

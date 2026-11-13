from pydantic import BaseModel, Field, ConfigDict


class SofiaChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = None


class AIGenerationRequest(BaseModel):
    """No structured resource references beyond the route's business/conversation."""
    model_config = ConfigDict(extra="forbid")

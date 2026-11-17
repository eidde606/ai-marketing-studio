from typing import Literal
from pydantic import BaseModel, ConfigDict


class MembershipUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["owner", "admin", "member"]
    status: Literal["active", "suspended", "revoked"]

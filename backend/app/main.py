from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from uuid import uuid4

app = FastAPI()


class DraftCreate(BaseModel):
    title: str
    caption: str
    platform: str


class Draft(BaseModel):
    id: str
    title: str
    caption: str
    platform: str
    status: str = "pending"


drafts: dict[str, Draft] = {}


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.post("/drafts", response_model=Draft)
def create_draft(request: DraftCreate):
    draft = Draft(id=str(uuid4()), **request.model_dump())
    drafts[draft.id] = draft
    return draft


@app.get("/drafts", response_model=list[Draft])
def list_drafts():
    return list(drafts.values())


@app.patch("/drafts/{draft_id}/approve", response_model=Draft)
def approve_draft(draft_id: str):
    draft = drafts.get(draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    draft.status = "approved"
    return draft

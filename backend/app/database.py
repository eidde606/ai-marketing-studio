from pathlib import Path
import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker


_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(_ENV_FILE)

_database_url = os.getenv("DATABASE_URL")
if not _database_url or not _database_url.strip():
    raise RuntimeError("DATABASE_URL must be configured in backend/.env")

_database_url = _database_url.strip()
if _database_url.startswith("postgresql://"):
    _database_url = _database_url.replace("postgresql://", "postgresql+psycopg://", 1)
elif _database_url.startswith("postgres://"):
    _database_url = _database_url.replace("postgres://", "postgresql+psycopg://", 1)
elif _database_url.startswith("postgresql+psycopg2://"):
    _database_url = _database_url.replace(
        "postgresql+psycopg2://", "postgresql+psycopg://", 1
    )

engine = create_engine(_database_url)
SessionLocal = sessionmaker(bind=engine, class_=Session, autoflush=False, autocommit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

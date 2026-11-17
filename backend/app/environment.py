import os
from pathlib import Path

from dotenv import load_dotenv


def is_development_environment() -> bool:
    return os.getenv("AI_MARKETING_STUDIO_ENV", "").strip().lower() == "development"


def load_application_environment(path: str | Path | None = None) -> bool:
    if is_development_environment():
        os.environ["PYTHON_DOTENV_DISABLED"] = "1"
        return False
    return load_dotenv(path)

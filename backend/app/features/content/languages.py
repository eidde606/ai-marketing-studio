"""Validated language names for provider instructions, independent of UI locale."""
def language_name(value: str) -> str:
    if value not in {"en", "es"}:
        raise ValueError("Unsupported language")
    return {"en": "English", "es": "Spanish"}[value]

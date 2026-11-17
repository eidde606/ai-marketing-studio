import json
import os
import subprocess
import sys
from pathlib import Path

from app.environment import load_application_environment


def test_development_skips_dotenv_fallback(tmp_path, monkeypatch):
    env_file = tmp_path / "production.env"
    env_file.write_text("PRODUCTION_ONLY_CREDENTIAL=production-secret\n")
    monkeypatch.setenv("AI_MARKETING_STUDIO_ENV", "development")
    monkeypatch.delenv("PYTHON_DOTENV_DISABLED", raising=False)
    monkeypatch.delenv("PRODUCTION_ONLY_CREDENTIAL", raising=False)

    loaded = load_application_environment(env_file)

    assert loaded is False
    assert "PRODUCTION_ONLY_CREDENTIAL" not in os.environ
    assert os.environ["PYTHON_DOTENV_DISABLED"] == "1"


def test_non_development_keeps_dotenv_loading(tmp_path, monkeypatch):
    env_file = tmp_path / "production.env"
    env_file.write_text("PRODUCTION_ONLY_CREDENTIAL=production-secret\n")
    monkeypatch.delenv("AI_MARKETING_STUDIO_ENV", raising=False)
    monkeypatch.delenv("PYTHON_DOTENV_DISABLED", raising=False)
    monkeypatch.delenv("PRODUCTION_ONLY_CREDENTIAL", raising=False)

    loaded = load_application_environment(env_file)

    assert loaded is True
    assert os.environ["PRODUCTION_ONLY_CREDENTIAL"] == "production-secret"


def test_development_launcher_discards_inherited_production_configuration(tmp_path):
    helper = Path(__file__).resolve().parents[1] / "dev_environment.sh"
    env_file = tmp_path / ".env.development.local"
    env_file.write_text(
        "DATABASE_URL=postgresql+psycopg://dev@localhost/ai_marketing_studio_dev\n"
        "SUPABASE_URL=https://development.supabase.test\n"
        "SUPABASE_PUBLISHABLE_KEY=sb_publishable_development\n"
        "OPENAI_API_KEY=development-openai-key\n"
    )
    probe = (
        "import json, os; "
        "keys = ('DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', "
        "'OPENAI_API_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_ANON_KEY', "
        "'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'FACEBOOK_CONFIG_ID', "
        "'FACEBOOK_REDIRECT_URI', "
        "'FACEBOOK_PAGE_ID', 'FACEBOOK_PAGE_ACCESS_TOKEN', "
        "'INSTAGRAM_CONFIG_ID', 'INSTAGRAM_REDIRECT_URI', "
        "'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REDIRECT_URI', "
        "'TIKTOK_FRONTEND_REDIRECT_URL', 'TIKTOK_DIRECT_PUBLISHING_ENABLED', "
        "'HEYGEN_API_KEY', "
        "'HEYGEN_WEBHOOK_SECRET', 'HEYGEN_BUSINESS_ALLOWANCES', "
        "'STRIPE_SECRET_KEY', 'STRIPE_MONTHLY_PRICE_ID', "
        "'STRIPE_WEBHOOK_SECRET', 'TOKEN_ENCRYPTION_KEY', 'ALLOWED_USER_ID', "
        "'AI_MARKETING_STUDIO_ENV', 'PYTHON_DOTENV_DISABLED'); "
        "print(json.dumps({key: os.environ.get(key) for key in keys}))"
    )
    command = (
        'source "$1"; '
        'load_development_environment "$2"; '
        '"$3" -c "$4"'
    )
    inherited_environment = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": str(Path.home()),
        "DATABASE_URL": "production-database-url",
        "SUPABASE_URL": "https://production.supabase.test",
        "SUPABASE_PUBLISHABLE_KEY": "production-publishable-key",
        "OPENAI_API_KEY": "production-openai-key",
        "SUPABASE_SECRET_KEY": "production-supabase-secret",
        "SUPABASE_ANON_KEY": "production-supabase-anon-key",
        "FACEBOOK_APP_ID": "production-facebook-app-id",
        "FACEBOOK_APP_SECRET": "production-facebook-secret",
        "FACEBOOK_CONFIG_ID": "production-facebook-config",
        "FACEBOOK_REDIRECT_URI": "https://production.test/facebook/callback",
        "FACEBOOK_PAGE_ID": "production-facebook-page",
        "FACEBOOK_PAGE_ACCESS_TOKEN": "production-facebook-page-token",
        "INSTAGRAM_CONFIG_ID": "production-instagram-config",
        "INSTAGRAM_REDIRECT_URI": "https://production.test/instagram/callback",
        "TIKTOK_CLIENT_KEY": "production-tiktok-key",
        "TIKTOK_CLIENT_SECRET": "production-tiktok-secret",
        "TIKTOK_REDIRECT_URI": "https://production.test/tiktok/callback",
        "TIKTOK_FRONTEND_REDIRECT_URL": "https://production.test",
        "TIKTOK_DIRECT_PUBLISHING_ENABLED": "1",
        "HEYGEN_API_KEY": "production-heygen-key",
        "HEYGEN_WEBHOOK_SECRET": "production-heygen-webhook-secret",
        "HEYGEN_BUSINESS_ALLOWANCES": '{"production-business":{}}',
        "STRIPE_SECRET_KEY": "production-stripe-key",
        "STRIPE_MONTHLY_PRICE_ID": "production-stripe-price",
        "STRIPE_WEBHOOK_SECRET": "production-stripe-webhook-secret",
        "TOKEN_ENCRYPTION_KEY": "production-token-key",
        "ALLOWED_USER_ID": "production-user-id",
    }

    result = subprocess.run(
        [
            "bash",
            "-c",
            command,
            "bash",
            str(helper),
            str(env_file),
            sys.executable,
            probe,
        ],
        check=True,
        capture_output=True,
        text=True,
        env=inherited_environment,
    )
    configuration = json.loads(result.stdout)

    assert configuration == {
        "DATABASE_URL": "postgresql+psycopg://dev@localhost/ai_marketing_studio_dev",
        "SUPABASE_URL": "https://development.supabase.test",
        "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_development",
        "OPENAI_API_KEY": "development-openai-key",
        "SUPABASE_SECRET_KEY": None,
        "SUPABASE_ANON_KEY": None,
        "FACEBOOK_APP_ID": None,
        "FACEBOOK_APP_SECRET": None,
        "FACEBOOK_CONFIG_ID": None,
        "FACEBOOK_REDIRECT_URI": None,
        "FACEBOOK_PAGE_ID": None,
        "FACEBOOK_PAGE_ACCESS_TOKEN": None,
        "INSTAGRAM_CONFIG_ID": None,
        "INSTAGRAM_REDIRECT_URI": None,
        "TIKTOK_CLIENT_KEY": None,
        "TIKTOK_CLIENT_SECRET": None,
        "TIKTOK_REDIRECT_URI": None,
        "TIKTOK_FRONTEND_REDIRECT_URL": None,
        "TIKTOK_DIRECT_PUBLISHING_ENABLED": None,
        "HEYGEN_API_KEY": None,
        "HEYGEN_WEBHOOK_SECRET": None,
        "HEYGEN_BUSINESS_ALLOWANCES": None,
        "STRIPE_SECRET_KEY": None,
        "STRIPE_MONTHLY_PRICE_ID": None,
        "STRIPE_WEBHOOK_SECRET": None,
        "TOKEN_ENCRYPTION_KEY": None,
        "ALLOWED_USER_ID": None,
        "AI_MARKETING_STUDIO_ENV": "development",
        "PYTHON_DOTENV_DISABLED": "1",
    }

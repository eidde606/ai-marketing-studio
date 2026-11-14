import { Eye, EyeOff, LockKeyhole, Mail, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useLocalization } from "../app/localization";
import { supabase } from "../services/supabaseClient";

type AuthMode = "login" | "forgot" | "reset";

type AuthPageProps = {
  recoveryMode?: boolean;
  onRecoveryComplete?: () => void;
};

export default function AuthPage({
  recoveryMode = false,
  onRecoveryComplete,
}: AuthPageProps) {
  const { locale, setInterfaceLanguage, t } = useLocalization();
  const [mode, setMode] = useState<AuthMode>(recoveryMode ? "reset" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const currentMode = recoveryMode ? "reset" : mode;

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setPassword("");
    setError("");
    setMessage("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      if (currentMode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });

        if (error) throw error;

        setMessage(t("auth.resetLinkSent"));
      } else if (currentMode === "reset") {
        if (password.length < 12) {
          throw new Error(t("auth.passwordMin"));
        }

        const { error } = await supabase.auth.updateUser({
          password,
        });

        if (error) throw error;

        setPassword("");
        onRecoveryComplete?.();
        setMessage(t("auth.passwordSaved"));
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(
        message === t("auth.passwordMin")
          ? message
          : currentMode === "login"
            ? t("auth.signInError")
            : t("auth.unknownError"),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 lg:grid lg:grid-cols-2">
      <div className="fixed right-4 top-4 z-20 rounded-lg border border-white/15 bg-slate-950/60 p-2 text-sm text-white shadow-lg backdrop-blur sm:right-6 sm:top-6">
        <label className="sr-only" htmlFor="auth-language">
          {t("language.choose")}
        </label>
        <select
          id="auth-language"
          value={locale}
          onChange={(event) =>
            void setInterfaceLanguage(event.target.value as "en" | "es")
          }
          className="cursor-pointer rounded-md bg-transparent px-2 py-1 text-white outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
        >
          <option value="en" className="text-slate-900">
            {t("common.english")}
          </option>
          <option value="es" className="text-slate-900">
            {t("common.spanish")}
          </option>
        </select>
      </div>
      <section className="relative flex flex-col justify-between overflow-hidden bg-gradient-to-br from-violet-950 via-violet-800 to-fuchsia-700 px-6 py-8 text-white lg:p-14">
        <div className="absolute -right-32 top-20 h-96 w-96 rounded-full bg-fuchsia-400/20 blur-3xl" />
        <div className="absolute -bottom-32 left-0 h-96 w-96 rounded-full bg-violet-300/20 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <div className="rounded-xl bg-white/15 p-3">
            <Sparkles size={24} />
          </div>
          <span className="text-xl font-bold">AI Marketing Studio</span>
        </div>

        <div className="relative max-w-lg">
          <p className="mb-5 text-sm font-semibold uppercase tracking-[0.25em] text-violet-200">
            {t("auth.creativeSpace")}
          </p>
          <h1 className="whitespace-pre-line text-5xl font-bold leading-tight">
            {t("auth.heroHeadline")}
          </h1>
          <p className="mt-6 text-lg leading-8 text-violet-100">
            {t("auth.heroDescription")}
          </p>
        </div>

        <p className="relative text-sm text-violet-200">
          © {new Date().getFullYear()} AI Marketing Studio
        </p>
      </section>

      <section className="flex min-h-[70vh] items-center justify-center bg-slate-50 px-5 py-12 sm:px-10 lg:min-h-screen">
        <div className="w-full max-w-md">
          <div className="mb-9 lg:hidden">
            <div className="mb-4 inline-flex rounded-xl bg-violet-600 p-3 text-white">
              <Sparkles size={25} />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">
              AI Marketing Studio
            </h1>
          </div>

          <div className="mb-9">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">
              {currentMode === "login"
                ? t("auth.welcome")
                : currentMode === "forgot"
                  ? t("auth.recover")
                  : t("auth.newPassword")}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              {currentMode === "login"
                ? t("auth.continue")
                : currentMode === "forgot"
                  ? t("auth.recoverHelp")
                  : t("auth.newPasswordHelp")}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {currentMode !== "reset" && (
              <div>
                <label
                  htmlFor="auth-email"
                  className="mb-2 block text-sm font-semibold text-slate-700"
                >
                  {t("auth.email")}
                </label>
                <div className="relative">
                  <Mail
                    className="absolute left-4 top-3.5 text-slate-400"
                    size={19}
                  />
                  <input
                    id="auth-email"
                    type="email"
                    autoComplete="email"
                    placeholder={t("auth.emailPlaceholder")}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-12 pr-4 text-slate-900 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                  />
                </div>
              </div>
            )}

            {currentMode !== "forgot" && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label
                    htmlFor="auth-password"
                    className="text-sm font-semibold text-slate-700"
                  >
                    {currentMode === "reset"
                      ? t("auth.passwordNew")
                      : t("auth.password")}
                  </label>
                  {currentMode === "login" && (
                    <button
                      type="button"
                      onClick={() => switchMode("forgot")}
                      className="text-sm font-semibold text-violet-700 hover:text-violet-900"
                    >
                      {t("auth.forgot")}
                    </button>
                  )}
                </div>

                <div className="relative">
                  <LockKeyhole
                    className="absolute left-4 top-3.5 text-slate-400"
                    size={19}
                  />
                  <input
                    id="auth-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={
                      currentMode === "reset"
                        ? "new-password"
                        : "current-password"
                    }
                    minLength={currentMode === "reset" ? 12 : undefined}
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-12 pr-12 text-slate-900 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={
                      showPassword
                        ? t("auth.hidePassword")
                        : t("auth.showPassword")
                    }
                    className="absolute right-4 top-3.5 text-slate-400 hover:text-slate-700"
                  >
                    {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <p
                role="alert"
                className="rounded-xl bg-red-50 p-4 text-sm text-red-700"
              >
                {error}
              </p>
            )}

            {message && (
              <p
                role="status"
                className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700"
              >
                {message}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-violet-700 px-5 py-3.5 font-semibold text-white shadow-lg shadow-violet-700/20 transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading
                ? t("auth.processing")
                : currentMode === "login"
                  ? t("auth.signIn")
                  : currentMode === "forgot"
                    ? t("auth.sendLink")
                    : t("auth.savePassword")}
            </button>
          </form>

          {currentMode === "forgot" && (
            <button
              type="button"
              onClick={() => switchMode("login")}
              className="mt-7 w-full text-center text-sm font-semibold text-violet-700 hover:underline"
            >
              {t("auth.backToSignIn")}
            </button>
          )}

          <p className="mt-12 text-center text-xs text-slate-400">
            {t("auth.accessibility")}
          </p>
        </div>
      </section>
    </main>
  );
}

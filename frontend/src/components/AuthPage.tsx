import { Eye, EyeOff, LockKeyhole, Mail, Sparkles } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useLocalization } from "../app/localization";
import { getPublicConfig } from "../services/accountApi";
import { supabase } from "../services/supabaseClient";

type AuthMode = "login" | "register" | "forgot" | "reset";
type RegistrationState = "loading" | "enabled" | "disabled" | "unavailable";
type OAuthProvider = "google" | "facebook" | "apple";
type OAuthTranslation =
  | "auth.continueWithGoogle"
  | "auth.continueWithFacebook"
  | "auth.continueWithApple";

const oauthProviders: {
  id: OAuthProvider;
  configKey: "google_sign_in" | "facebook_sign_in" | "apple_sign_in";
  label: string;
  translation: OAuthTranslation;
}[] = [
  {
    id: "google",
    configKey: "google_sign_in",
    label: "Google",
    translation: "auth.continueWithGoogle",
  },
  {
    id: "facebook",
    configKey: "facebook_sign_in",
    label: "Facebook",
    translation: "auth.continueWithFacebook",
  },
  {
    id: "apple",
    configKey: "apple_sign_in",
    label: "Apple",
    translation: "auth.continueWithApple",
  },
];

const hasOAuthCallbackError = (url: URL) => {
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  return [url.searchParams, fragment].some((params) =>
    ["error", "error_description", "error_code"].some((key) => params.has(key)),
  );
};

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
  const [loadingProvider, setLoadingProvider] = useState<OAuthProvider | null>(
    null,
  );
  const [registrationState, setRegistrationState] =
    useState<RegistrationState>("loading");
  const [trialAvailable, setTrialAvailable] = useState(false);
  const [oauthAvailability, setOAuthAvailability] = useState<
    Record<OAuthProvider, boolean>
  >({ google: false, facebook: false, apple: false });
  const [message, setMessage] = useState("");
  const [error, setError] = useState(() =>
    hasOAuthCallbackError(new URL(window.location.href))
      ? t("auth.oauthCallbackError")
      : "",
  );

  const currentMode = recoveryMode ? "reset" : mode;

  useEffect(() => {
    let active = true;
    getPublicConfig()
      .then((config) => {
        if (active) {
          setRegistrationState(
            config.public_registration ? "enabled" : "disabled",
          );
          setTrialAvailable(config.trial_available);
          setOAuthAvailability({
            google: config.google_sign_in,
            facebook: config.facebook_sign_in,
            apple: config.apple_sign_in,
          });
        }
      })
      .catch(() => {
        if (active) {
          setRegistrationState("unavailable");
          setTrialAvailable(false);
          setOAuthAvailability({
            google: false,
            facebook: false,
            apple: false,
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const query = url.searchParams;
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
    if (!hasOAuthCallbackError(url)) return;

    for (const key of ["error", "error_description", "error_code"]) {
      query.delete(key);
      fragment.delete(key);
    }
    url.hash = fragment.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, []);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setPassword("");
    setError("");
    setMessage("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (currentMode === "register" && registrationState !== "enabled") {
      setError(t("auth.registrationUnavailable"));
      return;
    }
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
      } else if (currentMode === "register") {
        if (password.length < 12) throw new Error(t("auth.passwordMin"));
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setMessage(
          data.session ? t("auth.accountCreated") : t("auth.verifyEmail"),
        );
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;
      }
    } catch (err) {
      setError(
        err instanceof Error && err.message === t("auth.passwordMin")
          ? err.message
          : currentMode === "login"
            ? t("auth.signInError")
            : currentMode === "register"
              ? t("auth.registrationError")
              : t("auth.unknownError"),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthSignIn = async (provider: OAuthProvider) => {
    if (
      !oauthAvailability[provider] ||
      (currentMode === "register" && registrationState !== "enabled")
    ) {
      setError(t("auth.providerUnavailable"));
      return;
    }
    setLoading(true);
    setLoadingProvider(provider);
    setError("");
    setMessage("");
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: window.location.origin,
          ...(provider === "google"
            ? { queryParams: { prompt: "select_account" } }
            : {}),
        },
      });
      if (error) throw error;
    } catch {
      const providerLabel =
        provider === "google"
          ? "Google"
          : provider === "facebook"
            ? "Facebook"
            : "Apple";
      setError(t("auth.oauthSignInError", { provider: providerLabel }));
      setLoading(false);
      setLoadingProvider(null);
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
            void setInterfaceLanguage(event.target.value as "en" | "es").catch(
              () => setError(t("language.updateError")),
            )
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
          <h1 className="auth-hero-title whitespace-pre-line text-5xl font-bold leading-tight">
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
                : currentMode === "register"
                  ? t("auth.createAccount")
                  : currentMode === "forgot"
                    ? t("auth.recover")
                    : t("auth.newPassword")}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              {currentMode === "login"
                ? t("auth.continue")
                : currentMode === "register"
                  ? trialAvailable
                    ? t("auth.registerTrialHelp")
                    : t("auth.createAccountHelp")
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
                      currentMode === "reset" || currentMode === "register"
                        ? "new-password"
                        : "current-password"
                    }
                    minLength={
                      currentMode === "reset" || currentMode === "register"
                        ? 12
                        : undefined
                    }
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
                  : currentMode === "register"
                    ? t("auth.createAccount")
                    : currentMode === "forgot"
                      ? t("auth.sendLink")
                      : t("auth.savePassword")}
            </button>
          </form>

          {currentMode === "login" && (
            <section
              className="mt-6 rounded-2xl border border-violet-200 bg-violet-50/80 p-4 shadow-sm sm:p-5"
              aria-labelledby="registration-prompt-title"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p
                  id="registration-prompt-title"
                  className="font-semibold text-slate-800"
                >
                  {t("auth.noAccount")}
                </p>
                <button
                  type="button"
                  onClick={() => switchMode("register")}
                  disabled={registrationState !== "enabled"}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-violet-700 px-5 py-3 text-sm font-semibold text-white shadow-md shadow-violet-700/15 transition hover:bg-violet-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-300 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none"
                  aria-describedby="registration-availability"
                >
                  {t("auth.createAccount")}
                </button>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {trialAvailable
                  ? t("auth.trialAvailable")
                  : t("auth.trialUnavailable")}
              </p>
              <p
                id="registration-availability"
                className={`mt-2 text-sm ${
                  registrationState === "enabled"
                    ? "text-violet-800"
                    : "text-slate-600"
                }`}
                role={registrationState === "enabled" ? undefined : "status"}
              >
                {registrationState === "loading"
                  ? t("auth.registrationChecking")
                  : registrationState === "enabled"
                    ? trialAvailable
                      ? t("auth.registrationOpen")
                      : t("auth.registrationOpenNoTrial")
                    : registrationState === "disabled"
                      ? t("auth.registrationUnavailable")
                      : t("auth.registrationCheckFailed")}
              </p>
            </section>
          )}
          {currentMode === "register" && (
            <button
              type="button"
              onClick={() => switchMode("login")}
              className="mt-7 w-full text-center text-sm font-semibold text-violet-700 hover:underline"
            >
              {t("auth.backToSignIn")}
            </button>
          )}

          {currentMode === "forgot" && (
            <button
              type="button"
              onClick={() => switchMode("login")}
              className="mt-7 w-full text-center text-sm font-semibold text-violet-700 hover:underline"
            >
              {t("auth.backToSignIn")}
            </button>
          )}

          {(currentMode === "login" || currentMode === "register") && (
            <section className="mt-6" aria-label={t("auth.socialSignIn")}>
              <p className="mb-3 text-center text-sm text-slate-500">
                {t("auth.socialSignIn")}
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {oauthProviders.map((provider) => {
                  const providerAvailable =
                    oauthAvailability[provider.id] &&
                    (currentMode !== "register" ||
                      registrationState === "enabled");
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => void handleOAuthSignIn(provider.id)}
                      disabled={loading || !providerAvailable}
                      aria-label={t(provider.translation)}
                      aria-describedby={
                        registrationState !== "loading" && !providerAvailable
                          ? "oauth-unavailable"
                          : undefined
                      }
                      className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loadingProvider === provider.id
                        ? t("auth.connecting")
                        : provider.label}
                    </button>
                  );
                })}
              </div>
              {registrationState !== "loading" &&
                oauthProviders.some(
                  (provider) =>
                    !oauthAvailability[provider.id] ||
                    (currentMode === "register" &&
                      registrationState !== "enabled"),
                ) && (
                  <p
                    id="oauth-unavailable"
                    className="mt-2 text-center text-xs text-slate-500"
                    role="status"
                  >
                    {t("auth.providerUnavailable")}
                  </p>
                )}
            </section>
          )}

          <p className="mt-12 text-center text-xs text-slate-400">
            {t("auth.accessibility")}
          </p>
        </div>
      </section>
    </main>
  );
}

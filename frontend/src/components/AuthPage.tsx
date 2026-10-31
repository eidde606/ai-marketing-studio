import { Eye, EyeOff, LockKeyhole, Mail, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
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

        setMessage(
          "Si existe una cuenta con ese correo, recibirás un enlace para restablecer tu contraseña.",
        );
      } else if (currentMode === "reset") {
        if (password.length < 12) {
          throw new Error("La contraseña debe tener al menos 12 caracteres.");
        }

        const { error } = await supabase.auth.updateUser({
          password,
        });

        if (error) throw error;

        setPassword("");
        onRecoveryComplete?.();
        setMessage("Contraseña actualizada correctamente.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Ocurrió un error. Inténtalo nuevamente.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 lg:grid lg:grid-cols-2">
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
            Tu espacio creativo
          </p>
          <h1 className="text-5xl font-bold leading-tight">
            Ideas inteligentes.
            <br />
            Marketing extraordinario.
          </h1>
          <p className="mt-6 text-lg leading-8 text-violet-100">
            Crea contenido, organiza campañas y lleva tus marcas al siguiente
            nivel con inteligencia artificial.
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
                ? "¡Bienvenida de nuevo!"
                : currentMode === "forgot"
                  ? "Recuperar contraseña"
                  : "Nueva contraseña"}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              {currentMode === "login"
                ? "Inicia sesión para continuar creando grandes ideas."
                : currentMode === "forgot"
                  ? "Te enviaremos un enlace para recuperar tu acceso."
                  : "Elige una contraseña nueva para tu cuenta."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {currentMode !== "reset" && (
              <div>
                <label
                  htmlFor="auth-email"
                  className="mb-2 block text-sm font-semibold text-slate-700"
                >
                  Correo electrónico
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
                    placeholder="tu@correo.com"
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
                      ? "Nueva contraseña"
                      : "Contraseña"}
                  </label>
                  {currentMode === "login" && (
                    <button
                      type="button"
                      onClick={() => switchMode("forgot")}
                      className="text-sm font-semibold text-violet-700 hover:text-violet-900"
                    >
                      ¿Olvidaste tu contraseña?
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
                      showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
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
                ? "Procesando..."
                : currentMode === "login"
                  ? "Iniciar sesión"
                  : currentMode === "forgot"
                    ? "Enviar enlace"
                    : "Guardar nueva contraseña"}
            </button>
          </form>

          {currentMode === "forgot" && (
            <button
              type="button"
              onClick={() => switchMode("login")}
              className="mt-7 w-full text-center text-sm font-semibold text-violet-700 hover:underline"
            >
              Volver a iniciar sesión
            </button>
          )}

          <p className="mt-12 text-center text-xs text-slate-400">
            Acceso privado y seguro
          </p>
        </div>
      </section>
    </main>
  );
}

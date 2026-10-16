import { useState, type FormEvent } from 'react';
import { supabase } from '../services/supabaseClient';

export default function AuthPage() {
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      if (isRegistering) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) throw error;

        setMessage(
          'Revisa tu correo electrónico para confirmar tu cuenta.',
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
        err instanceof Error
          ? err.message
          : 'Ocurrió un error. Inténtalo nuevamente.',
      );
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setIsRegistering(!isRegistering);
    setError('');
    setMessage('');
  };

  return (
    <main className="auth-page min-h-screen bg-gradient-to-br from-violet-950 via-violet-900 to-purple-700 px-4 py-8 sm:px-6">
      <div className="auth-card mx-auto w-full max-w-md rounded-2xl border border-white/60 bg-white p-6 shadow-2xl sm:p-10">
        <div
          className="auth-logo mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-violet-600 text-3xl text-white shadow-lg shadow-violet-900/20"
          aria-hidden="true"
        >
          ✦
        </div>

        <h1 className="text-center text-2xl font-bold tracking-tight text-violet-950 sm:text-3xl">
          AI Marketing Studio
        </h1>
        <p className="auth-subtitle mt-3 text-center text-sm leading-6 text-slate-600">
          Tu equipo de marketing impulsado por inteligencia artificial.
        </p>

        <h2 className="mt-8 text-xl font-semibold text-slate-900">
          {isRegistering ? 'Crear cuenta' : 'Iniciar sesión'}
        </h2>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div>
            <label
              htmlFor="auth-email"
              className="mb-2 block text-sm font-medium text-slate-700"
            >
              Correo electrónico
            </label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              aria-invalid={Boolean(error)}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-500/20"
            />
          </div>

          <div>
            <label
              htmlFor="auth-password"
              className="mb-2 block text-sm font-medium text-slate-700"
            >
              Contraseña
            </label>
            <input
              id="auth-password"
              type="password"
              autoComplete={
                isRegistering ? 'new-password' : 'current-password'
              }
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              aria-invalid={Boolean(error)}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-500/20"
            />
          </div>

          {error && (
            <p
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              role="alert"
            >
              {error}
            </p>
          )}
          {message && (
            <p
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
              role="status"
            >
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-violet-600 px-4 py-3 font-semibold text-white shadow-lg shadow-violet-600/20 transition hover:bg-violet-700 focus:outline-none focus:ring-4 focus:ring-violet-500/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading
              ? 'Procesando...'
              : isRegistering
                ? 'Crear cuenta'
                : 'Entrar'}
          </button>
        </form>

        <p className="auth-switch mt-7 text-center text-sm text-slate-600">
          {isRegistering ? '¿Ya tienes una cuenta?' : '¿No tienes cuenta?'}{' '}
          <button
            type="button"
            onClick={switchMode}
            className="font-semibold text-violet-700 underline-offset-4 transition hover:text-violet-900 hover:underline focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2"
          >
            {isRegistering ? 'Iniciar sesión' : 'Registrarse'}
          </button>
        </p>
      </div>
    </main>
  );
}

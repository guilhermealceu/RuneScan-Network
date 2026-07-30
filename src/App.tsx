/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FormEvent, useEffect, useState } from 'react';
import { KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';
import { NetworkDashboard } from './components/NetworkDashboard';

interface AccessStatus {
  lanEnabled: boolean;
  authRequired: boolean;
  authenticated: boolean;
}

export default function App() {
  const [access, setAccess] = useState<AccessStatus | null>(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadAccess = async () => {
    try {
      const response = await fetch('/api/access');
      if (!response.ok) throw new Error('Falha ao consultar o servidor.');
      setAccess(await response.json());
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao consultar o servidor.');
    }
  };

  useEffect(() => {
    void loadAccess();
  }, []);

  const authenticate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) throw new Error('Token incorreto. Confira o valor configurado no servidor.');
      setAccess((current) => current ? { ...current, authenticated: true } : current);
      setToken('');
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Nao foi possivel entrar.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!access) {
    return (
      <main className="min-h-screen grid place-items-center p-6 selection:bg-scan-accent selection:text-white">
        <div className="panel-surface flex items-center gap-3 rounded-2xl px-5 py-4 text-sm font-bold">
          <LoaderCircle className="h-5 w-5 animate-spin text-scan-accent" />
          {error || 'Conectando ao RuneScan...'}
          {error && <button type="button" onClick={() => void loadAccess()} className="ml-2 text-scan-accent underline">Tentar novamente</button>}
        </div>
      </main>
    );
  }

  if (access.authRequired && !access.authenticated) {
    return (
      <main className="min-h-screen grid place-items-center p-6 selection:bg-scan-accent selection:text-white">
        <section className="panel-surface w-full max-w-md rounded-3xl p-8">
          <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-scan-accent text-white shadow-lg shadow-orange-200">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-scan-accent">Acesso protegido</p>
          <h1 className="mt-2 text-2xl font-extrabold">Entrar no RuneScan</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Este servidor foi liberado para acesso pela rede. Informe o token definido pelo administrador.
          </p>
          <form onSubmit={authenticate} className="mt-6 space-y-4">
            <label className="block text-sm font-bold" htmlFor="access-token">Token de acesso</label>
            <div className="flex items-center gap-3 rounded-xl border border-slate-300 bg-white px-4 focus-within:border-scan-accent focus-within:ring-2 focus-within:ring-orange-100">
              <KeyRound className="h-4 w-4 text-slate-400" />
              <input
                id="access-token"
                type="password"
                autoComplete="current-password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none"
                placeholder="Cole o token configurado no .env"
                required
                autoFocus
              />
            </div>
            {error && <p role="alert" className="text-sm font-semibold text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-scan-ink px-4 py-3 text-sm font-extrabold text-white transition hover:bg-scan-accent disabled:cursor-wait disabled:opacity-60"
            >
              {submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
              {submitting ? 'Validando...' : 'Entrar'}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen selection:bg-scan-accent selection:text-white">
      <NetworkDashboard />
    </main>
  );
}

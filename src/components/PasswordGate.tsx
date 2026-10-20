/* eslint-disable react-refresh/only-export-components -- the gate and its lock hook belong together */
import { createContext, useCallback, useContext, useState, type FormEvent, type ReactNode } from 'react';

const SESSION_KEY = 'weis-uc2-access';
const DEFAULT_DEMO_PASSWORD = 'BC2demo';

const LockContext = createContext<(() => void) | null>(null);

/** Lock action for the header, or null outside the gate. */
export function useLock() {
  return useContext(LockContext);
}

function hasSessionAccess() {
  try {
    return sessionStorage.getItem(SESSION_KEY) === 'granted';
  } catch {
    return false;
  }
}

export function PasswordGate({ children }: { children: ReactNode }) {
  const [authorized, setAuthorized] = useState(hasSessionAccess);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const configuredPassword = import.meta.env.VITE_ACCESS_PASSWORD || DEFAULT_DEMO_PASSWORD;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.slice(0, 200) !== configuredPassword) {
      setError('Incorrect password. Please try again.');
      setPassword('');
      return;
    }
    try {
      sessionStorage.setItem(SESSION_KEY, 'granted');
    } catch {
      /* Access still works when storage is unavailable. */
    }
    setAuthorized(true);
    setError('');
  };
  const lock = useCallback(() => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* No stored session to clear. */
    }
    setAuthorized(false);
    setPassword('');
  }, []);

  if (authorized) return <LockContext.Provider value={lock}>{children}</LockContext.Provider>;
  return (
    <main className="access-page">
      <section className="access-panel" aria-labelledby="access-title">
        <div className="access-brand">
          <img src="/weis-1-logo-svg-vector.svg" alt="Weis Markets" />
          <span />
          <img src="/wizelinered.svg" alt="Wizeline" />
        </div>
        <p className="access-eyebrow">PROFITABILITY TRACKING · RESTRICTED DEMO</p>
        <h1 id="access-title">Enter the report</h1>
        <p className="access-copy">Use the access password provided by the project owner.</p>
        <form onSubmit={submit}>
          <label htmlFor="report-password">Password</label>
          <input
            id="report-password"
            type="password"
            value={password}
            maxLength={200}
            onChange={(event) => {
              setPassword(event.target.value);
              setError('');
            }}
            autoComplete="current-password"
            autoFocus
            required
            aria-describedby={error ? 'password-error' : undefined}
          />
          {error ? (
            <p className="access-error" id="password-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit">Continue</button>
        </form>
        <p className="access-footnote">Authorized viewers only. Access lasts until this browser tab or session is closed.</p>
      </section>
    </main>
  );
}

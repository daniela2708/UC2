import { Info } from 'lucide-react';

export function Header({ onOpenDefinitions }: { onOpenDefinitions: () => void }) {
  return (
    <header className="app-header">
      <span className="weis-badge">
        <img src="/weis-1-logo-svg-vector.svg" alt="Weis Markets" width={32} height={32} />
      </span>
      <h1 className="app-title">Weis · Profitability Tracking</h1>
      <span className="header-spacer" />
      <button type="button" className="btn-outline-light" onClick={onOpenDefinitions}>
        <Info size={15} aria-hidden="true" />
        KPI definitions
      </button>
      <img className="wizeline-mark" src="/wizelinered.svg" alt="Wizeline" width={28} height={20} />
    </header>
  );
}

export function Disclaimer() {
  return (
    <div className="disclaimer" role="note">
      All financial figures are simulated for prototype demonstration purposes. Metrics marked Pending validation await
      business confirmation.
    </div>
  );
}

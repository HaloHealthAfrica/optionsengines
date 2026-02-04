import { useState } from 'react';

const tabs = ['Orders', 'Trades', 'Closed P&L'] as const;
type TabKey = (typeof tabs)[number];

export default function OrdersPage() {
  const [active, setActive] = useState<TabKey>('Orders');

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2>Orders</h2>
          <p className="subtitle">Execution tracking and closed P&amp;L.</p>
        </div>
      </header>

      <div className="tabs">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            className={tab === active ? 'tab active' : 'tab'}
            onClick={() => setActive(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="card">
        <h3>{active}</h3>
        <p className="muted">
          This view will connect to orders, trades, and closed P&amp;L once the
          corresponding APIs are available.
        </p>
      </div>
    </section>
  );
}

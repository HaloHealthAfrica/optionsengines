import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '../services/apiClient';

const tabs = ['Overview', 'GEX Analysis', 'Max Pain', 'Options Flow', 'Signal Correlation'] as const;

type TabKey = (typeof tabs)[number];

type GexLevel = {
  strike: number;
  callGex: number;
  putGex: number;
  netGex: number;
};

type GexData = {
  symbol: string;
  netGex: number;
  totalCallGex: number;
  totalPutGex: number;
  zeroGammaLevel?: number;
  dealerPosition: string;
  volatilityExpectation: string;
  updatedAt: string;
  levels: GexLevel[];
};

type OptionsFlowEntry = {
  optionSymbol: string;
  side: 'call' | 'put';
  strike: number;
  expiration: string;
  volume: number;
  openInterest?: number;
  premium?: number;
  timestamp: string;
};

type OptionsFlowSummary = {
  symbol: string;
  entries: OptionsFlowEntry[];
  updatedAt: string;
};

type MaxPainResponse = {
  symbol: string;
  maxPainStrike: number | null;
  distancePercent: number | null;
  magnetStrength: number | null;
  updatedAt: string;
};

type SignalCorrelationResponse = {
  symbol: string;
  correlationScore: number;
  sampleSize: number;
  bias: 'bullish' | 'bearish' | 'neutral';
  notes?: string;
  updatedAt: string;
};

export default function PositioningPage() {
  const [active, setActive] = useState<TabKey>('Overview');
  const [symbol, setSymbol] = useState('SPY');
  const [gex, setGex] = useState<GexData | null>(null);
  const [flow, setFlow] = useState<OptionsFlowSummary | null>(null);
  const [maxPain, setMaxPain] = useState<MaxPainResponse | null>(null);
  const [correlation, setCorrelation] = useState<SignalCorrelationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activeRequest = true;
    const load = async () => {
      try {
        setLoading(true);
        const [gexResp, flowResp, maxPainResp, correlationResp] = await Promise.allSettled([
          apiGet<{ data: GexData }>(`/positioning/gex?symbol=${symbol}`),
          apiGet<{ data: OptionsFlowSummary }>(`/positioning/options-flow?symbol=${symbol}`),
          apiGet<{ data: MaxPainResponse }>(`/positioning/max-pain?symbol=${symbol}`),
          apiGet<{ data: SignalCorrelationResponse }>(`/positioning/signal-correlation?symbol=${symbol}`),
        ]);

        if (!activeRequest) return;
        setGex(gexResp.status === 'fulfilled' ? gexResp.value.data : null);
        setFlow(flowResp.status === 'fulfilled' ? flowResp.value.data : null);
        setMaxPain(maxPainResp.status === 'fulfilled' ? maxPainResp.value.data : null);
        setCorrelation(correlationResp.status === 'fulfilled' ? correlationResp.value.data : null);
        setError(null);
      } catch (err) {
        if (!activeRequest) return;
        setError((err as Error).message);
      } finally {
        if (activeRequest) setLoading(false);
      }
    };

    load();
    return () => {
      activeRequest = false;
    };
  }, [symbol]);

  const topLevels = useMemo(() => {
    if (!gex?.levels?.length) return [];
    return [...gex.levels].sort((a, b) => Math.abs(b.netGex) - Math.abs(a.netGex)).slice(0, 6);
  }, [gex]);

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2>Market Positioning</h2>
          <p className="subtitle">Gamma exposure, max pain, and flow context.</p>
        </div>
        <div className="panel-toolbar">
          <label className="muted" htmlFor="symbol-input">
            Symbol
          </label>
          <input
            id="symbol-input"
            className="input"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value.toUpperCase())}
          />
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

      {loading && <div className="card">Loading positioning data...</div>}
      {error && <div className="card warning">Error: {error}</div>}

      {!loading && !error && (
        <>
          {active === 'Overview' && (
            <div className="grid">
              <section className="card">
                <h3>GEX Summary</h3>
                {gex ? (
                  <div className="metric-list">
                    <div>
                      <span className="stat-label">Net GEX</span>
                      <span className="stat-value">{Math.round(gex.netGex)}</span>
                    </div>
                    <div>
                      <span className="stat-label">Zero Gamma</span>
                      <span className="stat-value">{gex.zeroGammaLevel ?? 'n/a'}</span>
                    </div>
                    <div>
                      <span className="stat-label">Dealer Position</span>
                      <span className="stat-value">{gex.dealerPosition}</span>
                    </div>
                    <div>
                      <span className="stat-label">Volatility</span>
                      <span className="stat-value">{gex.volatilityExpectation}</span>
                    </div>
                  </div>
                ) : (
                  <div className="muted">GEX data unavailable.</div>
                )}
              </section>

              <section className="card">
                <h3>Options Flow Summary</h3>
                {flow?.entries?.length ? (
                  <div className="metric-list">
                    <div>
                      <span className="stat-label">Total Trades</span>
                      <span className="stat-value">{flow.entries.length}</span>
                    </div>
                    <div>
                      <span className="stat-label">Calls</span>
                      <span className="stat-value">
                        {flow.entries.filter((entry) => entry.side === 'call').length}
                      </span>
                    </div>
                    <div>
                      <span className="stat-label">Puts</span>
                      <span className="stat-value">
                        {flow.entries.filter((entry) => entry.side === 'put').length}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="muted">Options flow unavailable.</div>
                )}
              </section>
            </div>
          )}

          {active === 'GEX Analysis' && (
            <section className="card">
              <h3>GEX Levels</h3>
              {!gex && <div className="muted">No GEX data available.</div>}
              {gex && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Strike</th>
                      <th>Call GEX</th>
                      <th>Put GEX</th>
                      <th>Net GEX</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topLevels.map((level) => (
                      <tr key={level.strike}>
                        <td>{level.strike}</td>
                        <td>{Math.round(level.callGex)}</td>
                        <td>{Math.round(level.putGex)}</td>
                        <td>{Math.round(level.netGex)}</td>
                      </tr>
                    ))}
                    {topLevels.length === 0 && (
                      <tr>
                        <td colSpan={4}>No GEX levels returned</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </section>
          )}

          {active === 'Max Pain' && (
            <section className="card">
              <h3>Max Pain</h3>
              {maxPain?.maxPainStrike ? (
                <div className="metric-list">
                  <div>
                    <span className="stat-label">Max Pain Strike</span>
                    <span className="stat-value">{maxPain.maxPainStrike}</span>
                  </div>
                  <div>
                    <span className="stat-label">Distance %</span>
                    <span className="stat-value">{maxPain.distancePercent ?? 'n/a'}%</span>
                  </div>
                  <div>
                    <span className="stat-label">Magnet Strength</span>
                    <span className="stat-value">{maxPain.magnetStrength ?? 'n/a'}</span>
                  </div>
                </div>
              ) : (
                <div className="muted">No max pain data available.</div>
              )}
            </section>
          )}

          {active === 'Options Flow' && (
            <section className="card">
              <h3>Options Flow</h3>
              {!flow?.entries?.length && <div className="muted">No flow data available.</div>}
              {flow?.entries?.length && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Option</th>
                      <th>Side</th>
                      <th>Strike</th>
                      <th>Expiration</th>
                      <th>Volume</th>
                      <th>Premium</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flow.entries.slice(0, 12).map((entry) => (
                      <tr key={`${entry.optionSymbol}-${entry.timestamp}`}>
                        <td>{entry.optionSymbol}</td>
                        <td className={entry.side === 'call' ? 'positive' : 'negative'}>
                          {entry.side.toUpperCase()}
                        </td>
                        <td>{entry.strike}</td>
                        <td>{new Date(entry.expiration).toLocaleDateString()}</td>
                        <td>{entry.volume}</td>
                        <td>{entry.premium ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}

          {active === 'Signal Correlation' && (
            <section className="card">
              <h3>Signal Correlation</h3>
              {correlation?.sampleSize ? (
                <div className="metric-list">
                  <div>
                    <span className="stat-label">Correlation</span>
                    <span className="stat-value">{correlation.correlationScore}</span>
                  </div>
                  <div>
                    <span className="stat-label">Sample Size</span>
                    <span className="stat-value">{correlation.sampleSize}</span>
                  </div>
                  <div>
                    <span className="stat-label">Bias</span>
                    <span className="stat-value">{correlation.bias}</span>
                  </div>
                </div>
              ) : (
                <div className="muted">No correlation data available.</div>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}

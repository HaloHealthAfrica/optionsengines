export type Experiment = {
  experiment_id: string;
  signal_id: string;
  variant: 'A' | 'B';
  assignment_hash: string;
  split_percentage: number;
  created_at: string;
  symbol?: string;
  timeframe?: string;
};

export type AgentPerformance = {
  performance_id: string;
  agent_name: string;
  total_signals: number;
  approved_signals: number;
  rejected_signals: number;
  avg_confidence: number;
  win_rate: number;
  avg_win: number;
  avg_loss: number;
  expectancy: number;
  last_updated: string;
};

export type ShadowPosition = {
  shadow_position_id: string;
  shadow_trade_id: string;
  symbol: string;
  option_symbol: string;
  strike: number;
  expiration: string;
  type: 'call' | 'put';
  quantity: number;
  entry_price: number;
  current_price?: number;
  unrealized_pnl?: number;
  realized_pnl?: number;
  status: 'open' | 'closing' | 'closed';
  entry_timestamp: string;
  exit_timestamp?: string;
  exit_reason?: string;
  last_updated: string;
  experiment_id?: string;
  contributing_agents?: string[];
  meta_confidence?: number;
};

export type Position = {
  position_id: string;
  symbol: string;
  option_symbol: string;
  strike: number;
  expiration: string;
  type: 'call' | 'put';
  quantity: number;
  entry_price: number;
  current_price?: number;
  unrealized_pnl?: number;
  realized_pnl?: number;
  status: 'open' | 'closing' | 'closed';
  entry_timestamp: string;
  exit_timestamp?: string;
  exit_reason?: string;
  last_updated: string;
};

export type FeatureFlag = {
  flag_id: string;
  name: string;
  enabled: boolean;
  description?: string;
  updated_at: string;
  updated_by?: string;
};

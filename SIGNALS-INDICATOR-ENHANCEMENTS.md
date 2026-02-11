# Ultimate Options Strategy - Enhanced Webhook v3

## Summary of Enhancements

This enhanced version includes ALL the data points specified in your trading system requirements for the SIGNALS indicator.

### New Top-Level Fields Added

1. **`source`**: "SIGNALS" - Identifies the indicator type
2. **`indicator`**: "Ultimate_Options_Strategy" - Specific indicator name
3. **`version`**: "3.0" - Version tracking
4. **`signal_id`**: Unique identifier (ticker_direction_timestamp_price)
5. **`direction`**: Explicit "LONG" or "SHORT" at top level
6. **`trigger_timeframe`**: Single timeframe for easier routing
7. **`confidence`**: 0-100 scale (AI score * 10)
8. **`pattern`**: Specific setup name (STRAT_132, FVG_BULL, PMH_BREAKOUT, etc.)
9. **`setup`**: Same as pattern for compatibility
10. **`market_session`**: "PRE", "REGULAR", "POST", "OPEN", "POWER_HOUR"
11. **`session`**: Duplicate for compatibility

### Enhanced Risk Block

Added to the `risk` object:
- `risk_per_contract`: Individual contract risk amount
- `rr_ratio`: Primary risk/reward ratio (same as rr_ratio_t1)
- All existing fields preserved

### Enhanced MTF Context

Added to `mtf_context`:
- `12h_bias`: 12-hour timeframe bias
- `1h_rsi`: 1-hour RSI value
- `local_trend`: Current timeframe trend alignment
- `macro_bias`: Higher timeframe directional bias

### Enhanced Score Breakdown

Added `total` field to score_breakdown for quick reference.

### Pattern Detection

Intelligent pattern naming based on trigger:
- **LONG patterns**: STRAT_132, STRAT_212, STRAT_312, FVG_BULL, PMH_BREAKOUT, MTF_STRICT_BULL, CONFLUENCE_BULL
- **SHORT patterns**: STRAT_BEAR, FVG_BEAR, PML_BREAKDOWN, MTF_STRICT_BEAR, CONFLUENCE_BEAR

### Market Session Improvements

Changed session values to match standard format:
- "PRE" (pre-market, before 9:30 AM ET)
- "REGULAR" (regular hours, 9:30 AM - 4:00 PM ET)
- "POST" (after-hours, after 4:00 PM ET)
- "OPEN" (market open, 9:30-10:00 AM ET)
- "POWER_HOUR" (last hour, 3:00-4:00 PM ET)

## How to Use

1. **Copy the code** from `ultimate-options-strategy-enhanced.pine`
2. **Paste into TradingView** Pine Editor
3. **Save and add to chart**
4. **Create alert** with these settings:
   - Condition: "🟢 LONG Signal" or "🔴 SHORT Signal"
   - Alert actions: Webhook URL
   - Webhook URL: `https://optionstrat.vercel.app/api/phase25/webhooks/signals`
   - Message: `{{strategy.order.alert_message}}`

## JSON Output Example (LONG Signal)

```json
{
  "source": "SIGNALS",
  "indicator": "Ultimate_Options_Strategy",
  "version": "3.0",
  "signal_id": "SPY_LONG_1707523200_450.25",
  "direction": "LONG",
  "ticker": "SPY",
  "exchange": "AMEX",
  "timeframe": "5",
  "trigger_timeframe": "5",
  "current_price": 450.25,
  "price": 450.25,
  "timestamp": 1707523200,
  "confidence": 65.0,
  "pattern": "PMH_BREAKOUT",
  "setup": "PMH_BREAKOUT",
  "market_session": "REGULAR",
  "session": "REGULAR",
  "signal": {
    "type": "LONG",
    "side": "LONG",
    "timeframe": "5",
    "quality": "HIGH",
    "ai_score": 6.5,
    "timestamp": 1707523200,
    "bar_time": "2024-02-09T19:00:00Z"
  },
  "instrument": {
    "exchange": "AMEX",
    "ticker": "SPY",
    "symbol": "SPY",
    "current_price": 450.25
  },
  "entry": {
    "price": 450.25,
    "entry_price": 450.25,
    "stop_loss": 448.50,
    "target_1": 453.75,
    "target_2": 457.25,
    "stop_reason": "VWAP"
  },
  "risk": {
    "stop_loss": 448.50,
    "target_1": 453.75,
    "target_2": 457.25,
    "rr_ratio": 2.0,
    "rr_ratio_t1": 2.0,
    "rr_ratio_t2": 4.0,
    "amount": 200.00,
    "stop_distance_pct": 0.39,
    "recommended_shares": 114,
    "recommended_contracts": 1,
    "risk_per_contract": 1.75,
    "position_multiplier": 1.5,
    "account_risk_pct": 2.0,
    "max_loss_dollars": 199.50
  },
  "market_context": {
    "vwap": 449.80,
    "pmh": 450.00,
    "pml": 447.50,
    "day_open": 448.75,
    "day_change_pct": 0.33,
    "price_vs_vwap_pct": 0.10,
    "distance_to_pmh_pct": 0.06,
    "distance_to_pml_pct": 0.61,
    "atr": 1.25,
    "volume_vs_avg": 1.45,
    "candle_direction": "GREEN",
    "candle_size_atr": 0.8
  },
  "trend_data": {
    "ema_8": 449.90,
    "ema_21": 449.20,
    "ema_50": 448.50,
    "alignment": "BULLISH",
    "strength": 75,
    "rsi": 62.5,
    "macd_signal": "BULLISH"
  },
  "mtf_context": {
    "12h_bias": "LONG",
    "4h_bias": "LONG",
    "4h_rsi": 58.3,
    "1h_bias": "LONG",
    "1h_rsi": 61.2,
    "local_trend": "BULLISH",
    "macro_bias": "BULLISH"
  },
  "score_breakdown": {
    "total": 6.5,
    "strat": 0.0,
    "trend": 2.0,
    "gamma": 0.75,
    "vwap": 2.0,
    "mtf": 1.5,
    "golf": 0.25
  },
  "components": ["PMH_BREAK", "TREND_ALIGN", "VWAP_BOUNCE", "MTF_ALIGN"],
  "time_context": {
    "market_session": "REGULAR",
    "day_of_week": "FRIDAY",
    "bar_time": "2024-02-09T19:00:00Z"
  }
}
```

## Key Improvements for Your Pipeline

### Enrichment Stage
- `signal_id` enables proper deduplication
- `pattern` and `setup` provide context for routing
- `market_session` prevents market_closed rejections

### Risk Management
- Complete `risk` block with all targets and ratios
- `risk_per_contract` for precise position sizing
- `confidence` score for threshold-based filtering

### Strike Selection
- `stop_loss`, `target_1`, `target_2` guide strike placement
- `rr_ratio` helps determine optimal expiration
- `entry_price` provides accurate market snapshot

### Sizing
- `confidence` scales exposure appropriately
- `position_multiplier` for quality-based sizing
- `recommended_contracts` pre-calculated

### Audit Trail
- `signal_id` for tracking
- `timestamp` and `bar_time` for temporal analysis
- Complete `score_breakdown` for signal quality review

## Next Steps

Ready for the next 5 indicators! Please paste:
1. SATY_PHASE indicator
2. TREND (Multi-Timeframe) indicator
3. ORB indicator
4. STRAT indicator
5. Any other indicator

I'll apply the same comprehensive enhancements to each one.

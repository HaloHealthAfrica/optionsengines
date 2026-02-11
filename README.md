# Dual-Engine Options Trading Platform

A production-ready options trading platform with two parallel decision engines:

- **Engine 1 (Production)**: Traditional signal processing with paper trading
- **Engine 2 (Shadow)**: Multi-agent swarm decision system for A/B testing

## Architecture

### Engine 1: Traditional Signal Processing
```
TradingView Webhook → Signal Validation → Market Data Enrichment
→ Risk Checks → Order Creation → Paper Execution
→ Position Tracking → Exit Monitoring
```

### Engine 2: Multi-Agent Swarm System
```
Signal → A/B Router → Multi-Agent Analysis (8 agents)
→ Meta-Decision → Shadow Execution (no live trades)
→ Performance Tracking
```

## Key Features

- **Non-Breaking Integration**: Engine 2 never modifies Engine 1 logic
- **Shared Data Layer**: Single market data enrichment pass for both engines
- **Shadow Execution**: Engine 2 logs decisions without placing live trades
- **Feature Flags**: All Engine 2 functionality behind runtime toggles
- **Real Market Data**: Alpaca (primary), TwelveData (backup)
- **Property-Based Testing**: Comprehensive correctness properties

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL database
- Alpaca API keys (free paper trading account)

### Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# Required: DATABASE_URL, JWT_SECRET, ALPACA_API_KEY, ALPACA_SECRET_KEY

# Run database migrations
npm run migrate:up

# Start development server
npm run dev
```

### Production Deployment

```bash
# Build
npm run build

# Start production server
npm start
```

## Project Structure

```
src/
├── agents/          # Engine 2: Multi-agent system
├── config/          # Configuration management
├── migrations/      # Database migrations
├── routes/          # API endpoints
├── services/        # Core services (db, cache, market-data)
├── types/           # TypeScript type definitions
├── utils/           # Utility functions
├── workers/         # Background workers
└── server.ts        # Main entry point
```

## Environment Variables

See `.env.example` for all configuration options.

### Critical Variables

- `DATABASE_URL`: PostgreSQL connection string
- `JWT_SECRET`: Secret for JWT tokens (min 32 chars)
- `ALPACA_API_KEY`: Alpaca API key
- `ALPACA_SECRET_KEY`: Alpaca secret key
- `ENABLE_VARIANT_B`: Enable Engine 2 (default: false)

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm test -- --coverage
```

## API Endpoints

### Public
- `GET /health` - Health check
- `POST /webhook` - TradingView webhook receiver

### Protected (JWT Required)
- `GET /signals` - List signals
- `GET /orders` - List orders
- `GET /positions` - List positions
- `GET /experiments` - A/B test results (Engine 2)
- `GET /agents/performance` - Agent metrics (Engine 2)

## Workers

Background workers run on intervals:

1. **Signal Processor** (30s): Process pending signals
2. **Order Creator** (30s): Create orders from approved signals
3. **Paper Executor** (10s): Execute paper trades
4. **Position Refresher** (60s): Update P&L
5. **Exit Monitor** (60s): Check exit conditions

## Engine 2: Multi-Agent System

### Core Agents (Always Active)
- Technical Agent: Price action analysis
- Context Agent: Market regime detection
- Risk Agent: Absolute veto power
- Meta-Decision Agent: Aggregates all outputs

### Specialist Agents (Conditional)
- ORB Specialist: Opening Range Breakout
- Strat Specialist: The Strat methodology
- TTM Specialist: TTM Squeeze indicator

### Sub-Agents (Support Only)
- Satyland Sub-Agent: Confirmation signals

## Safety Features

- Engine 2 never places live trades (shadow mode only)
- All Engine 2 features default to OFF
- Feature flags for granular control
- Event-sourced logging for audit trails
- Property-based testing for correctness

## License

MIT

# Arbitrum Timeboost Dashboard

A real-time monitoring dashboard for Arbitrum's Express Lane auction system (Timeboost).

## Features

- Real-time monitoring of Timeboost events
- Parsing and display of auction results (single-bid and multi-bid)
- Tracking of bidder statistics and balances
- Indexing of timeboosted transactions per round
- Rate-limited and batch RPC requests to prevent 429 errors
- Web-based UI with live updates

## Architecture

### Core Components

1. **EventMonitor**: Monitors blockchain events from the ExpressLaneAuction contract
2. **EventParser**: Processes events and maintains state for rounds and bidders
3. **TransactionIndexer**: Finds and indexes timeboosted transactions
4. **BatchProvider**: Custom Ethers provider with batching and rate limiting
5. **API Server**: Express server providing REST endpoints
6. **Web UI**: Simple HTML/JS dashboard

### Rate Limiting & Batching

- Automatic retry with exponential backoff for 429 errors
- Batch RPC requests for better efficiency
- Configurable requests per second limit
- Queue-based request processing

## Setup

1. Install dependencies:
```bash
yarn install
```

2. Set environment variables (optional):
```bash
export RPC_URL=https://arb1.arbitrum.io/rpc  # Default RPC endpoint
export ETH_USD_PRICE=2600                     # ETH price for USD calculations
export PORT=3001                              # API server port
```

3. Start the server:
```bash
yarn timeboost
```

4. Open the dashboard:
```bash
open src/ui/index.html
```

## API Endpoints

- `GET /api/metrics` - Overall statistics
- `GET /api/bidders` - Bidder rankings and stats
- `GET /api/rounds` - List of rounds with pagination
- `GET /api/rounds/:round` - Detailed round information
- `GET /api/rounds/recent` - Recent rounds
- `GET /health` - Health check

## Running Tests

```bash
yarn timeboost:test
```

## Development Mode

For auto-reloading during development:
```bash
yarn timeboost:dev
```

## Contract Details

- Express Lane Auction: `0x5fcb496a31b7AE91e7c9078Ec662bd7A55cd3079`
- Network: Arbitrum One
- Events monitored:
  - AuctionResolved
  - SetExpressLaneController
  - Deposit/Withdrawal
  - Configuration changes
# Arbitrum Timeboost Dashboard

A real-time monitoring dashboard for Arbitrum's Express Lane auction system (Timeboost).

## Overview

This dashboard provides comprehensive monitoring of Arbitrum Timeboost auctions, displaying real-time data about Express Lane controllers, auction results, and bidder statistics. It connects directly to the Arbitrum One blockchain to fetch and display actual auction data.

## Features

- **Real-time Monitoring**: Fetches live data from Arbitrum One blockchain
- **Persistent Storage**: SQLite database for efficient data storage and retrieval
- **Adaptive Rate Limiting**: Automatically adjusts to network conditions
- **Background Indexing**: Continuous indexing of new and historical rounds
- **Auction Metrics**: Total rounds, revenue, and average prices
- **Bidder Statistics**: Top bidders with win counts and spending data
- **Recent Rounds**: Detailed view of recent auctions with transaction links
- **Timeboosted Transactions**: View individual timeboosted transactions per round
- **Indexing Progress**: Real-time progress tracking when scanning for transactions
- **Automatic Updates**: Data refreshes every minute
- **Efficient Caching**: Reduces RPC calls with smart caching
- **Process Management**: Built-in server management with PID tracking

## Quick Start

```bash
# Clone the repository
git clone https://github.com/gzeoneth/vigilant-spork.git
cd vigilant-spork

# Install dependencies
yarn install

# Start the dashboard
yarn timeboost

# Open http://localhost:3001 in your browser
```

### Server Management

```bash
# Check server status
yarn timeboost --status

# Stop the server
yarn timeboost --stop

# Restart the server
yarn timeboost --restart

# Show help
yarn timeboost --help
```

## Configuration

Environment variables (optional):

```bash
# RPC endpoint (default: https://arb1.arbitrum.io/rpc)
export RPC_URL=https://your-rpc-endpoint

# ETH price for USD calculations (default: 2600)
export ETH_USD_PRICE=2600

# Server port (default: 3001)
export PORT=3001

# Log level (default: INFO)
export LOG_LEVEL=INFO
```

## Architecture

### Components

1. **Event Monitor** (`src/timeboost/core/EventMonitor.ts`)
   - Monitors blockchain events from ExpressLaneAuction contract
   - Supports batch fetching for efficiency

2. **Event Parser** (`src/timeboost/core/EventParser.ts`)
   - Processes raw events into structured data
   - Maintains round and bidder statistics

3. **Transaction Indexer** (`src/timeboost/core/TransactionIndexer.ts`)
   - Scans blocks to find timeboosted transactions
   - Provides progress tracking during indexing
   - Uses batch processing for efficiency
   - Adaptive rate limiting based on network conditions

4. **Database Layer** (`src/timeboost/db/`)
   - SQLite database for persistent storage
   - Repository pattern for clean data access
   - Migration system for schema updates
   - Efficient queries with proper indexing

5. **Indexing Orchestrator** (`src/timeboost/core/DatabaseIndexingOrchestrator.ts`)
   - Manages background indexing of rounds
   - Automatic real-time indexing of new rounds
   - Progressive backfill of historical data
   - Adaptive concurrency control

6. **Server** (`src/timeboost/server.ts`)
   - Express.js API server
   - Serves both API endpoints and static frontend
   - Implements caching and rate limiting

7. **Frontend** (`src/ui/`)
   - Vanilla JavaScript dashboard
   - Real-time data display with auto-refresh
   - Modal views for detailed round information
   - Progress bars for transaction indexing
   - Links to Arbiscan for transactions and addresses

### API Endpoints

- `GET /api/metrics` - Overall statistics and metrics
- `GET /api/bidders` - Bidder rankings and statistics
- `GET /api/rounds` - Paginated list of rounds
- `GET /api/rounds/:round` - Detailed round information with timeboosted transactions
- `GET /api/rounds/recent` - Recent auction rounds
- `GET /api/indexer/progress` - Current transaction indexing progress
- `GET /api/indexer/orchestrator` - Orchestrator status and metrics
- `GET /api/indexer/metrics` - Detailed indexer performance metrics
- `GET /health` - Server health check

## Data Displayed

### Metrics
- **Total Rounds**: Number of completed auction rounds
- **Total Revenue**: Cumulative ETH collected from auctions
- **Average Price/Round**: Mean winning bid amount
- **Block Range**: Shows which blocks are being monitored

### Bidder Information
- Bidder address and label (if known)
- Number of rounds won
- Total ETH spent
- Current balance

### Round Details
- Round number
- Auction type (Single-bid or Multi-bid)
- Express Lane Controller address
- Winner information
- Price paid (in ETH and USD)
- Auction transaction hash with Arbiscan link
- List of timeboosted transactions in the round
- Transaction details (hash, block, from/to, value, gas)

## Contract Details

- **Express Lane Auction Contract**: `0x5fcb496a31b7AE91e7c9078Ec662bd7A55cd3079`
- **Network**: Arbitrum One
- **Events Monitored**:
  - `AuctionResolved`
  - `SetExpressLaneController`
  - `Deposit`
  - `WithdrawalInitiated`
  - `WithdrawalFinalized`
  - Configuration events

## Development

```bash
# Run in development mode with auto-reload
yarn timeboost:dev

# Run tests
yarn timeboost:test

# Run dashboard integration tests
npx mocha -r ts-node/register test/timeboost/dashboard.test.ts --timeout 60000

# Run database tests
npx mocha -r ts-node/register test/timeboost/database.test.ts

# Format code
yarn format

# Lint code
yarn lint

# Database CLI tools
ts-node src/timeboost/db/cli.ts stats        # Show database statistics
ts-node src/timeboost/db/cli.ts rounds       # List recent rounds
ts-node src/timeboost/db/cli.ts bidders      # Show top bidders
ts-node src/timeboost/db/cli.ts transactions # List recent transactions
```

## Technical Details

### Blockchain Scanning
- Scans the last ~10,000 blocks on startup
- Processes events in batches of 1,000 blocks
- Updates cache every 60 seconds
- Serves cached data with 30-second freshness

### Transaction Indexing
- Identifies timeboosted transactions by checking receipt fields
- Scans blocks within round time boundaries
- Provides real-time progress updates during indexing
- Uses batch RPC calls for efficient data fetching
- Adaptive rate limiting automatically adjusts to network conditions
- Persistent storage in SQLite database

### Database Storage
- All indexed data is stored in SQLite database (`timeboost.db`)
- Automatic schema creation and migrations
- Efficient queries with proper indexing
- Data persists across server restarts

### Adaptive Rate Limiting
- Starts with conservative 5 concurrent requests
- Increases by 20% when successful for 30 seconds
- Decreases by 50% when hitting rate limits
- Maintains equilibrium between 1-50 concurrent requests
- Exponential backoff on rate limit errors

### Known Bidders
The dashboard recognizes certain bidder addresses:
- `0x95c0...b018` - SeliniCap
- `0x2b38...da42` - Kairos

Additional bidders can be added in `src/timeboost/core/EventParser.ts`.

## Troubleshooting

### Common Issues

1. **Rate Limiting (429 errors)**
   - The server implements adaptive rate limiting that automatically adjusts
   - Monitor rate limiter metrics at `/api/indexer/metrics`
   - Consider using a private RPC endpoint for heavy usage

2. **Connection Issues**
   - Check your RPC_URL is accessible
   - Verify network connectivity

3. **Missing Data**
   - Data updates every minute
   - Historical data loads on startup (last ~10k blocks)

4. **No Timeboosted Transactions**
   - Transactions are indexed automatically in the background
   - Progress bar shows indexing status when viewing rounds
   - Some rounds may have no timeboosted transactions
   - Check `/api/indexer/orchestrator` for indexing status

5. **Server Already Running**
   - Check status: `yarn timeboost --status`
   - Stop existing: `yarn timeboost --stop`
   - Restart: `yarn timeboost --restart`

6. **Database Issues**
   - Database file: `timeboost.db` (auto-created)
   - Check stats: `ts-node src/timeboost/db/cli.ts stats`
   - Database is automatically migrated on startup

## License

This project is provided as-is for educational and monitoring purposes.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Acknowledgments

Built for monitoring Arbitrum's Timeboost Express Lane auction system.
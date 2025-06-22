# Arbitrum Timeboost Dashboard

A real-time monitoring dashboard for Arbitrum's Express Lane auction system (Timeboost).

## Overview

This dashboard provides comprehensive monitoring of Arbitrum Timeboost auctions, displaying real-time data about Express Lane controllers, auction results, and bidder statistics. It connects directly to the Arbitrum One blockchain to fetch and display actual auction data.

## Features

- **Real-time Monitoring**: Fetches live data from Arbitrum One blockchain
- **Auction Metrics**: Total rounds, revenue, and average prices
- **Bidder Statistics**: Top bidders with win counts and spending data
- **Recent Rounds**: Detailed view of recent auctions with transaction links
- **Timeboosted Transactions**: View individual timeboosted transactions per round
- **Indexing Progress**: Real-time progress tracking when scanning for transactions
- **Automatic Updates**: Data refreshes every minute
- **Efficient Caching**: Reduces RPC calls with smart caching
- **Rate Limiting**: Handles API rate limits gracefully

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

## Configuration

Environment variables (optional):

```bash
# RPC endpoint (default: https://arb1.arbitrum.io/rpc)
export RPC_URL=https://your-rpc-endpoint

# ETH price for USD calculations (default: 2600)
export ETH_USD_PRICE=2600

# Server port (default: 3001)
export PORT=3001
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

4. **Server** (`src/timeboost/server.ts`)
   - Express.js API server
   - Serves both API endpoints and static frontend
   - Implements caching and rate limiting

5. **Frontend** (`src/ui/`)
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

# Format code
yarn format

# Lint code
yarn lint
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

### Known Bidders
The dashboard recognizes certain bidder addresses:
- `0x95c0...b018` - SeliniCap
- `0x2b38...da42` - Kairos

Additional bidders can be added in `src/timeboost/core/EventParser.ts`.

## Troubleshooting

### Common Issues

1. **Rate Limiting (429 errors)**
   - The server implements automatic retry with exponential backoff
   - Consider using a private RPC endpoint for heavy usage

2. **Connection Issues**
   - Check your RPC_URL is accessible
   - Verify network connectivity

3. **Missing Data**
   - Data updates every minute
   - Historical data loads on startup (last ~10k blocks)

4. **No Timeboosted Transactions**
   - Transactions are indexed on-demand when viewing round details
   - Progress bar shows indexing status
   - Some rounds may have no timeboosted transactions

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
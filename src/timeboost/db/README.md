# Timeboost Database Module

This module provides a SQLite database for persisting Timeboost indexer data.

## Features

- SQLite database with optimized schema for Timeboost data
- Repository pattern for clean data access
- Built-in migration system for schema updates
- Transaction support for data consistency
- Comprehensive indexing for query performance

## Database Schema

### Tables

1. **events** - Stores all blockchain events
   - Indexes: block_number, round_number, event_name

2. **rounds** - Stores round information
   - Indexes: indexed status

3. **transactions** - Stores timeboosted transactions
   - Indexes: block_number, round_number, is_timeboosted, from_address

4. **bidders** - Stores bidder statistics
   - Primary key: address

5. **indexing_status** - Tracks round indexing progress
   - Indexes: round_number + status

## Usage

### Basic Setup

```typescript
import { initializeDatabase } from './timeboost/db/utils'

// Initialize database with default settings
const repo = await initializeDatabase()

// Or specify custom path
const repo = await initializeDatabase({
  path: './data/timeboost.db',
  runMigrations: true
})
```

### Working with Rounds

```typescript
// Create a round
await repo.rounds.create({
  round_number: 1,
  start_timestamp: 1000,
  end_timestamp: 2000,
  express_lane_controller: '0x...',
  winning_bid_amount: '1000000000000000000',
  auction_closed: true,
  total_transactions: 0,
  total_timeboosted: 0,
  indexed: false
})

// Get a specific round
const round = await repo.rounds.findByNumber(1)

// Get paginated rounds
const { rounds, total } = await repo.rounds.findAll(1, 10)

// Update round statistics
await repo.rounds.updateStats(1, 100, 25)
```

### Working with Transactions

```typescript
// Insert a single transaction
await repo.transactions.create({
  transaction_hash: '0x...',
  block_number: 12345,
  transaction_index: 0,
  from_address: '0x...',
  to_address: '0x...',
  value: '1000000000000000000',
  gas_used: '21000',
  gas_price: '20000000000',
  is_timeboosted: true,
  round_number: 1,
  timestamp: 1000
})

// Batch insert transactions
await repo.transactions.createBatch(transactions)

// Get transactions by round
const { transactions, total } = await repo.transactions.findByRound(1)

// Get only timeboosted transactions
const timeboosted = await repo.transactions.findTimeboostedByRound(1)
```

### Working with Bidders

```typescript
// Upsert bidder statistics
await repo.bidders.upsert({
  address: '0x...',
  total_wins: 1,
  total_bid_amount: '1000000000000000000',
  last_win_round: 1,
  last_win_timestamp: 1000
})

// Get top bidders
const topBidders = await repo.bidders.findTop(10)
```

### Tracking Indexing Status

```typescript
// Mark round as being indexed
await repo.indexingStatus.markAsStarted(1)

// Mark as completed
await repo.indexingStatus.markAsCompleted(1, 100, 50)

// Mark as failed
await repo.indexingStatus.markAsFailed(1, 'Connection error')

// Check status
const status = await repo.indexingStatus.findByRound(1)
```

### Database Statistics

```typescript
const stats = await repo.getStats()
console.log(stats)
// {
//   total_rounds: 100,
//   total_transactions: 5000,
//   total_timeboosted_transactions: 1200,
//   total_bidders: 15,
//   last_indexed_round: 100,
//   last_indexed_block: 123456
// }
```

### Transactions

For complex operations that need atomicity:

```typescript
repo.beginTransaction(() => {
  // All operations here will be in a single transaction
  repo.rounds.create(round)
  repo.transactions.createBatch(transactions)
  repo.bidders.upsert(bidder)
})
```

## CLI Tool

A command-line tool is provided for database inspection:

```bash
# Show database statistics
ts-node src/timeboost/db/cli.ts stats

# List recent rounds
ts-node src/timeboost/db/cli.ts rounds --limit 20

# Show top bidders
ts-node src/timeboost/db/cli.ts bidders --limit 10

# List recent timeboosted transactions
ts-node src/timeboost/db/cli.ts transactions --limit 50
```

## Migration System

The database includes a migration system for schema updates:

```typescript
import { MigrationManager, TimeboostDatabase } from './timeboost/db'

const db = new TimeboostDatabase()
const migrationManager = new MigrationManager(db)

// Register a migration
migrationManager.registerMigration({
  version: 1,
  name: 'add_new_column',
  up: 'ALTER TABLE rounds ADD COLUMN new_field TEXT;',
  down: 'ALTER TABLE rounds DROP COLUMN new_field;'
})

// Run migrations
await migrationManager.migrate()
```

## Performance Considerations

- The database uses WAL mode for better concurrent access
- All foreign keys are enforced for data integrity
- Comprehensive indexes are created for common queries
- Batch operations are wrapped in transactions for performance
- BigInt values are stored as strings to avoid precision loss

## Integration with IndexingOrchestrator

The `DatabaseIndexingOrchestrator` class provides seamless integration between the indexer and database:

```typescript
import { DatabaseIndexingOrchestrator } from './timeboost/core/DatabaseIndexingOrchestrator'

const orchestrator = new DatabaseIndexingOrchestrator(
  roundIndexer,
  eventParser,
  repository
)

// Start automatic indexing with database persistence
await orchestrator.start()

// Get database statistics
const stats = await orchestrator.getDatabaseStats()
```
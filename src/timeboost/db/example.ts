import { initializeDatabase, closeDatabase, bigIntToString } from './utils'
import {
  EventRecord,
  RoundRecord,
  TransactionRecord,
  BidderRecord,
} from './models'

async function exampleUsage() {
  // Initialize the database
  const repo = await initializeDatabase({
    path: './test-timeboost.db',
    runMigrations: true,
  })

  try {
    // Example: Insert a round
    const round: RoundRecord = {
      round_number: 1,
      start_timestamp: Math.floor(Date.now() / 1000) - 3600,
      end_timestamp: Math.floor(Date.now() / 1000),
      express_lane_controller: '0x1234567890123456789012345678901234567890',
      winning_bid_amount: bigIntToString(BigInt('1000000000000000000')), // 1 ETH
      auction_closed: true,
      total_transactions: 0,
      total_timeboosted: 0,
      indexed: false,
    }

    await repo.rounds.create(round)
    console.log('Round created:', round.round_number)

    // Example: Insert an event
    const event: EventRecord = {
      transaction_hash:
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      block_number: 12345678,
      log_index: 0,
      event_name: 'AuctionResolved',
      event_data: JSON.stringify({
        round: 1,
        expressLaneController: '0x1234567890123456789012345678901234567890',
        winAmount: '1000000000000000000',
      }),
      round_number: 1,
      timestamp: Math.floor(Date.now() / 1000),
    }

    await repo.events.create(event)
    console.log('Event created')

    // Example: Insert a transaction
    const tx: TransactionRecord = {
      transaction_hash:
        '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
      block_number: 12345678,
      transaction_index: 5,
      from_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      to_address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      value: bigIntToString(BigInt('500000000000000000')), // 0.5 ETH
      gas_used: bigIntToString(BigInt('21000')),
      gas_price: bigIntToString(BigInt('20000000000')), // 20 gwei
      is_timeboosted: true,
      round_number: 1,
      timestamp: Math.floor(Date.now() / 1000),
    }

    await repo.transactions.create(tx)
    console.log('Transaction created')

    // Example: Update bidder stats
    const bidder: BidderRecord = {
      address: '0x1234567890123456789012345678901234567890',
      total_wins: 1,
      total_bid_amount: bigIntToString(BigInt('1000000000000000000')),
      last_win_round: 1,
      last_win_timestamp: Math.floor(Date.now() / 1000),
    }

    await repo.bidders.upsert(bidder)
    console.log('Bidder updated')

    // Example: Update round stats
    await repo.rounds.updateStats(1, 10, 3)
    console.log('Round stats updated')

    // Example: Query data
    const roundData = await repo.rounds.findByNumber(1)
    console.log('Round data:', roundData)

    const stats = await repo.getStats()
    console.log('Database stats:', stats)

    const topBidders = await repo.bidders.findTop(5)
    console.log('Top bidders:', topBidders)

    const recentTimeboosted = await repo.transactions.getRecentTimeboosted(5)
    console.log('Recent timeboosted transactions:', recentTimeboosted)

    // Example: Pagination
    const { rounds, total } = await repo.rounds.findAll(1, 10)
    console.log(`Found ${rounds.length} rounds out of ${total} total`)
  } catch (error) {
    console.error('Error:', error)
  } finally {
    // Clean up
    await closeDatabase()
  }
}

// Run the example if this file is executed directly
// tslint:disable-next-line:strict-comparisons
if (typeof require !== 'undefined' && require.main === module) {
  exampleUsage().catch(console.error)
}

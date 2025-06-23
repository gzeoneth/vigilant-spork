import { expect } from 'chai'
import * as fs from 'fs'
import * as path from 'path'
import {
  initializeDatabase,
  closeDatabase,
  bigIntToString,
} from '../../src/timeboost/db/utils'
import {
  EventRecord,
  RoundRecord,
  TransactionRecord,
  BidderRecord,
} from '../../src/timeboost/db/models'
import { TimeboostRepository } from '../../src/timeboost/db/repositories'

describe('Timeboost Database', () => {
  let repo: TimeboostRepository
  const testDbPath = path.join(__dirname, 'test-timeboost.db')

  beforeEach(async () => {
    // Remove test database if it exists
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath)
    }

    repo = await initializeDatabase({
      path: testDbPath,
      runMigrations: true,
    })
  })

  afterEach(async () => {
    await closeDatabase()

    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath)
    }
  })

  describe('Rounds', () => {
    it('should create and retrieve a round', async () => {
      const round: RoundRecord = {
        round_number: 1,
        start_timestamp: 1000,
        end_timestamp: 2000,
        express_lane_controller: '0x1234567890123456789012345678901234567890',
        winning_bid_amount: bigIntToString(BigInt('1000000000000000000')),
        auction_closed: true,
        total_transactions: 0,
        total_timeboosted: 0,
        indexed: false,
      }

      await repo.rounds.create(round)
      const retrieved = await repo.rounds.findByNumber(1)

      expect(retrieved).to.exist
      expect(retrieved!.round_number).to.equal(1)
      expect(retrieved!.express_lane_controller).to.equal(
        round.express_lane_controller
      )
      expect(retrieved!.winning_bid_amount).to.equal(round.winning_bid_amount)
      expect(retrieved!.auction_closed).to.be.true
    })

    it('should update round stats', async () => {
      const round: RoundRecord = {
        round_number: 1,
        start_timestamp: 1000,
        end_timestamp: 2000,
        auction_closed: true,
        total_transactions: 0,
        total_timeboosted: 0,
        indexed: false,
      }

      await repo.rounds.create(round)
      await repo.rounds.updateStats(1, 10, 3)

      const updated = await repo.rounds.findByNumber(1)
      expect(updated!.total_transactions).to.equal(10)
      expect(updated!.total_timeboosted).to.equal(3)
      expect(updated!.indexed).to.be.true
    })

    it('should paginate rounds', async () => {
      // Create multiple rounds
      for (let i = 1; i <= 15; i++) {
        await repo.rounds.create({
          round_number: i,
          start_timestamp: 1000 + i * 100,
          end_timestamp: 2000 + i * 100,
          auction_closed: true,
          total_transactions: 0,
          total_timeboosted: 0,
          indexed: false,
        })
      }

      const { rounds, total } = await repo.rounds.findAll(1, 10)
      expect(rounds).to.have.length(10)
      expect(total).to.equal(15)
      expect(rounds[0].round_number).to.equal(15) // DESC order
    })
  })

  describe('Events', () => {
    it('should create and retrieve events', async () => {
      const event: EventRecord = {
        transaction_hash: '0xabcd',
        block_number: 100,
        log_index: 0,
        event_name: 'AuctionResolved',
        event_data: JSON.stringify({ test: true }),
        round_number: 1,
        timestamp: 1000,
      }

      await repo.events.create(event)
      const events = await repo.events.findByRound(1)

      expect(events).to.have.length(1)
      expect(events[0].event_name).to.equal('AuctionResolved')
      expect(events[0].event_data).to.equal(event.event_data)
    })

    it('should handle duplicate events gracefully', async () => {
      const event: EventRecord = {
        transaction_hash: '0xabcd',
        block_number: 100,
        log_index: 0,
        event_name: 'AuctionResolved',
        event_data: '{}',
        round_number: 1,
        timestamp: 1000,
      }

      await repo.events.create(event)
      await repo.events.create(event) // Should not throw

      const events = await repo.events.findByRound(1)
      expect(events).to.have.length(1)
    })
  })

  describe('Transactions', () => {
    it('should create and retrieve transactions', async () => {
      // First create the round to satisfy foreign key constraint
      await repo.rounds.create({
        round_number: 1,
        start_timestamp: 1000,
        end_timestamp: 2000,
        auction_closed: true,
        total_transactions: 0,
        total_timeboosted: 0,
        indexed: false,
      })

      const tx: TransactionRecord = {
        transaction_hash: '0xfedcba',
        block_number: 100,
        transaction_index: 5,
        from_address: '0xaaaa',
        to_address: '0xbbbb',
        value: bigIntToString(BigInt('1000000000000000000')),
        gas_used: bigIntToString(BigInt('21000')),
        gas_price: bigIntToString(BigInt('20000000000')),
        is_timeboosted: true,
        round_number: 1,
        timestamp: 1000,
      }

      await repo.transactions.create(tx)
      const retrieved = await repo.transactions.findByHash('0xfedcba')

      expect(retrieved).to.exist
      expect(retrieved!.is_timeboosted).to.be.true
      expect(retrieved!.value).to.equal(tx.value)
    })

    it('should batch insert transactions', async () => {
      // First create the round to satisfy foreign key constraint
      await repo.rounds.create({
        round_number: 1,
        start_timestamp: 1000,
        end_timestamp: 2000,
        auction_closed: true,
        total_transactions: 0,
        total_timeboosted: 0,
        indexed: false,
      })

      const transactions: TransactionRecord[] = []
      for (let i = 0; i < 100; i++) {
        transactions.push({
          transaction_hash: `0x${i.toString(16).padStart(64, '0')}`,
          block_number: 100 + i,
          transaction_index: i % 10,
          from_address: '0xaaaa',
          to_address: '0xbbbb',
          value: '0',
          gas_used: '21000',
          gas_price: '20000000000',
          is_timeboosted: i % 3 === 0,
          round_number: 1,
          timestamp: 1000 + i,
        })
      }

      await repo.transactions.createBatch(transactions)
      const { transactions: retrieved, total } =
        await repo.transactions.findByRound(1)

      expect(total).to.equal(100)
      expect(retrieved).to.have.length(100)
    })

    it('should filter timeboosted transactions', async () => {
      // First create the round to satisfy foreign key constraint
      await repo.rounds.create({
        round_number: 1,
        start_timestamp: 1000,
        end_timestamp: 2000,
        auction_closed: true,
        total_transactions: 0,
        total_timeboosted: 0,
        indexed: false,
      })

      const transactions: TransactionRecord[] = [
        {
          transaction_hash: '0x1',
          block_number: 100,
          transaction_index: 0,
          from_address: '0xaaaa',
          value: '0',
          gas_used: '21000',
          gas_price: '20000000000',
          is_timeboosted: true,
          round_number: 1,
          timestamp: 1000,
        },
        {
          transaction_hash: '0x2',
          block_number: 100,
          transaction_index: 1,
          from_address: '0xaaaa',
          value: '0',
          gas_used: '21000',
          gas_price: '20000000000',
          is_timeboosted: false,
          round_number: 1,
          timestamp: 1001,
        },
      ]

      await repo.transactions.createBatch(transactions)
      const timeboosted = await repo.transactions.findTimeboostedByRound(1)

      expect(timeboosted).to.have.length(1)
      expect(timeboosted[0].transaction_hash).to.equal('0x1')
    })
  })

  describe('Bidders', () => {
    it('should upsert bidder information', async () => {
      const bidder: BidderRecord = {
        address: '0x1234',
        total_wins: 1,
        total_bid_amount: bigIntToString(BigInt('1000000000000000000')),
        last_win_round: 1,
        last_win_timestamp: 1000,
      }

      await repo.bidders.upsert(bidder)
      const retrieved = await repo.bidders.findByAddress('0x1234')

      expect(retrieved).to.exist
      expect(retrieved!.total_wins).to.equal(1)
      expect(retrieved!.total_bid_amount).to.equal(bidder.total_bid_amount)

      // Update the same bidder
      await repo.bidders.upsert({
        ...bidder,
        total_bid_amount: bigIntToString(BigInt('2000000000000000000')),
        last_win_round: 2,
        last_win_timestamp: 2000,
      })

      const updated = await repo.bidders.findByAddress('0x1234')
      expect(updated!.total_wins).to.equal(2)
      expect(updated!.last_win_round).to.equal(2)
    })

    it('should retrieve top bidders', async () => {
      const bidders = [
        {
          address: '0x1',
          total_wins: 5,
          total_bid_amount: '5000000000000000000',
        },
        {
          address: '0x2',
          total_wins: 3,
          total_bid_amount: '8000000000000000000',
        },
        {
          address: '0x3',
          total_wins: 8,
          total_bid_amount: '3000000000000000000',
        },
      ]

      for (const bidder of bidders) {
        // Need to insert them individually with proper win counts
        for (let i = 0; i < bidder.total_wins; i++) {
          await repo.bidders.upsert({
            address: bidder.address,
            total_wins: 1,
            total_bid_amount: String(
              BigInt(bidder.total_bid_amount) / BigInt(bidder.total_wins)
            ),
            last_win_round: 1,
            last_win_timestamp: 1000,
          })
        }
      }

      const topBidders = await repo.bidders.findTop(2)
      expect(topBidders).to.have.length(2)
      expect(topBidders[0].address).to.equal('0x3') // Most wins (8)
      expect(topBidders[1].address).to.equal('0x1') // Second most wins (5)
    })
  })

  describe('Indexing Status', () => {
    it('should track indexing status', async () => {
      await repo.indexingStatus.markAsStarted(1)
      let status = await repo.indexingStatus.findByRound(1)

      expect(status).to.exist
      expect(status!.status).to.equal('indexing')
      expect(status!.started_at).to.exist

      await repo.indexingStatus.markAsCompleted(1, 100, 50)
      status = await repo.indexingStatus.findByRound(1)

      expect(status!.status).to.equal('completed')
      expect(status!.blocks_indexed).to.equal(100)
      expect(status!.transactions_indexed).to.equal(50)
      expect(status!.completed_at).to.exist
    })

    it('should handle indexing failures', async () => {
      await repo.indexingStatus.markAsFailed(1, 'Connection error')
      const status = await repo.indexingStatus.findByRound(1)

      expect(status).to.exist
      expect(status!.status).to.equal('failed')
      expect(status!.error_message).to.equal('Connection error')
    })
  })

  describe('Database Stats', () => {
    it('should calculate database statistics', async () => {
      // Create some test data
      await repo.rounds.create({
        round_number: 1,
        start_timestamp: 1000,
        end_timestamp: 2000,
        auction_closed: true,
        total_transactions: 10,
        total_timeboosted: 3,
        indexed: true,
      })

      await repo.transactions.createBatch([
        {
          transaction_hash: '0x1',
          block_number: 100,
          transaction_index: 0,
          from_address: '0xaaaa',
          value: '0',
          gas_used: '21000',
          gas_price: '20000000000',
          is_timeboosted: true,
          round_number: 1,
          timestamp: 1000,
        },
        {
          transaction_hash: '0x2',
          block_number: 101,
          transaction_index: 0,
          from_address: '0xbbbb',
          value: '0',
          gas_used: '21000',
          gas_price: '20000000000',
          is_timeboosted: false,
          round_number: 1,
          timestamp: 1001,
        },
      ])

      await repo.bidders.upsert({
        address: '0x1234',
        total_wins: 1,
        total_bid_amount: '1000000000000000000',
        last_win_round: 1,
        last_win_timestamp: 1000,
      })

      const stats = await repo.getStats()

      expect(stats.total_rounds).to.equal(1)
      expect(stats.total_transactions).to.equal(2)
      expect(stats.total_timeboosted_transactions).to.equal(1)
      expect(stats.total_bidders).to.equal(1)
      expect(stats.last_indexed_round).to.equal(1)
      expect(stats.last_indexed_block).to.equal(101)
    })
  })
})

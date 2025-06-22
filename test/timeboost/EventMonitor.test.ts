import { expect } from 'chai'
import { EventMonitor } from '../../src/timeboost/core/EventMonitor'
import { EventParser } from '../../src/timeboost/core/EventParser'
import { TransactionIndexer } from '../../src/timeboost/core/TransactionIndexer'

describe('Timeboost Event Monitoring', () => {
  const RPC_URL = 'https://arb1.arbitrum.io/rpc'
  let eventMonitor: EventMonitor
  let eventParser: EventParser
  let transactionIndexer: TransactionIndexer

  before(() => {
    eventMonitor = new EventMonitor(RPC_URL)
    eventParser = new EventParser()
    transactionIndexer = new TransactionIndexer(RPC_URL)
  })

  describe('Event Detection', () => {
    it('should detect resolveMultiBidAuction transaction', async () => {
      // Example resolveMultiBidAuction tx
      const txHash =
        '0x589cae3d95e9a9d6d39e61df7416dc3496a6b7c9ad93112c2e2ba8c21c20c753'
      const blockNumber = 293569748

      const events = await eventMonitor.getEvents(blockNumber, blockNumber)
      const auctionEvents = events.filter(e => e.name === 'AuctionResolved')

      expect(auctionEvents).to.have.length.greaterThan(0)

      const event = auctionEvents.find(e => e.transactionHash === txHash)
      expect(event).to.exist
      expect(event?.args.isMultiBid).to.be.true
    })

    it('should detect resolveSingleBidAuction transaction', async () => {
      // Example resolveSingleBidAuction tx
      const txHash =
        '0xb5d974afc3e0536e8c0b9300b5706d6ec64930a2f1127c78efff609fef826b77'
      const blockNumber = 293917677

      const events = await eventMonitor.getEvents(blockNumber, blockNumber)
      const auctionEvents = events.filter(e => e.name === 'AuctionResolved')

      expect(auctionEvents).to.have.length.greaterThan(0)

      const event = auctionEvents.find(e => e.transactionHash === txHash)
      expect(event).to.exist
      expect(event?.args.isMultiBid).to.be.false
    })

    it('should detect timeboosted transaction', async () => {
      // Example timeboosted tx
      const txHash =
        '0xdbafcd65716507401ac1f187af0a9b32d89b78227e7453bb485324d19b576ff6'
      const blockNumber = 293984019

      const txs = await transactionIndexer.getTimeboostedTransactions(
        blockNumber,
        blockNumber
      )
      const timedTx = txs.find(tx => tx.hash === txHash)

      expect(timedTx).to.exist
      expect(timedTx?.timeboosted).to.be.true
    })
  })

  describe('Event Parsing', () => {
    it('should parse auction resolved events correctly', async () => {
      const blockNumber = 293569748
      const events = await eventMonitor.getEvents(blockNumber, blockNumber)

      events.forEach(event => eventParser.processEvent(event))

      const metrics = eventParser.getKeyMetrics()
      expect(metrics.totalRounds).to.be.greaterThan(0)
    })

    it('should track bidder statistics', async () => {
      // Get recent events
      const latestBlock = 294000000 // Use a fixed recent block
      const fromBlock = latestBlock - 1000

      const events = await eventMonitor.getEvents(fromBlock, latestBlock)
      events.forEach(event => eventParser.processEvent(event))

      const bidderStats = eventParser.getBidderStats()
      expect(bidderStats).to.be.an('array')

      if (bidderStats.length > 0) {
        const topBidder = bidderStats[0]
        expect(topBidder).to.have.property('address')
        expect(topBidder).to.have.property('roundsWon')
        expect(topBidder).to.have.property('totalSpent')
      }
    })
  })

  describe('Round Information', () => {
    it('should get current round info', async () => {
      const currentRound = await eventMonitor.getCurrentRound()
      expect(currentRound).to.be.a('bigint')
      expect(currentRound).to.be.greaterThan(0n)
    })

    it('should get round timestamps', async () => {
      const currentRound = await eventMonitor.getCurrentRound()
      const timestamps = await eventMonitor.getRoundTimestamps(currentRound)

      expect(timestamps).to.have.property('start')
      expect(timestamps).to.have.property('end')
      expect(timestamps.start).to.be.a('bigint')
      expect(timestamps.end).to.be.a('bigint')
      expect(timestamps.end).to.be.greaterThan(timestamps.start)
    })

    it('should get reserve price', async () => {
      const reservePrice = await eventMonitor.getReservePrice()
      expect(reservePrice).to.be.a('bigint')
      expect(reservePrice).to.be.greaterThan(0n)
    })
  })

  describe('Transaction Indexing', () => {
    it('should find timeboosted transactions in a block range', async () => {
      // Use a known range with timeboosted transactions
      const fromBlock = 293984000
      const toBlock = 293984020

      const txs = await transactionIndexer.getTimeboostedTransactions(
        fromBlock,
        toBlock
      )
      expect(txs).to.be.an('array')

      if (txs.length > 0) {
        const tx = txs[0]
        expect(tx).to.have.property('hash')
        expect(tx).to.have.property('blockNumber')
        expect(tx).to.have.property('from')
        expect(tx).to.have.property('timeboosted')
        expect(tx.timeboosted).to.be.true
      }
    })
  })
})

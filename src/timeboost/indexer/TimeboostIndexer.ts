import { EventMonitor } from '../core/EventMonitor'
import { EventParser } from '../core/EventParser'
import { TransactionIndexer } from '../core/TransactionIndexer'
import { AllTimeboostEvents, RoundInfo, AuctionResolved } from '../core/types'

export interface IndexerOptions {
  rpcUrl: string
  startBlock?: number
  endBlock?: number
  batchSize?: number
}

export class TimeboostIndexer {
  private eventMonitor: EventMonitor
  private eventParser: EventParser
  private transactionIndexer: TransactionIndexer
  private isRunning: boolean = false
  private lastProcessedBlock: number = 0

  constructor(private options: IndexerOptions) {
    this.eventMonitor = new EventMonitor(options.rpcUrl)
    this.eventParser = new EventParser()
    this.transactionIndexer = new TransactionIndexer(options.rpcUrl)
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Indexer is already running')
    }

    this.isRunning = true
    console.log('Starting Timeboost indexer...')

    if (this.options.startBlock && this.options.endBlock) {
      // Index historical data
      await this.indexHistoricalData(
        this.options.startBlock,
        this.options.endBlock
      )
    } else {
      // Start real-time indexing
      await this.startRealTimeIndexing()
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false
    console.log('Stopping Timeboost indexer...')
  }

  private async indexHistoricalData(
    startBlock: number,
    endBlock: number
  ): Promise<void> {
    console.log(
      `Indexing historical data from block ${startBlock} to ${endBlock}`
    )

    const batchSize = this.options.batchSize || 1000

    for (
      let fromBlock = startBlock;
      fromBlock <= endBlock && this.isRunning;
      fromBlock += batchSize
    ) {
      const toBlock = Math.min(fromBlock + batchSize - 1, endBlock)

      console.log(`Processing blocks ${fromBlock} to ${toBlock}...`)

      // Get events in this range
      const events = await this.eventMonitor.getEvents(fromBlock, toBlock)

      // Process events
      for (const event of events) {
        this.eventParser.processEvent(event)

        // If it's an auction resolved event, index transactions for that round
        if (event.name === 'AuctionResolved') {
          await this.indexRoundTransactions(event as AuctionResolved)
        }
      }

      this.lastProcessedBlock = toBlock

      // Log progress
      const progress = (
        ((toBlock - startBlock) / (endBlock - startBlock)) *
        100
      ).toFixed(2)
      console.log(
        `Progress: ${progress}% (${toBlock - startBlock + 1} blocks processed)`
      )
    }

    console.log('Historical indexing complete')
    this.logStats()
  }

  private async startRealTimeIndexing(): Promise<void> {
    console.log('Starting real-time indexing...')

    // Subscribe to new events
    await this.eventMonitor.subscribeToEvents(
      async (event: AllTimeboostEvents) => {
        if (!this.isRunning) return

        console.log(`New event: ${event.name} in block ${event.blockNumber}`)
        this.eventParser.processEvent(event)

        // If it's an auction resolved event, index transactions for that round
        if (event.name === 'AuctionResolved') {
          await this.indexRoundTransactions(event as AuctionResolved)
        }

        this.lastProcessedBlock = event.blockNumber
      }
    )

    // Subscribe to new timeboosted transactions
    await this.transactionIndexer.subscribeToTimeboostedTransactions(tx => {
      if (!this.isRunning) return

      console.log(`New timeboosted transaction: ${tx.hash}`)

      // Find which round this transaction belongs to
      const rounds = this.eventParser.getAllRounds()
      for (const round of rounds) {
        if (
          tx.timestamp >= Number(round.startTimestamp) &&
          tx.timestamp <= Number(round.endTimestamp)
        ) {
          round.transactions.push(tx)
          break
        }
      }
    })

    // Periodically log stats
    setInterval(() => {
      if (this.isRunning) {
        this.logStats()
      }
    }, 60000) // Every minute
  }

  private async indexRoundTransactions(event: AuctionResolved): Promise<void> {
    const round = event.args.round
    const startTimestamp = Number(event.args.roundStart)
    const endTimestamp = Number(event.args.roundEnd)

    console.log(
      `Indexing transactions for round ${round} (${new Date(startTimestamp * 1000).toISOString()} to ${new Date(endTimestamp * 1000).toISOString()})`
    )

    try {
      const transactions =
        await this.transactionIndexer.getTimeboostedTransactionsForRound(
          startTimestamp,
          endTimestamp
        )

      const roundInfo = this.eventParser.getRoundInfo(round)
      if (roundInfo) {
        roundInfo.transactions = transactions
        console.log(
          `Found ${transactions.length} timeboosted transactions in round ${round}`
        )
      }
    } catch (error) {
      console.error(`Error indexing transactions for round ${round}:`, error)
    }
  }

  private logStats(): void {
    const metrics = this.eventParser.getKeyMetrics()
    const bidders = this.eventParser.getBidderStats()

    console.log('\n=== Timeboost Stats ===')
    console.log(`Total Rounds: ${metrics.totalRounds}`)
    console.log(
      `Total Revenue: ${this.eventParser.formatEther(metrics.totalRevenue)} ETH`
    )
    console.log(
      `Average Price Per Round: ${this.eventParser.formatEther(metrics.averagePricePerRound)} ETH`
    )
    console.log(`Last Processed Block: ${this.lastProcessedBlock}`)

    console.log('\nTop 5 Bidders:')
    metrics.topBidders.forEach((bidder, index) => {
      console.log(
        `${index + 1}. ${bidder.label} (${bidder.address.slice(0, 6)}...${bidder.address.slice(-4)})`
      )
      console.log(`   Rounds Won: ${bidder.roundsWon}`)
      console.log(
        `   Total Spent: ${this.eventParser.formatEther(bidder.totalSpent)} ETH`
      )
    })

    console.log('\nRecent Rounds:')
    metrics.recentRounds.slice(0, 5).forEach(round => {
      const type = round.auctionType === 'multi' ? 'Multi-bid' : 'Single-bid'
      const price = this.eventParser.formatEther(round.pricePaid || 0n)
      console.log(
        `Round ${round.round}: ${type} - ${price} ETH - Controller: ${round.expressLaneController.slice(0, 6)}...`
      )
    })

    console.log('======================\n')
  }

  getEventParser(): EventParser {
    return this.eventParser
  }

  getLastProcessedBlock(): number {
    return this.lastProcessedBlock
  }
}

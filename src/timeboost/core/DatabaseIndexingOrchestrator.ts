import { RoundIndexer } from './RoundIndexer'
import { EventParser } from '../core/EventParser'
import { logger } from './Logger'
import { TimeboostRepository } from '../db/repositories'

export class DatabaseIndexingOrchestrator {
  private roundIndexer: RoundIndexer
  private eventParser: EventParser
  private repository: TimeboostRepository
  private isRunning: boolean = false
  private indexingInterval: NodeJS.Timeout | null = null
  private backfillInterval: NodeJS.Timeout | null = null
  private lastIndexedRound: bigint | null = null
  private oldestIndexedRound: bigint | null = null
  private indexingQueue: Set<bigint> = new Set()
  private backfillQueue: Set<bigint> = new Set()

  constructor(
    roundIndexer: RoundIndexer,
    eventParser: EventParser,
    repository: TimeboostRepository
  ) {
    this.roundIndexer = roundIndexer
    this.eventParser = eventParser
    this.repository = repository
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('DatabaseIndexingOrchestrator', 'Already running')
      return
    }

    this.isRunning = true
    logger.info(
      'DatabaseIndexingOrchestrator',
      'Starting automatic indexing with database persistence'
    )

    // Initialize from database state
    await this.initializeFromDatabase()

    // Start real-time indexing (check every 30 seconds for new rounds)
    this.indexingInterval = setInterval(() => {
      this.checkForNewRounds().catch(error => {
        logger.error(
          'DatabaseIndexingOrchestrator',
          'Error checking for new rounds',
          error
        )
      })
    }, 30000)

    // Start backfill process (check every 60 seconds)
    this.backfillInterval = setInterval(() => {
      this.backfillOlderRounds().catch(error => {
        logger.error(
          'DatabaseIndexingOrchestrator',
          'Error in backfill process',
          error
        )
      })
    }, 60000)

    // Process queues
    this.processQueues()
  }

  stop(): void {
    this.isRunning = false
    if (this.indexingInterval) {
      clearInterval(this.indexingInterval)
      this.indexingInterval = null
    }
    if (this.backfillInterval) {
      clearInterval(this.backfillInterval)
      this.backfillInterval = null
    }
    logger.info('DatabaseIndexingOrchestrator', 'Stopped automatic indexing')
  }

  private async initializeFromDatabase(): Promise<void> {
    try {
      // Get database stats to understand current state
      const stats = await this.repository.getStats()

      // Get all rounds from the event parser
      const allRounds = this.eventParser.getAllRounds()
      if (allRounds.length === 0) {
        logger.warn('DatabaseIndexingOrchestrator', 'No rounds found to index')
        return
      }

      // Sort rounds by round number (descending)
      const sortedRounds = allRounds.sort((a, b) => {
        return Number(b.round - a.round)
      })

      // Get unindexed rounds from database
      const unindexedRounds = await this.repository.rounds.findUnindexed(100)
      const unindexedRoundNumbers = new Set(
        unindexedRounds.map(r => BigInt(r.round_number))
      )

      // Check for failed indexing attempts
      const failedIndexing = await this.repository.indexingStatus.findFailed(10)
      const failedRoundNumbers = new Set(
        failedIndexing.map(s => BigInt(s.round_number))
      )

      // Start with the most recent round
      const latestRound = sortedRounds[0]
      this.lastIndexedRound = stats.last_indexed_round
        ? BigInt(stats.last_indexed_round)
        : latestRound.round
      this.oldestIndexedRound = latestRound.round

      logger.info(
        'DatabaseIndexingOrchestrator',
        `Database contains ${stats.total_rounds} rounds, ${stats.total_transactions} transactions`
      )

      // Add failed rounds to high priority queue
      failedRoundNumbers.forEach(round => {
        this.indexingQueue.add(round)
      })

      // Add recent unindexed rounds to indexing queue
      let addedToQueue = 0
      for (const round of sortedRounds) {
        if (
          unindexedRoundNumbers.has(round.round) ||
          !(await this.isRoundInDatabase(round.round))
        ) {
          if (addedToQueue < 5) {
            this.indexingQueue.add(round.round)
            addedToQueue++
          } else {
            this.backfillQueue.add(round.round)
          }
        }
      }

      logger.info(
        'DatabaseIndexingOrchestrator',
        `Initialized with ${this.indexingQueue.size} rounds to index, ${this.backfillQueue.size} to backfill`
      )
    } catch (error) {
      logger.error(
        'DatabaseIndexingOrchestrator',
        'Error initializing from database',
        error
      )
    }
  }

  private async isRoundInDatabase(roundNumber: bigint): Promise<boolean> {
    const round = await this.repository.rounds.findByNumber(Number(roundNumber))
    return round !== undefined && round.indexed
  }

  private async checkForNewRounds(): Promise<void> {
    if (!this.lastIndexedRound) return

    try {
      const allRounds = this.eventParser.getAllRounds()
      const newRounds = allRounds.filter(
        r => Number(r.round - this.lastIndexedRound!) > 0
      )

      if (newRounds.length > 0) {
        logger.info(
          'DatabaseIndexingOrchestrator',
          `Found ${newRounds.length} new rounds to index`
        )

        // Add new rounds to high-priority queue
        for (const round of newRounds) {
          this.indexingQueue.add(round.round)

          // Create round record in database if it doesn't exist
          const existingRound = await this.repository.rounds.findByNumber(
            Number(round.round)
          )
          if (!existingRound) {
            await this.repository.rounds.create({
              round_number: Number(round.round),
              start_timestamp: Number(round.startTimestamp),
              end_timestamp: Number(round.endTimestamp),
              express_lane_controller: round.expressLaneController || undefined,
              winning_bid_amount: round.winnerBidAmount
                ? round.winnerBidAmount.toString()
                : undefined,
              auction_closed: round.auctionTransactionHash !== null,
              total_transactions: 0,
              total_timeboosted: 0,
              indexed: false,
            })
          }
        }

        // Update last indexed round
        const maxRound = newRounds.reduce(
          (max, r) => (Number(r.round - max) > 0 ? r.round : max),
          this.lastIndexedRound!
        )
        this.lastIndexedRound = maxRound
      }
    } catch (error) {
      logger.error(
        'DatabaseIndexingOrchestrator',
        'Error checking for new rounds',
        error
      )
    }
  }

  private async backfillOlderRounds(): Promise<void> {
    if (!this.oldestIndexedRound || this.backfillQueue.size === 0) return

    // Only backfill if we're not busy with real-time indexing
    const activeIndexing = this.roundIndexer
      .getAllRoundStatuses()
      .filter(s => s.status === 'indexing' || s.status === 'pending').length

    if (activeIndexing > 2) {
      logger.debug(
        'DatabaseIndexingOrchestrator',
        `Skipping backfill, ${activeIndexing} rounds currently indexing`
      )
      return
    }

    // Move some rounds from backfill queue to indexing queue
    const roundsToBackfill = Array.from(this.backfillQueue).slice(0, 3)
    roundsToBackfill.forEach(round => {
      this.backfillQueue.delete(round)
      this.indexingQueue.add(round)
      if (Number(round - this.oldestIndexedRound!) < 0) {
        this.oldestIndexedRound = round
      }
    })

    if (roundsToBackfill.length > 0) {
      logger.info(
        'DatabaseIndexingOrchestrator',
        `Moving ${roundsToBackfill.length} rounds to backfill queue`
      )
    }
  }

  private async processQueues(): Promise<void> {
    while (this.isRunning) {
      try {
        // Process high-priority indexing queue first
        if (this.indexingQueue.size > 0) {
          const roundsToIndex = Array.from(this.indexingQueue).slice(0, 3)

          for (const roundNumber of roundsToIndex) {
            const round = this.eventParser.getRoundInfo(roundNumber)
            if (round) {
              // Check if already indexed in database
              const dbRound = await this.repository.rounds.findByNumber(
                Number(roundNumber)
              )
              if (!dbRound || !dbRound.indexed) {
                const status = this.roundIndexer.getRoundStatus(
                  roundNumber.toString()
                )
                if (!status) {
                  logger.info(
                    'DatabaseIndexingOrchestrator',
                    `Starting to index round ${roundNumber}`
                  )

                  // Mark as started in database
                  await this.repository.indexingStatus.markAsStarted(
                    Number(roundNumber)
                  )

                  // Create or update round in database
                  await this.repository.rounds.create({
                    round_number: Number(roundNumber),
                    start_timestamp: Number(round.startTimestamp),
                    end_timestamp: Number(round.endTimestamp),
                    express_lane_controller:
                      round.expressLaneController || undefined,
                    winning_bid_amount: round.winnerBidAmount
                      ? round.winnerBidAmount.toString()
                      : undefined,
                    auction_closed: round.auctionTransactionHash !== null,
                    total_transactions: 0,
                    total_timeboosted: 0,
                    indexed: false,
                  })

                  // Start indexing with database callback
                  this.roundIndexer
                    .indexRound(round)
                    .then(async _result => {
                      // The round indexer will handle persisting transaction data
                      // Here we just update the indexing status
                      const stats = this.roundIndexer.getRoundStatus(
                        roundNumber.toString()
                      )
                      if (stats && stats.status === 'completed') {
                        await this.repository.indexingStatus.markAsCompleted(
                          Number(roundNumber),
                          0, // blocks processed is not available in RoundIndexStatus
                          stats.transactionCount || 0
                        )
                      }
                    })
                    .catch(async error => {
                      logger.error(
                        'DatabaseIndexingOrchestrator',
                        `Error indexing round ${roundNumber}`,
                        error
                      )
                      await this.repository.indexingStatus.markAsFailed(
                        Number(roundNumber),
                        error.message || 'Unknown error'
                      )
                    })
                }
              }
              this.indexingQueue.delete(roundNumber)
            }
          }
        }

        // Wait before next iteration
        await new Promise(resolve => setTimeout(resolve, 5000))
      } catch (error) {
        logger.error(
          'DatabaseIndexingOrchestrator',
          'Error processing queues',
          error
        )
        await new Promise(resolve => setTimeout(resolve, 10000))
      }
    }
  }

  getStatus(): {
    isRunning: boolean
    lastIndexedRound: string | null
    oldestIndexedRound: string | null
    indexingQueueSize: number
    backfillQueueSize: number
    activeIndexing: number
  } {
    const activeIndexing = this.roundIndexer
      .getAllRoundStatuses()
      .filter(s => s.status === 'indexing' || s.status === 'pending').length

    return {
      isRunning: this.isRunning,
      lastIndexedRound: this.lastIndexedRound?.toString() || null,
      oldestIndexedRound: this.oldestIndexedRound?.toString() || null,
      indexingQueueSize: this.indexingQueue.size,
      backfillQueueSize: this.backfillQueue.size,
      activeIndexing,
    }
  }

  async getDatabaseStats() {
    return this.repository.getStats()
  }
}

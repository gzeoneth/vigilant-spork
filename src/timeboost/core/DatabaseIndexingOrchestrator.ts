import { RoundIndexer } from './RoundIndexer'
import { EventParser } from '../core/EventParser'
import { logger } from './Logger'
import { TimeboostRepository } from '../db/repositories'

// Configuration constants
const ORCHESTRATOR_CONFIG = {
  CHECK_NEW_ROUNDS_INTERVAL_MS: 30000, // 30 seconds
  BACKFILL_INTERVAL_MS: 60000, // 60 seconds
  QUEUE_PROCESS_DELAY_MS: 5000, // 5 seconds
  ERROR_RETRY_DELAY_MS: 10000, // 10 seconds
  MAX_CONCURRENT_INDEXING: 2,
  BATCH_SIZE_PER_ITERATION: 3,
  INITIAL_HIGH_PRIORITY_ROUNDS: 5,
  MAX_UNINDEXED_ROUNDS_FETCH: 100,
  MAX_FAILED_INDEXING_FETCH: 10,
  // Intelligent backfill configuration
  IDLE_THRESHOLD_MS: 30000, // Consider system idle after 30 seconds
  IDLE_BATCH_SIZE: 10, // Process more rounds when idle
  GAP_CHECK_INTERVAL_MS: 120000, // Check for gaps every 2 minutes
  MAX_GAP_SIZE: 1000, // Maximum gap size to process at once
}

export class DatabaseIndexingOrchestrator {
  private roundIndexer: RoundIndexer
  private eventParser: EventParser
  private repository: TimeboostRepository
  private isRunning: boolean = false
  private indexingInterval: NodeJS.Timeout | null = null
  private backfillInterval: NodeJS.Timeout | null = null
  private gapCheckInterval: NodeJS.Timeout | null = null
  private lastIndexedRound: bigint | null = null
  private oldestIndexedRound: bigint | null = null
  private indexingQueue: Set<bigint> = new Set()
  private backfillQueue: Set<bigint> = new Set()
  private lastActivityTime: number = Date.now()
  private identifiedGaps: Array<{ start: bigint; end: bigint }> = []

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

    // Start real-time indexing
    this.indexingInterval = setInterval(() => {
      this.checkForNewRounds().catch(error => {
        logger.error(
          'DatabaseIndexingOrchestrator',
          'Error checking for new rounds',
          error
        )
      })
    }, ORCHESTRATOR_CONFIG.CHECK_NEW_ROUNDS_INTERVAL_MS)

    // Start backfill process
    this.backfillInterval = setInterval(() => {
      this.intelligentBackfill().catch(error => {
        logger.error(
          'DatabaseIndexingOrchestrator',
          'Error in backfill process',
          error
        )
      })
    }, ORCHESTRATOR_CONFIG.BACKFILL_INTERVAL_MS)

    // Start gap detection process
    this.gapCheckInterval = setInterval(() => {
      this.detectAndFillGaps().catch(error => {
        logger.error(
          'DatabaseIndexingOrchestrator',
          'Error in gap detection',
          error
        )
      })
    }, ORCHESTRATOR_CONFIG.GAP_CHECK_INTERVAL_MS)

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
    if (this.gapCheckInterval) {
      clearInterval(this.gapCheckInterval)
      this.gapCheckInterval = null
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
      const unindexedRounds = await this.repository.rounds.findUnindexed(
        ORCHESTRATOR_CONFIG.MAX_UNINDEXED_ROUNDS_FETCH
      )
      const unindexedRoundNumbers = new Set(
        unindexedRounds.map(r => BigInt(r.round_number))
      )

      // Check for failed indexing attempts
      const failedIndexing = await this.repository.indexingStatus.findFailed(
        ORCHESTRATOR_CONFIG.MAX_FAILED_INDEXING_FETCH
      )
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
          if (addedToQueue < ORCHESTRATOR_CONFIG.INITIAL_HIGH_PRIORITY_ROUNDS) {
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

  private async intelligentBackfill(): Promise<void> {
    const activeIndexing = this.roundIndexer
      .getAllRoundStatuses()
      .filter(s => s.status === 'indexing' || s.status === 'pending').length

    // Determine if system is idle
    const isIdle = Date.now() - this.lastActivityTime > ORCHESTRATOR_CONFIG.IDLE_THRESHOLD_MS
    const batchSize = isIdle 
      ? ORCHESTRATOR_CONFIG.IDLE_BATCH_SIZE 
      : ORCHESTRATOR_CONFIG.BATCH_SIZE_PER_ITERATION

    // More aggressive indexing when idle
    const maxConcurrent = isIdle 
      ? ORCHESTRATOR_CONFIG.MAX_CONCURRENT_INDEXING * 2 
      : ORCHESTRATOR_CONFIG.MAX_CONCURRENT_INDEXING

    if (activeIndexing >= maxConcurrent) {
      logger.debug(
        'DatabaseIndexingOrchestrator',
        `Skipping backfill, ${activeIndexing} rounds currently indexing (max: ${maxConcurrent})`
      )
      return
    }

    // Prioritize gap rounds first
    const gapRounds = await this.getGapRounds(batchSize)
    if (gapRounds.length > 0) {
      logger.info(
        'DatabaseIndexingOrchestrator',
        `Found ${gapRounds.length} gap rounds to index`
      )
      gapRounds.forEach(round => {
        this.indexingQueue.add(round)
      })
      return
    }

    // Fall back to regular backfill queue
    if (this.backfillQueue.size === 0) return

    const roundsToBackfill = Array.from(this.backfillQueue).slice(0, batchSize)
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
        `Moving ${roundsToBackfill.length} rounds to indexing queue (idle: ${isIdle})`
      )
    }
  }

  private async detectAndFillGaps(): Promise<void> {
    try {
      // Get all indexed rounds to find gaps
      const indexedRounds = await this.repository.rounds.findAll(1, 10000)
      const roundNumbers = indexedRounds.rounds
        .filter(r => r.indexed)
        .map(r => BigInt(r.round_number))
        .sort((a, b) => Number(a - b))

      if (roundNumbers.length < 2) return

      // Find gaps in indexed rounds
      const gaps: Array<{ start: bigint; end: bigint }> = []
      for (let i = 0; i < roundNumbers.length - 1; i++) {
        const current = roundNumbers[i]
        const next = roundNumbers[i + 1]
        const diff = Number(next - current)
        
        if (diff > 1) {
          gaps.push({
            start: current + 1n,
            end: next - 1n
          })
        }
      }

      if (gaps.length > 0) {
        this.identifiedGaps = gaps
        logger.info(
          'DatabaseIndexingOrchestrator',
          `Detected ${gaps.length} gaps in indexed rounds`
        )
      }

      // Also check for partially indexed rounds (rounds that started but didn't complete)
      const partiallyIndexed = await this.repository.indexingStatus.findPending(50)
      partiallyIndexed.forEach(status => {
        this.indexingQueue.add(BigInt(status.round_number))
      })
    } catch (error) {
      logger.error(
        'DatabaseIndexingOrchestrator',
        'Error detecting gaps',
        error
      )
    }
  }

  private async getGapRounds(limit: number): Promise<bigint[]> {
    const gapRounds: bigint[] = []
    
    for (const gap of this.identifiedGaps) {
      const gapSize = Number(gap.end - gap.start) + 1
      const roundsToTake = Math.min(gapSize, limit - gapRounds.length)
      
      for (let i = 0; i < roundsToTake; i++) {
        const roundNumber = gap.start + BigInt(i)
        const round = this.eventParser.getRoundInfo(roundNumber)
        
        if (round && !(await this.isRoundInDatabase(roundNumber))) {
          gapRounds.push(roundNumber)
        }
      }
      
      if (gapRounds.length >= limit) break
    }
    
    return gapRounds
  }

  private async processQueues(): Promise<void> {
    while (this.isRunning) {
      try {
        // Process high-priority indexing queue first
        if (this.indexingQueue.size > 0) {
          const roundsToIndex = Array.from(this.indexingQueue).slice(
            0,
            ORCHESTRATOR_CONFIG.BATCH_SIZE_PER_ITERATION
          )

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
                    .then(async () => {
                      // Update last activity time
                      this.lastActivityTime = Date.now()
                      
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
        await new Promise(resolve =>
          setTimeout(resolve, ORCHESTRATOR_CONFIG.QUEUE_PROCESS_DELAY_MS)
        )
      } catch (error) {
        logger.error(
          'DatabaseIndexingOrchestrator',
          'Error processing queues',
          error
        )
        await new Promise(resolve =>
          setTimeout(resolve, ORCHESTRATOR_CONFIG.ERROR_RETRY_DELAY_MS)
        )
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

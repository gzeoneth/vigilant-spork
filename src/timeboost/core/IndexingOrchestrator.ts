import { RoundIndexer } from './RoundIndexer'
import { EventParser } from '../core/EventParser'
import { logger } from './Logger'

export class IndexingOrchestrator {
  private roundIndexer: RoundIndexer
  private eventParser: EventParser
  private isRunning: boolean = false
  private indexingInterval: NodeJS.Timeout | null = null
  private backfillInterval: NodeJS.Timeout | null = null
  private lastIndexedRound: bigint | null = null
  private oldestIndexedRound: bigint | null = null
  private indexingQueue: Set<bigint> = new Set()
  private backfillQueue: Set<bigint> = new Set()

  constructor(roundIndexer: RoundIndexer, eventParser: EventParser) {
    this.roundIndexer = roundIndexer
    this.eventParser = eventParser
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('IndexingOrchestrator', 'Already running')
      return
    }

    this.isRunning = true
    logger.info('IndexingOrchestrator', 'Starting automatic indexing')

    // Start from the most recent round
    await this.initializeFromLatestRound()

    // Start real-time indexing (check every 30 seconds for new rounds)
    this.indexingInterval = setInterval(() => {
      this.checkForNewRounds().catch(error => {
        logger.error(
          'IndexingOrchestrator',
          'Error checking for new rounds',
          error
        )
      })
    }, 30000)

    // Start backfill process (check every 60 seconds)
    this.backfillInterval = setInterval(() => {
      this.backfillOlderRounds().catch(error => {
        logger.error('IndexingOrchestrator', 'Error in backfill process', error)
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
    logger.info('IndexingOrchestrator', 'Stopped automatic indexing')
  }

  private async initializeFromLatestRound(): Promise<void> {
    try {
      const allRounds = this.eventParser.getAllRounds()
      if (allRounds.length === 0) {
        logger.warn('IndexingOrchestrator', 'No rounds found to index')
        return
      }

      // Sort rounds by round number (descending)
      const sortedRounds = allRounds.sort((a, b) => {
        // Use Number() to compare bigints to avoid tslint issues
        return Number(b.round - a.round)
      })

      // Start with the most recent round
      const latestRound = sortedRounds[0]
      this.lastIndexedRound = latestRound.round
      this.oldestIndexedRound = latestRound.round

      logger.info(
        'IndexingOrchestrator',
        `Starting indexing from most recent round: ${latestRound.round}`
      )

      // Add the latest round to indexing queue
      this.indexingQueue.add(latestRound.round)

      // Add next few rounds to the queue for immediate indexing
      for (let i = 1; i < Math.min(5, sortedRounds.length); i++) {
        this.indexingQueue.add(sortedRounds[i].round)
      }

      // Add older rounds to backfill queue
      for (let i = 5; i < sortedRounds.length; i++) {
        this.backfillQueue.add(sortedRounds[i].round)
      }
    } catch (error) {
      logger.error(
        'IndexingOrchestrator',
        'Error initializing from latest round',
        error
      )
    }
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
          'IndexingOrchestrator',
          `Found ${newRounds.length} new rounds to index`
        )

        // Add new rounds to high-priority queue
        newRounds.forEach(round => {
          this.indexingQueue.add(round.round)
        })

        // Update last indexed round
        const maxRound = newRounds.reduce(
          (max, r) => (Number(r.round - max) > 0 ? r.round : max),
          this.lastIndexedRound!
        )
        this.lastIndexedRound = maxRound
      }
    } catch (error) {
      logger.error(
        'IndexingOrchestrator',
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
        'IndexingOrchestrator',
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
        'IndexingOrchestrator',
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
              // Check if already indexed or indexing
              const cachedRound = await this.roundIndexer.getCachedRound(
                roundNumber.toString()
              )
              if (!cachedRound) {
                const status = this.roundIndexer.getRoundStatus(
                  roundNumber.toString()
                )
                if (!status) {
                  logger.info(
                    'IndexingOrchestrator',
                    `Starting to index round ${roundNumber}`
                  )
                  this.roundIndexer.indexRound(round).catch(error => {
                    logger.error(
                      'IndexingOrchestrator',
                      `Error indexing round ${roundNumber}`,
                      error
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
        logger.error('IndexingOrchestrator', 'Error processing queues', error)
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
}

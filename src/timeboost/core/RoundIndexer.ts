import { TransactionIndexer } from './TransactionIndexer'
import { RoundInfo, TimeboostedTransaction } from './types'
import fs from 'fs/promises'
import path from 'path'
import { logger } from './Logger'

export interface RoundIndexStatus {
  round: string
  status: 'pending' | 'indexing' | 'completed' | 'error'
  transactionCount: number
  lastIndexed?: number
  error?: string
}

export interface IndexedRound {
  round: string
  startTimestamp: number
  endTimestamp: number
  transactions: TimeboostedTransaction[]
  indexedAt: number
}

export class RoundIndexer {
  private indexer: TransactionIndexer
  private cacheDir: string
  private indexingQueue: Array<{ roundKey: string; roundInfo: RoundInfo }> = []
  private currentlyIndexing: string | null = null
  private roundStatus: Map<string, RoundIndexStatus> = new Map()
  private isProcessing = false

  constructor(rpcUrl: string, cacheDir: string = './cache/rounds') {
    this.indexer = new TransactionIndexer(rpcUrl)
    this.cacheDir = cacheDir
    this.initializeCacheDir()
  }

  private async initializeCacheDir() {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true })
    } catch (error) {
      logger.error('RoundIndexer', 'Error creating cache directory', error)
    }
  }

  private getCacheFilePath(round: string): string {
    return path.join(this.cacheDir, `round-${round}.json`)
  }

  async getCachedRound(round: string): Promise<IndexedRound | null> {
    try {
      const filePath = this.getCacheFilePath(round)
      const data = await fs.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(data)
      // Convert string values back to BigInt
      return {
        ...parsed,
        transactions: parsed.transactions.map((tx: any) => ({
          ...tx,
          value: BigInt(tx.value),
          gasUsed: BigInt(tx.gasUsed),
          effectiveGasPrice: BigInt(tx.effectiveGasPrice),
        })),
      }
    } catch (error) {
      return null
    }
  }

  private async cacheRound(round: string, data: IndexedRound) {
    try {
      const filePath = this.getCacheFilePath(round)
      // Convert BigInt values to strings for JSON serialization
      const serializable = {
        ...data,
        transactions: data.transactions.map(tx => ({
          ...tx,
          value: tx.value.toString(),
          gasUsed: tx.gasUsed.toString(),
          effectiveGasPrice: tx.effectiveGasPrice.toString(),
        })),
      }
      await fs.writeFile(filePath, JSON.stringify(serializable, null, 2))
    } catch (error) {
      logger.error('RoundIndexer', `Error caching round ${round}`, error)
    }
  }

  async indexRound(
    roundInfo: RoundInfo,
    onProgress?: (status: RoundIndexStatus) => void
  ): Promise<IndexedRound> {
    const roundKey = roundInfo.round.toString()

    logger.info('RoundIndexer', `Indexing requested for round ${roundKey}`)

    // Check cache first
    const cached = await this.getCachedRound(roundKey)
    if (cached) {
      logger.info(
        'RoundIndexer',
        `Round ${roundKey} found in cache with ${cached.transactions.length} transactions`
      )
      this.roundStatus.set(roundKey, {
        round: roundKey,
        status: 'completed',
        transactionCount: cached.transactions.length,
        lastIndexed: cached.indexedAt,
      })
      return cached
    }

    // Add to queue if not already present
    const inQueue = this.indexingQueue.some(item => item.roundKey === roundKey)
    if (!inQueue && this.currentlyIndexing !== roundKey) {
      this.indexingQueue.push({ roundKey, roundInfo })
    }

    // Update status to pending
    this.roundStatus.set(roundKey, {
      round: roundKey,
      status: 'pending',
      transactionCount: 0,
    })

    // Start processing queue if not already processing
    if (!this.isProcessing) {
      this.processQueue()
    }

    // Wait for this round to be indexed
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(async () => {
        const status = this.roundStatus.get(roundKey)

        if (status) {
          if (onProgress) {
            onProgress(status)
          }

          if (status.status === 'completed') {
            clearInterval(checkInterval)
            const cachedRound = await this.getCachedRound(roundKey)
            if (cachedRound) {
              resolve(cachedRound)
            } else {
              reject(new Error('Round indexed but cache not found'))
            }
          } else if (status.status === 'error') {
            clearInterval(checkInterval)
            reject(new Error(status.error || 'Indexing failed'))
          }
        }
      }, 500)
    })
  }

  private async processQueue() {
    if (this.isProcessing || this.indexingQueue.length === 0) {
      return
    }

    this.isProcessing = true

    while (this.indexingQueue.length > 0) {
      const { roundKey, roundInfo } = this.indexingQueue.shift()!
      this.currentlyIndexing = roundKey

      try {
        // Update status to indexing
        this.roundStatus.set(roundKey, {
          round: roundKey,
          status: 'indexing',
          transactionCount: 0,
        })

        const startTimestamp = Number(roundInfo.startTimestamp)
        const endTimestamp = Number(roundInfo.endTimestamp)

        logger.info(
          'RoundIndexer',
          `Starting to index round ${roundKey} (${new Date(startTimestamp * 1000).toISOString()} to ${new Date(endTimestamp * 1000).toISOString()})`
        )

        // Set progress callback
        this.indexer.setProgressCallback(progress => {
          this.roundStatus.set(roundKey, {
            round: roundKey,
            status: 'indexing',
            transactionCount: progress.foundTransactions,
          })
        })

        // Index transactions
        const transactions =
          await this.indexer.getTimeboostedTransactionsForRound(
            startTimestamp,
            endTimestamp
          )

        // Cache the result
        const indexedRound: IndexedRound = {
          round: roundKey,
          startTimestamp,
          endTimestamp,
          transactions,
          indexedAt: Date.now(),
        }

        await this.cacheRound(roundKey, indexedRound)

        // Update status to completed
        this.roundStatus.set(roundKey, {
          round: roundKey,
          status: 'completed',
          transactionCount: transactions.length,
          lastIndexed: Date.now(),
        })

        logger.info(
          'RoundIndexer',
          `Successfully indexed round ${roundKey} with ${transactions.length} transactions`
        )
      } catch (error) {
        logger.error('RoundIndexer', `Error indexing round ${roundKey}`, error)
        this.roundStatus.set(roundKey, {
          round: roundKey,
          status: 'error',
          transactionCount: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }

      this.currentlyIndexing = null

      // Add delay between rounds to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    this.isProcessing = false
  }

  getRoundStatus(round: string): RoundIndexStatus | null {
    return this.roundStatus.get(round) || null
  }

  getAllRoundStatuses(): RoundIndexStatus[] {
    return Array.from(this.roundStatus.values())
  }

  async clearCache() {
    try {
      const files = await fs.readdir(this.cacheDir)
      for (const file of files) {
        if (file.startsWith('round-') && file.endsWith('.json')) {
          await fs.unlink(path.join(this.cacheDir, file))
        }
      }
    } catch (error) {
      logger.error('RoundIndexer', 'Error clearing cache', error)
    }
  }
}

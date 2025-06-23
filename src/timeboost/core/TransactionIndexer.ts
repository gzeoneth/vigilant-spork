import { ethers } from 'ethers'
import { TimeboostedTransaction } from './types'
import { BatchProvider } from './BatchProvider'
import { logger } from './Logger'
import { AdaptiveRateLimiter } from './AdaptiveRateLimiter'

// Configuration constants
const _INDEXER_CONFIG = {
  MAX_RESPONSE_TIMES: 100,
  MIN_BATCH_SIZE: 1,
  MAX_BATCH_SIZE: 10,
  BATCH_DELAY_MS: 100,
  RATE_LIMIT_DELAY_MS: 1000,
  BASE_REQUESTS_PER_SECOND: 10,
}

export interface IndexerProgress {
  currentBlock: number
  totalBlocks: number
  processedBlocks: number
  foundTransactions: number
  startTime: number
  estimatedTimeRemaining?: number
}

export class TransactionIndexer {
  private provider: BatchProvider
  private progressCallback?: (progress: IndexerProgress) => void
  private adaptiveRateLimiter: AdaptiveRateLimiter

  constructor(rpcUrl: string) {
    // Initialize adaptive rate limiter with conservative settings
    this.adaptiveRateLimiter = new AdaptiveRateLimiter({
      initialConcurrency: 5,
      minConcurrency: 1,
      maxConcurrency: 50,
      increaseRatio: 1.2,
      decreaseRatio: 0.5,
      successWindowMs: 30000,
      adjustmentIntervalMs: 5000,
      targetSuccessRate: 0.95,
      enableMetrics: true,
    })

    // Provider will use dynamic batch sizes based on rate limiter
    this.provider = new BatchProvider(rpcUrl, {
      batchSize: this.adaptiveRateLimiter.getBatchSize(),
      batchDelay: 100,
      requestsPerSecond: 10, // Base rate, will be controlled by adaptive limiter
    })
  }

  setProgressCallback(callback: (progress: IndexerProgress) => void) {
    this.progressCallback = callback
  }

  async getTimeboostedTransactions(
    fromBlock: number,
    toBlock: number
  ): Promise<TimeboostedTransaction[]> {
    logger.info(
      'TransactionIndexer',
      `Starting to index blocks ${fromBlock} to ${toBlock} (${toBlock - fromBlock + 1} blocks)`
    )

    const timeboostedTxs: TimeboostedTransaction[] = []
    const totalBlocks = toBlock - fromBlock + 1
    const startTime = Date.now()
    let processedBlocks = 0

    // Dynamically adjust batch size based on rate limiter metrics
    let batchSize = Math.min(
      Math.floor(this.adaptiveRateLimiter.getConcurrency() / 2),
      10
    )
    batchSize = Math.max(1, batchSize) // Ensure at least 1

    for (let blockNum = fromBlock; blockNum <= toBlock; blockNum += batchSize) {
      const endBlock = Math.min(blockNum + batchSize - 1, toBlock)
      const promises: Promise<void>[] = []

      for (let i = blockNum; i <= endBlock; i++) {
        // Use adaptive rate limiter to control request flow
        promises.push(
          this.adaptiveRateLimiter.execute(() =>
            this.processBlock(i, timeboostedTxs)
          )
        )
      }

      await Promise.all(promises)
      processedBlocks = endBlock - fromBlock + 1

      // Update batch size based on current performance
      const newBatchSize = Math.min(
        Math.floor(this.adaptiveRateLimiter.getConcurrency() / 2),
        10
      )
      if (newBatchSize !== batchSize) {
        logger.debug(
          'TransactionIndexer',
          `Adjusting batch size from ${batchSize} to ${newBatchSize} based on rate limiter metrics`
        )
        batchSize = Math.max(1, newBatchSize)
      }

      logger.debug(
        'TransactionIndexer',
        `Processed blocks ${blockNum}-${endBlock}, found ${timeboostedTxs.length} timeboosted transactions so far`
      )

      // Dynamic delay based on rate limiter state
      if (endBlock < toBlock) {
        const metrics = this.adaptiveRateLimiter.getMetrics()
        const delay = metrics.rateLimitCount > 0 ? 1000 : 100
        await new Promise(resolve => setTimeout(resolve, delay))
      }

      // Report progress
      if (this.progressCallback) {
        const elapsedTime = Date.now() - startTime
        const blocksPerMs = processedBlocks / elapsedTime
        const remainingBlocks = totalBlocks - processedBlocks
        const estimatedTimeRemaining = remainingBlocks / blocksPerMs

        this.progressCallback({
          currentBlock: endBlock,
          totalBlocks,
          processedBlocks,
          foundTransactions: timeboostedTxs.length,
          startTime,
          estimatedTimeRemaining: Math.round(estimatedTimeRemaining / 1000), // in seconds
        })
      }
    }

    logger.info(
      'TransactionIndexer',
      `Completed indexing blocks ${fromBlock}-${toBlock}. Found ${timeboostedTxs.length} timeboosted transactions`
    )

    return timeboostedTxs.sort((a, b) => a.blockNumber - b.blockNumber)
  }

  private async processBlock(
    blockNumber: number,
    timeboostedTxs: TimeboostedTransaction[]
  ): Promise<void> {
    try {
      const block = await this.provider.getBlockWithTransactions(blockNumber)
      if (!block || !block.transactions) return

      // Get all transaction hashes
      const txHashes = block.transactions.map(
        (tx: string | ethers.TransactionResponse) =>
          typeof tx === 'string' ? tx : tx.hash
      )

      // Batch fetch all receipts
      const receipts = await this.provider.getTransactionReceipts(txHashes)

      // Batch check for timeboosted transactions
      const timeboostedChecks = await Promise.all(
        receipts.map(receipt =>
          receipt ? this.isTimeboosted(receipt) : Promise.resolve(false)
        )
      )

      for (let i = 0; i < receipts.length; i++) {
        const receipt = receipts[i]
        if (!receipt || !timeboostedChecks[i]) continue

        const tx =
          typeof block.transactions[i] === 'string'
            ? await this.provider.getTransaction(block.transactions[i])
            : block.transactions[i]

        if (tx && typeof tx !== 'string') {
          logger.debug(
            'TransactionIndexer',
            `Found timeboosted transaction: ${receipt.hash} in block ${blockNumber}`
          )

          timeboostedTxs.push({
            hash: receipt.hash,
            blockNumber: receipt.blockNumber,
            timestamp: block.timestamp,
            from: receipt.from,
            to: receipt.to || '',
            value: tx.value,
            gasUsed: receipt.gasUsed,
            effectiveGasPrice:
              (receipt as any).effectiveGasPrice?.toBigInt() || 0n,
            timeboosted: true,
          })
        }
      }
    } catch (error: any) {
      // Check if it's a rate limit error
      if (
        error.code === 429 ||
        error.message?.includes('429') ||
        error.message?.toLowerCase().includes('rate limit')
      ) {
        logger.warn(
          'TransactionIndexer',
          `Rate limited while processing block ${blockNumber}, will be retried`
        )
        throw error // Re-throw to let adaptive limiter handle it
      } else {
        logger.error(
          'TransactionIndexer',
          `Error processing block ${blockNumber}`,
          error
        )
      }
    }
  }

  private async isTimeboosted(
    receipt: ethers.TransactionReceipt
  ): Promise<boolean> {
    try {
      // Get raw receipt to check for timeboosted field
      const rawReceipt = await this.provider.send('eth_getTransactionReceipt', [
        receipt.hash,
      ])
      return rawReceipt.timeboosted === true || rawReceipt.timeBoosted === true
    } catch (error) {
      logger.error(
        'TransactionIndexer',
        'Error checking timeboosted status',
        error
      )
      return false
    }
  }

  async getTimeboostedTransactionsForRound(
    roundStart: number,
    roundEnd: number
  ): Promise<TimeboostedTransaction[]> {
    logger.info(
      'TransactionIndexer',
      `Finding blocks for round timestamps: ${new Date(roundStart * 1000).toISOString()} to ${new Date(roundEnd * 1000).toISOString()}`
    )

    // Find block numbers for the round time range
    const startBlock = await this.findBlockByTimestamp(roundStart, 'after')
    const endBlock = await this.findBlockByTimestamp(roundEnd, 'before')

    if (!startBlock || !endBlock) {
      throw new Error('Could not determine block range for round')
    }

    logger.info(
      'TransactionIndexer',
      `Round maps to blocks ${startBlock} to ${endBlock}`
    )

    return this.getTimeboostedTransactions(startBlock, endBlock)
  }

  private async findBlockByTimestamp(
    targetTimestamp: number,
    position: 'before' | 'after'
  ): Promise<number | null> {
    try {
      const latestBlock = await this.provider.getBlock('latest')
      if (!latestBlock) return null

      let low = 1
      let high = latestBlock.number

      // Binary search for the block
      while (low <= high) {
        const mid = Math.floor((low + high) / 2)
        const block = await this.provider.getBlock(mid)

        if (!block) continue

        if (block.timestamp === targetTimestamp) {
          return mid
        } else if (block.timestamp < targetTimestamp) {
          low = mid + 1
        } else {
          high = mid - 1
        }
      }

      // Return the appropriate block based on position
      if (position === 'before') {
        return high
      } else {
        return low
      }
    } catch (error) {
      logger.error(
        'TransactionIndexer',
        'Error finding block by timestamp',
        error
      )
      return null
    }
  }

  async subscribeToTimeboostedTransactions(
    callback: (tx: TimeboostedTransaction) => void
  ): Promise<void> {
    this.provider.on('block', async blockNumber => {
      const txs = await this.getTimeboostedTransactions(
        blockNumber,
        blockNumber
      )
      txs.forEach(callback)
    })
  }

  getMetrics() {
    return this.adaptiveRateLimiter.getMetrics()
  }

  destroy() {
    this.adaptiveRateLimiter.destroy()
    this.provider.destroy()
  }
}

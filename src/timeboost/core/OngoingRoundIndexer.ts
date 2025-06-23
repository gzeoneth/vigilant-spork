import { ethers } from 'ethers'
import { RoundIndexer } from './RoundIndexer'
import { logger } from './Logger'
import { RoundInfo } from './types'

export interface OngoingRoundInfo {
  roundKey: string
  roundInfo: RoundInfo
  startBlock: number
  latestBlock: number
  isComplete: boolean
}

export class OngoingRoundIndexer {
  private ongoingRounds: Map<string, OngoingRoundInfo> = new Map()
  private updateInterval: NodeJS.Timeout | null = null
  private provider: ethers.Provider

  constructor(
    private roundIndexer: RoundIndexer,
    rpcUrl: string,
    private updateIntervalMs: number = 5000
  ) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl)
  }

  async startMonitoring(): Promise<void> {
    if (this.updateInterval) {
      return
    }

    logger.info('OngoingRoundIndexer', 'Starting ongoing round monitoring')

    this.updateInterval = setInterval(() => {
      this.updateOngoingRounds().catch(error => {
        logger.error(
          'OngoingRoundIndexer',
          'Error updating ongoing rounds',
          error
        )
      })
    }, this.updateIntervalMs)

    // Initial check
    await this.updateOngoingRounds()
  }

  stopMonitoring(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval)
      this.updateInterval = null
    }
    logger.info('OngoingRoundIndexer', 'Stopped ongoing round monitoring')
  }

  async trackOngoingRound(
    roundKey: string,
    roundInfo: RoundInfo,
    startBlock: number
  ): Promise<void> {
    const currentTime = Math.floor(Date.now() / 1000)
    const roundEnd = Number(roundInfo.endTimestamp)

    if (currentTime > roundEnd) {
      // Round already ended, no need to track
      return
    }

    this.ongoingRounds.set(roundKey, {
      roundKey,
      roundInfo,
      startBlock,
      latestBlock: startBlock,
      isComplete: false,
    })

    logger.info(
      'OngoingRoundIndexer',
      `Tracking ongoing round ${roundKey}, will complete at ${new Date(roundEnd * 1000).toISOString()}`
    )
  }

  private async updateOngoingRounds(): Promise<void> {
    const currentTime = Math.floor(Date.now() / 1000)
    const latestBlock = await this.provider.getBlock('latest')
    if (!latestBlock) return

    for (const [roundKey, ongoingRound] of this.ongoingRounds.entries()) {
      const roundEnd = Number(ongoingRound.roundInfo.endTimestamp)

      if (currentTime > roundEnd && latestBlock.timestamp > roundEnd) {
        // Round has ended, find the exact end block
        const endBlock = await this.findBlockByTimestamp(roundEnd, 'before')
        if (endBlock) {
          logger.info(
            'OngoingRoundIndexer',
            `Round ${roundKey} completed. Block range: ${ongoingRound.startBlock} to ${endBlock}`
          )

          // Update the round with final block range
          await this.finalizeRound(roundKey, ongoingRound, endBlock)
          this.ongoingRounds.delete(roundKey)
        }
      } else if (latestBlock.number > ongoingRound.latestBlock) {
        // Round is still ongoing, update with new blocks
        logger.debug(
          'OngoingRoundIndexer',
          `Updating ongoing round ${roundKey} with blocks ${ongoingRound.latestBlock + 1} to ${latestBlock.number}`
        )

        // Update the cached data with new transactions
        await this.updateRoundCache(roundKey, ongoingRound, latestBlock.number)
        ongoingRound.latestBlock = latestBlock.number
      }
    }
  }

  private async updateRoundCache(
    roundKey: string,
    ongoingRound: OngoingRoundInfo,
    latestBlock: number
  ): Promise<void> {
    try {
      // Get the indexer from RoundIndexer
      const indexer = this.roundIndexer['indexer']

      // Get new transactions since last update
      const newTransactions = await indexer.getTimeboostedTransactions(
        ongoingRound.latestBlock + 1,
        latestBlock
      )

      if (newTransactions.length > 0) {
        // Get existing cached round
        const cachedRound = await this.roundIndexer.getCachedRound(roundKey)
        if (cachedRound) {
          // Append new transactions
          cachedRound.transactions.push(...newTransactions)

          // Update cache
          await this.roundIndexer['cacheRound'](roundKey, cachedRound)

          // Update status
          const status = this.roundIndexer.getRoundStatus(roundKey)
          if (status) {
            status.transactionCount = cachedRound.transactions.length
            status.lastIndexed = Date.now()
          }

          logger.info(
            'OngoingRoundIndexer',
            `Added ${newTransactions.length} new transactions to ongoing round ${roundKey}`
          )
        }
      }
    } catch (error) {
      logger.error(
        'OngoingRoundIndexer',
        `Error updating cache for round ${roundKey}`,
        error
      )
    }
  }

  private async finalizeRound(
    roundKey: string,
    ongoingRound: OngoingRoundInfo,
    endBlock: number
  ): Promise<void> {
    try {
      // Update the round info with block range
      const updatedRoundInfo: RoundInfo = {
        ...ongoingRound.roundInfo,
        startBlock: ongoingRound.startBlock,
        endBlock: endBlock,
      }

      // Trigger final indexing to ensure we have all blocks
      await this.roundIndexer.indexRound(updatedRoundInfo)

      // If there's a database callback, update the round record
      const dbCallback = this.roundIndexer['databaseCallback']
      if (dbCallback) {
        await dbCallback(roundKey, {
          startBlock: ongoingRound.startBlock,
          endBlock: endBlock,
        })
      }
    } catch (error) {
      logger.error(
        'OngoingRoundIndexer',
        `Error finalizing round ${roundKey}`,
        error
      )
    }
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
      return position === 'before' ? high : low
    } catch (error) {
      logger.error(
        'OngoingRoundIndexer',
        'Error finding block by timestamp',
        error
      )
      return null
    }
  }

  getOngoingRounds(): string[] {
    return Array.from(this.ongoingRounds.keys())
  }

  isRoundOngoing(roundKey: string): boolean {
    return this.ongoingRounds.has(roundKey)
  }

  destroy(): void {
    this.stopMonitoring()
    this.ongoingRounds.clear()
  }
}

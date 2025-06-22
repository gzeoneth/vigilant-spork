import { ethers } from 'ethers'
import { TimeboostedTransaction } from './types'
import { BatchProvider } from './BatchProvider'

export class TransactionIndexer {
  private provider: BatchProvider

  constructor(rpcUrl: string) {
    this.provider = new BatchProvider(rpcUrl, {
      batchSize: 100,
      batchDelay: 50,
      requestsPerSecond: 10,
    })
  }

  async getTimeboostedTransactions(
    fromBlock: number,
    toBlock: number
  ): Promise<TimeboostedTransaction[]> {
    const timeboostedTxs: TimeboostedTransaction[] = []
    const batchSize = 10 // Process blocks in batches

    for (let blockNum = fromBlock; blockNum <= toBlock; blockNum += batchSize) {
      const endBlock = Math.min(blockNum + batchSize - 1, toBlock)
      const promises: Promise<void>[] = []

      for (let i = blockNum; i <= endBlock; i++) {
        promises.push(this.processBlock(i, timeboostedTxs))
      }

      await Promise.all(promises)
    }

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
      const txHashes = block.transactions.map(tx =>
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

        if (tx) {
          timeboostedTxs.push({
            hash: receipt.hash,
            blockNumber: receipt.blockNumber,
            timestamp: block.timestamp,
            from: receipt.from,
            to: receipt.to || '',
            value: tx.value,
            gasUsed: receipt.gasUsed,
            effectiveGasPrice: receipt.gasPrice || 0n,
            timeboosted: true,
          })
        }
      }
    } catch (error) {
      console.error(`Error processing block ${blockNumber}:`, error)
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
      return rawReceipt.timeboosted === true
    } catch (error) {
      // Fallback: check if transaction is to the auction contract
      const AUCTION_ADDRESS =
        '0x5fcb496a31b7AE91e7c9078Ec662bd7A55cd3079'.toLowerCase()
      return receipt.to?.toLowerCase() === AUCTION_ADDRESS
    }
  }

  async getTimeboostedTransactionsForRound(
    roundStart: number,
    roundEnd: number
  ): Promise<TimeboostedTransaction[]> {
    // Find block numbers for the round time range
    const startBlock = await this.findBlockByTimestamp(roundStart, 'after')
    const endBlock = await this.findBlockByTimestamp(roundEnd, 'before')

    if (!startBlock || !endBlock) {
      throw new Error('Could not determine block range for round')
    }

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
      console.error('Error finding block by timestamp:', error)
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
}

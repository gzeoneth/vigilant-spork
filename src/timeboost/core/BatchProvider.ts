import { ethers } from 'ethers'
import { RateLimiter } from './RateLimiter'

interface BatchRequest {
  method: string
  params: any[]
  id: number
  resolve: (value: any) => void
  reject: (error: any) => void
}

export class BatchProvider extends ethers.JsonRpcProvider {
  private batchQueue: BatchRequest[] = []
  private batchTimer: NodeJS.Timeout | null = null
  private batchSize: number
  private batchDelay: number
  private requestId = 1
  private rateLimiter: RateLimiter
  private dynamicBatchSize: boolean = false

  constructor(
    url: string,
    options: {
      batchSize?: number
      batchDelay?: number
      requestsPerSecond?: number
      dynamicBatchSize?: boolean
    } = {}
  ) {
    super(url, undefined, {
      batchMaxCount: options.batchSize || 100,
      polling: true,
    })

    this.batchSize = options.batchSize || 100
    this.batchDelay = options.batchDelay || 50
    this.rateLimiter = new RateLimiter(options.requestsPerSecond || 10)
    this.dynamicBatchSize = options.dynamicBatchSize || false
  }

  async send(method: string, params: any[]): Promise<any> {
    // For certain methods, batch them
    if (this.shouldBatch(method)) {
      return this.addToBatch(method, params)
    }

    // For others, rate limit but don't batch
    return this.rateLimiter.execute(() => super.send(method, params))
  }

  private shouldBatch(method: string): boolean {
    const batchableMethods = [
      'eth_getTransactionReceipt',
      'eth_getBlockByNumber',
      'eth_getBlockByHash',
      'eth_getTransactionByHash',
      'eth_call',
      'eth_getLogs',
    ]

    return batchableMethods.includes(method)
  }

  private addToBatch(method: string, params: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const request: BatchRequest = {
        method,
        params,
        id: this.requestId++,
        resolve,
        reject,
      }

      this.batchQueue.push(request)

      // If we've reached the batch size, process immediately
      if (this.batchQueue.length >= this.batchSize) {
        this.processBatch()
      } else {
        // Otherwise, set a timer to process the batch
        if (!this.batchTimer) {
          this.batchTimer = setTimeout(
            () => this.processBatch(),
            this.batchDelay
          )
        }
      }
    })
  }

  private async processBatch() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }

    if (this.batchQueue.length === 0) return

    // Use dynamic batch size if enabled
    const currentBatchSize = this.dynamicBatchSize
      ? Math.min(this.batchSize, Math.max(5, Math.floor(this.batchSize / 2)))
      : this.batchSize

    const batch = this.batchQueue.splice(0, currentBatchSize)
    const batchRequest = batch.map(req => ({
      jsonrpc: '2.0',
      method: req.method,
      params: req.params,
      id: req.id,
    }))

    try {
      const responses = await this.rateLimiter.execute(() =>
        this.sendBatchRequest(batchRequest)
      )

      // Match responses to requests
      const responseMap = new Map(responses.map((res: any) => [res.id, res]))

      batch.forEach(req => {
        const response = responseMap.get(req.id)
        if (response) {
          if (response.error) {
            req.reject(new Error(response.error.message))
          } else {
            req.resolve(response.result)
          }
        } else {
          req.reject(new Error('No response for request'))
        }
      })
    } catch (error) {
      // If batch fails, reject all requests
      batch.forEach(req => req.reject(error))
    }
  }

  private async sendBatchRequest(requests: any[]): Promise<any[]> {
    const url = (this as any)._getConnection().url
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requests),
    })

    if (response.status === 429) {
      throw { code: 429, message: 'Rate limited', status: 429 }
    }

    if (!response.ok) {
      const errorText = await response.text()
      // Check for rate limit errors in response body
      if (
        errorText.toLowerCase().includes('rate limit') ||
        errorText.toLowerCase().includes('too many requests')
      ) {
        throw { code: 429, message: errorText, status: response.status }
      }
      throw new Error(
        `HTTP error! status: ${response.status}, body: ${errorText}`
      )
    }

    return response.json()
  }

  async getBlockWithTransactions(
    blockNumber: number
  ): Promise<ethers.Block | null> {
    const block = await this.getBlock(blockNumber, false)
    if (!block) return null

    // Batch fetch all transactions
    const txPromises = block.transactions.map(hash => this.getTransaction(hash))

    const transactions = await Promise.all(txPromises)

    // Create a new block object with transactions
    const blockWithTxs = {
      ...block,
      transactions: transactions.filter(
        tx => tx !== null
      ) as ethers.TransactionResponse[],
    }
    return blockWithTxs as any
  }

  async getTransactionReceipts(
    hashes: string[]
  ): Promise<(ethers.TransactionReceipt | null)[]> {
    const promises = hashes.map(hash => this.getTransactionReceipt(hash))
    return Promise.all(promises)
  }

  updateBatchSize(newBatchSize: number): void {
    this.batchSize = Math.max(1, Math.min(1000, newBatchSize))
  }

  destroy(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
    super.destroy()
  }
}

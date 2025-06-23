import { logger } from './Logger'

export interface RateLimiterMetrics {
  successCount: number
  failureCount: number
  rateLimitCount: number
  averageResponseTime: number
  currentConcurrency: number
  targetConcurrency: number
  lastAdjustmentTime: number
}

export interface AdaptiveRateLimiterOptions {
  initialConcurrency?: number
  minConcurrency?: number
  maxConcurrency?: number
  increaseRatio?: number // How much to increase concurrency on success
  decreaseRatio?: number // How much to decrease on rate limit
  successWindowMs?: number // Time window for measuring success
  adjustmentIntervalMs?: number // How often to adjust concurrency
  targetSuccessRate?: number // Target success rate (0-1)
  backoffMultiplier?: number // Exponential backoff multiplier
  maxBackoffMs?: number // Maximum backoff time
  enableMetrics?: boolean
}

export class AdaptiveRateLimiter {
  private queue: Array<{
    fn: () => Promise<any>
    resolve: (value: any) => void
    reject: (error: any) => void
    addedAt: number
  }> = []

  private activeRequests = 0
  private processing = false

  // Configuration
  private currentConcurrency: number
  private targetConcurrency: number
  private minConcurrency: number
  private maxConcurrency: number
  private increaseRatio: number
  private decreaseRatio: number
  private successWindowMs: number
  private adjustmentIntervalMs: number
  private targetSuccessRate: number
  private backoffMultiplier: number
  private maxBackoffMs: number
  private enableMetrics: boolean

  // Metrics tracking
  private successCount = 0
  private failureCount = 0
  private rateLimitCount = 0
  private responseTimes: number[] = []
  private lastAdjustmentTime = Date.now()
  private lastSuccessTime = Date.now()
  private backoffDelay = 0
  private adjustmentTimer?: NodeJS.Timeout

  constructor(options: AdaptiveRateLimiterOptions = {}) {
    this.currentConcurrency = options.initialConcurrency || 5
    this.targetConcurrency = this.currentConcurrency
    this.minConcurrency = options.minConcurrency || 1
    this.maxConcurrency = options.maxConcurrency || 50
    this.increaseRatio = options.increaseRatio || 1.2
    this.decreaseRatio = options.decreaseRatio || 0.5
    this.successWindowMs = options.successWindowMs || 30000
    this.adjustmentIntervalMs = options.adjustmentIntervalMs || 5000
    this.targetSuccessRate = options.targetSuccessRate || 0.95
    this.backoffMultiplier = options.backoffMultiplier || 2
    this.maxBackoffMs = options.maxBackoffMs || 60000
    this.enableMetrics = options.enableMetrics !== false

    // Start periodic concurrency adjustment
    this.startAdjustmentTimer()
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        fn,
        resolve,
        reject,
        addedAt: Date.now(),
      })

      if (!this.processing) {
        this.processQueue()
      }
    })
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return
    this.processing = true

    while (this.queue.length > 0 || this.activeRequests > 0) {
      // Apply backoff if needed
      if (this.backoffDelay > 0) {
        await this.sleep(this.backoffDelay)
        this.backoffDelay = Math.max(0, this.backoffDelay - 1000) // Gradually reduce backoff
      }

      // Process requests up to current concurrency limit
      while (
        this.queue.length > 0 &&
        this.activeRequests < this.currentConcurrency
      ) {
        const item = this.queue.shift()
        if (!item) break

        this.activeRequests++
        this.executeRequest(item)
      }

      // Wait a bit before checking again
      await this.sleep(100)
    }

    this.processing = false
  }

  private async executeRequest(item: {
    fn: () => Promise<any>
    resolve: (value: any) => void
    reject: (error: any) => void
    addedAt: number
  }): Promise<void> {
    const startTime = Date.now()

    try {
      const result = await item.fn()
      const responseTime = Date.now() - startTime

      // Track success metrics
      this.successCount++
      this.lastSuccessTime = Date.now()
      this.responseTimes.push(responseTime)
      if (this.responseTimes.length > 100) {
        this.responseTimes.shift()
      }

      // Gradually reduce backoff on success
      if (this.backoffDelay > 0) {
        this.backoffDelay = Math.floor(this.backoffDelay * 0.9)
      }

      item.resolve(result)
    } catch (error: any) {
      const responseTime = Date.now() - startTime
      const isRateLimit = this.isRateLimitError(error)

      if (isRateLimit) {
        this.rateLimitCount++
        this.handleRateLimit()
        logger.warn(
          'AdaptiveRateLimiter',
          `Rate limit hit. Adjusting concurrency from ${this.currentConcurrency} to ${this.targetConcurrency}`
        )
      } else {
        this.failureCount++
      }

      this.responseTimes.push(responseTime)
      if (this.responseTimes.length > 100) {
        this.responseTimes.shift()
      }

      item.reject(error)
    } finally {
      this.activeRequests--
    }
  }

  private isRateLimitError(error: any): boolean {
    return (
      error.code === 429 ||
      error.status === 429 ||
      error.message?.includes('429') ||
      error.message?.toLowerCase().includes('rate limit') ||
      error.message?.toLowerCase().includes('too many requests')
    )
  }

  private handleRateLimit(): void {
    // Immediately reduce concurrency
    this.targetConcurrency = Math.max(
      this.minConcurrency,
      Math.floor(this.currentConcurrency * this.decreaseRatio)
    )
    this.currentConcurrency = this.targetConcurrency

    // Apply exponential backoff
    if (this.backoffDelay === 0) {
      this.backoffDelay = 1000 // Start with 1 second
    } else {
      this.backoffDelay = Math.min(
        this.backoffDelay * this.backoffMultiplier,
        this.maxBackoffMs
      )
    }

    logger.info(
      'AdaptiveRateLimiter',
      `Rate limited. Concurrency: ${this.currentConcurrency}, Backoff: ${this.backoffDelay}ms`
    )
  }

  private startAdjustmentTimer(): void {
    this.adjustmentTimer = setInterval(() => {
      this.adjustConcurrency()
    }, this.adjustmentIntervalMs)
  }

  private adjustConcurrency(): void {
    const now = Date.now()
    const timeSinceLastAdjustment = now - this.lastAdjustmentTime

    // Only adjust if we have enough data
    if (timeSinceLastAdjustment < this.adjustmentIntervalMs) return

    const totalRequests = this.successCount + this.failureCount
    if (totalRequests < 10) return // Need at least 10 requests for meaningful metrics

    const successRate = this.successCount / totalRequests
    const timeSinceLastSuccess = now - this.lastSuccessTime
    const recentlySuccessful = timeSinceLastSuccess < this.successWindowMs

    // Reset counters for next period
    this.successCount = 0
    this.failureCount = 0
    this.rateLimitCount = 0
    this.lastAdjustmentTime = now

    // Adjust target concurrency based on success rate
    if (recentlySuccessful && successRate >= this.targetSuccessRate) {
      // Increase concurrency if we're doing well
      this.targetConcurrency = Math.min(
        this.maxConcurrency,
        Math.floor(this.targetConcurrency * this.increaseRatio)
      )
    } else if (successRate < this.targetSuccessRate * 0.9) {
      // Decrease if success rate is too low
      this.targetConcurrency = Math.max(
        this.minConcurrency,
        Math.floor(this.targetConcurrency * 0.9)
      )
    }

    // Gradually adjust current concurrency towards target
    if (this.currentConcurrency < this.targetConcurrency) {
      this.currentConcurrency = Math.min(
        this.currentConcurrency + 1,
        this.targetConcurrency
      )
    } else if (this.currentConcurrency > this.targetConcurrency) {
      this.currentConcurrency = Math.max(
        this.currentConcurrency - 1,
        this.targetConcurrency
      )
    }

    if (this.enableMetrics) {
      logger.debug(
        'AdaptiveRateLimiter',
        `Concurrency adjusted: ${this.currentConcurrency} (target: ${this.targetConcurrency}), ` +
          `Success rate: ${(successRate * 100).toFixed(1)}%, ` +
          `Avg response time: ${this.getAverageResponseTime()}ms`
      )
    }
  }

  private getAverageResponseTime(): number {
    if (this.responseTimes.length === 0) return 0
    const sum = this.responseTimes.reduce((a, b) => a + b, 0)
    return Math.round(sum / this.responseTimes.length)
  }

  getMetrics(): RateLimiterMetrics {
    return {
      successCount: this.successCount,
      failureCount: this.failureCount,
      rateLimitCount: this.rateLimitCount,
      averageResponseTime: this.getAverageResponseTime(),
      currentConcurrency: this.currentConcurrency,
      targetConcurrency: this.targetConcurrency,
      lastAdjustmentTime: this.lastAdjustmentTime,
    }
  }

  getConcurrency(): number {
    return this.currentConcurrency
  }

  getBatchSize(): number {
    // Suggest batch size based on current concurrency
    // Higher concurrency = smaller batches to distribute load
    if (this.currentConcurrency >= 30) return 10
    if (this.currentConcurrency >= 20) return 20
    if (this.currentConcurrency >= 10) return 50
    return 100
  }

  destroy(): void {
    if (this.adjustmentTimer) {
      clearInterval(this.adjustmentTimer)
      this.adjustmentTimer = undefined
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

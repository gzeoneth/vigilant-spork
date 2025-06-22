export class RateLimiter {
  private queue: (() => Promise<any>)[] = []
  private processing = false
  private lastRequestTime = 0
  private retryDelay = 1000 // Start with 1 second
  private maxRetryDelay = 60000 // Max 60 seconds
  private requestsPerSecond: number
  private minRequestInterval: number

  constructor(requestsPerSecond: number = 10) {
    this.requestsPerSecond = requestsPerSecond
    this.minRequestInterval = 1000 / requestsPerSecond
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await this.executeWithRetry(fn)
          resolve(result)
        } catch (error) {
          reject(error)
        }
      })

      if (!this.processing) {
        this.processQueue()
      }
    })
  }

  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    retries = 3
  ): Promise<T> {
    for (let i = 0; i < retries; i++) {
      try {
        const result = await fn()
        this.retryDelay = 1000 // Reset delay on success
        return result
      } catch (error: any) {
        if (error.code === 429 || error.message?.includes('429')) {
          console.log(
            `Rate limited, waiting ${this.retryDelay}ms before retry...`
          )
          await this.sleep(this.retryDelay)
          this.retryDelay = Math.min(this.retryDelay * 2, this.maxRetryDelay)

          if (i === retries - 1) {
            throw new Error(`Rate limited after ${retries} retries`)
          }
        } else {
          throw error
        }
      }
    }

    throw new Error('Max retries exceeded')
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return

    this.processing = true

    while (this.queue.length > 0) {
      const now = Date.now()
      const timeSinceLastRequest = now - this.lastRequestTime

      if (timeSinceLastRequest < this.minRequestInterval) {
        await this.sleep(this.minRequestInterval - timeSinceLastRequest)
      }

      const task = this.queue.shift()
      if (task) {
        this.lastRequestTime = Date.now()
        await task()
      }
    }

    this.processing = false
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

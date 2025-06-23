import { AdaptiveRateLimiter } from './core/AdaptiveRateLimiter'

// Demo script to show how the adaptive rate limiter works
async function demo() {
  console.log('Adaptive Rate Limiter Demo')
  console.log('==========================\n')

  // Create a rate limiter with aggressive settings
  const limiter = new AdaptiveRateLimiter({
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

  console.log('Initial configuration:')
  console.log(`- Initial concurrency: 5`)
  console.log(`- Min concurrency: 1`)
  console.log(`- Max concurrency: 50`)
  console.log(`- Increase ratio: 20%`)
  console.log(`- Decrease ratio: 50%`)
  console.log(`- Target success rate: 95%\n`)

  // Simulate some requests
  let requestCount = 0
  let rateLimitHits = 0

  // Function to simulate an RPC call
  async function simulateRpcCall(): Promise<void> {
    requestCount++

    // Simulate rate limiting after certain thresholds
    if (requestCount > 50 && requestCount < 60 && Math.random() < 0.7) {
      rateLimitHits++
      throw { code: 429, message: 'Rate limited' }
    }

    // Simulate normal response time
    await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100))
  }

  console.log('Starting simulation...\n')

  // Run for 30 seconds
  const startTime = Date.now()
  const duration = 30000

  // Keep track of metrics over time
  const metricsHistory: any[] = []

  // Start making requests
  const requestPromises: Promise<void>[] = []

  const interval = setInterval(() => {
    if (Date.now() - startTime > duration) {
      clearInterval(interval)
      return
    }

    // Make multiple concurrent requests
    for (let i = 0; i < 10; i++) {
      const promise = limiter
        .execute(() => simulateRpcCall())
        .catch((error: any) => {
          // Errors are expected (rate limits)
        })
      requestPromises.push(promise)
    }

    // Log metrics every 5 seconds
    if ((Date.now() - startTime) % 5000 < 500) {
      const metrics = limiter.getMetrics()
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      metricsHistory.push({
        elapsed,
        concurrency: metrics.currentConcurrency,
        successRate:
          metrics.successCount + metrics.failureCount > 0
            ? (metrics.successCount /
                (metrics.successCount + metrics.failureCount)) *
              100
            : 0,
        rateLimits: metrics.rateLimitCount,
      })

      console.log(
        `[${elapsed}s] Concurrency: ${metrics.currentConcurrency}, Success rate: ${metricsHistory[metricsHistory.length - 1].successRate.toFixed(1)}%, Rate limits: ${metrics.rateLimitCount}`
      )
    }
  }, 100)

  // Wait for completion
  await new Promise(resolve => setTimeout(resolve, duration + 1000))
  await Promise.all(requestPromises)

  // Final metrics
  const finalMetrics = limiter.getMetrics()
  console.log('\nFinal metrics:')
  console.log(`- Total requests: ${requestCount}`)
  console.log(`- Rate limit hits: ${rateLimitHits}`)
  console.log(`- Final concurrency: ${finalMetrics.currentConcurrency}`)
  console.log(`- Average response time: ${finalMetrics.averageResponseTime}ms`)

  console.log('\nConcurrency adaptation over time:')
  metricsHistory.forEach(m => {
    const bar = '█'.repeat(Math.floor(m.concurrency / 2))
    console.log(
      `${m.elapsed.toString().padStart(2)}s: ${bar} (${m.concurrency})`
    )
  })

  console.log('\nKey behaviors demonstrated:')
  console.log('1. Started with conservative concurrency (5)')
  console.log('2. Gradually increased when successful')
  console.log('3. Immediately reduced by 50% when rate limited')
  console.log('4. Applied exponential backoff during rate limiting')
  console.log('5. Recovered gradually after rate limits passed')

  limiter.destroy()
}

// Run the demo
demo().catch(console.error)

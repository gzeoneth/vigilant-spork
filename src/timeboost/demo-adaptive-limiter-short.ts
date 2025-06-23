import { AdaptiveRateLimiter } from './core/AdaptiveRateLimiter'

// Short demo script to show how the adaptive rate limiter works
async function demo() {
  console.log('Adaptive Rate Limiter Demo - Key Features')
  console.log('=========================================\n')

  const limiter = new AdaptiveRateLimiter({
    initialConcurrency: 5,
    minConcurrency: 1,
    maxConcurrency: 20,
    increaseRatio: 1.2,
    decreaseRatio: 0.5,
    adjustmentIntervalMs: 2000,
    enableMetrics: true,
  })

  console.log('1. Starting with conservative concurrency: 5\n')

  // Simulate successful requests
  console.log('2. Making successful requests...')
  const successfulRequests = []
  for (let i = 0; i < 20; i++) {
    successfulRequests.push(
      limiter.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
        return `Success ${i}`
      })
    )
  }
  await Promise.all(successfulRequests)

  // Wait for adjustment
  await new Promise(resolve => setTimeout(resolve, 2100))

  let metrics = limiter.getMetrics()
  console.log(
    `   After successful requests: Concurrency = ${metrics.currentConcurrency}\n`
  )

  // Simulate rate limit
  console.log('3. Simulating rate limit errors...')
  const rateLimitedRequests = []
  for (let i = 0; i < 5; i++) {
    rateLimitedRequests.push(
      limiter
        .execute(async () => {
          throw { code: 429, message: 'Rate limited' }
        })
        .catch(() => {})
    )
  }
  await Promise.all(rateLimitedRequests)

  metrics = limiter.getMetrics()
  console.log(
    `   After rate limits: Concurrency = ${metrics.currentConcurrency}`
  )
  console.log(`   Rate limit count: ${metrics.rateLimitCount}\n`)

  // Show recovery
  console.log('4. Recovery phase - making successful requests again...')
  const recoveryRequests = []
  for (let i = 0; i < 10; i++) {
    recoveryRequests.push(
      limiter.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
        return `Recovery ${i}`
      })
    )
  }
  await Promise.all(recoveryRequests)

  // Wait for adjustment
  await new Promise(resolve => setTimeout(resolve, 2100))

  metrics = limiter.getMetrics()
  console.log(
    `   After recovery: Concurrency = ${metrics.currentConcurrency}\n`
  )

  console.log('5. Final metrics:')
  console.log(`   - Success count: ${metrics.successCount}`)
  console.log(`   - Failure count: ${metrics.failureCount}`)
  console.log(`   - Rate limit count: ${metrics.rateLimitCount}`)
  console.log(`   - Average response time: ${metrics.averageResponseTime}ms`)
  console.log(`   - Current concurrency: ${metrics.currentConcurrency}`)
  console.log(`   - Suggested batch size: ${limiter.getBatchSize()}\n`)

  console.log('Key behaviors demonstrated:')
  console.log('✓ Started conservatively (5 concurrent requests)')
  console.log('✓ Increased concurrency after successful requests')
  console.log('✓ Immediately reduced by 50% when rate limited')
  console.log('✓ Gradually recovered after rate limits passed')
  console.log('✓ Dynamic batch size suggestions based on concurrency')

  limiter.destroy()
}

// Run the demo
demo().catch(console.error)

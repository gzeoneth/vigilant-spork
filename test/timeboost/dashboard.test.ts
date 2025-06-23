import { expect } from 'chai'
import { spawn, ChildProcess } from 'child_process'

// For node-fetch v3, we need to use dynamic import
async function fetchWrapper(url: string, options?: any) {
  const { default: fetch } = await import('node-fetch')
  return fetch(url, options)
}

describe('Timeboost Dashboard Tests', () => {
  let serverProcess: ChildProcess
  const serverUrl = 'http://localhost:3001'
  const apiUrl = `${serverUrl}/api`

  before(async function () {
    this.timeout(30000)

    // Start the server
    serverProcess = spawn('yarn', ['timeboost'], {
      env: { ...process.env, PORT: '3001' },
      detached: false,
      shell: true,
    })

    // Wait for server to start
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server failed to start in time'))
      }, 20000)

      serverProcess.stdout?.on('data', data => {
        const output = data.toString()
        console.log('Server output:', output)
        if (output.includes('Timeboost server running')) {
          clearTimeout(timeout)
          resolve()
        }
      })

      serverProcess.stderr?.on('data', data => {
        console.error('Server error:', data.toString())
      })

      serverProcess.on('error', err => {
        clearTimeout(timeout)
        reject(err)
      })
    })

    // Give it a bit more time to fully initialize
    await new Promise(resolve => setTimeout(resolve, 3000))
  })

  after(async () => {
    // Kill the server process
    if (serverProcess) {
      serverProcess.kill('SIGTERM')
      // Force kill if needed
      setTimeout(() => {
        if (!serverProcess.killed) {
          serverProcess.kill('SIGKILL')
        }
      }, 2000)
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  })

  it('should serve the dashboard UI', async () => {
    const response = await fetchWrapper(serverUrl)
    expect(response.status).to.equal(200)

    const html = await response.text()
    expect(html).to.include('Arbitrum Timeboost Dashboard')
    expect(html).to.include('metrics-grid')
  })

  it('should return health status', async () => {
    const response = await fetchWrapper(`${serverUrl}/health`)
    expect(response.status).to.equal(200)

    const data = (await response.json()) as any
    expect(data).to.have.property('status', 'ok')
    expect(data).to.have.property('ethPrice')
    expect(data).to.have.property('lastProcessedBlock')
  })

  it('should return metrics data', async () => {
    const response = await fetchWrapper(`${apiUrl}/metrics`)
    expect(response.status).to.equal(200)

    const data = (await response.json()) as any
    expect(data).to.have.property('totalRounds')
    expect(data).to.have.property('totalRevenue')
    expect(data).to.have.property('averagePricePerRound')
  })

  it('should return bidders data', async () => {
    const response = await fetchWrapper(`${apiUrl}/bidders`)
    expect(response.status).to.equal(200)

    const data = (await response.json()) as any[]
    expect(data).to.be.an('array')
  })

  it('should return recent rounds', async () => {
    const response = await fetchWrapper(`${apiUrl}/rounds/recent`)
    expect(response.status).to.equal(200)

    const data = (await response.json()) as any[]
    expect(data).to.be.an('array')

    if (data.length > 0) {
      const round = data[0]
      expect(round).to.have.property('round')
      expect(round).to.have.property('startTimestamp')
      expect(round).to.have.property('endTimestamp')
    }
  })

  it('should return round details with transactions', async function () {
    this.timeout(15000)

    // First get recent rounds
    const roundsResponse = await fetchWrapper(`${apiUrl}/rounds/recent`)
    const rounds = (await roundsResponse.json()) as any[]

    if (rounds.length > 0) {
      const roundNumber = rounds[0].round

      // Get round details
      const response = await fetchWrapper(`${apiUrl}/rounds/${roundNumber}`)
      expect(response.status).to.equal(200)

      const data = (await response.json()) as any
      expect(data).to.have.property('round', roundNumber)
      expect(data).to.have.property('transactions')
      expect(data.transactions).to.be.an('array')

      // Check transaction structure if any exist
      if (data.transactions.length > 0) {
        const tx = data.transactions[0]
        expect(tx).to.have.property('hash')
        expect(tx).to.have.property('blockNumber')
        expect(tx).to.have.property('arbiscanUrl')
        expect(tx.arbiscanUrl).to.include('https://arbiscan.io/tx/')
      }
    }
  })

  it('should return indexer progress', async () => {
    const response = await fetchWrapper(`${apiUrl}/indexer/progress`)
    expect(response.status).to.equal(200)

    const data = (await response.json()) as any
    expect(data).to.have.property('status')

    if (data.status === 'indexing') {
      expect(data).to.have.property('progress')
      expect(data.progress).to.have.property('currentBlock')
      expect(data.progress).to.have.property('totalBlocks')
      expect(data.progress).to.have.property('processedBlocks')
    }
  })

  it('should return orchestrator status', async function () {
    this.timeout(60000)
    
    // Wait for cache update and orchestrator to start
    await new Promise(resolve => setTimeout(resolve, 20000))
    
    const response = await fetchWrapper(`${apiUrl}/indexer/orchestrator`)
    expect(response.status).to.equal(200)

    const data = (await response.json()) as any
    expect(data).to.have.property('isRunning')
    expect(data).to.have.property('lastIndexedRound')
    expect(data).to.have.property('oldestIndexedRound')
    expect(data).to.have.property('indexingQueueSize')
    expect(data).to.have.property('backfillQueueSize')
    expect(data).to.have.property('activeIndexing')
    
    // Should be running
    expect(data.isRunning).to.equal(true)
    
    // Should have some rounds in queue
    expect(data.indexingQueueSize + data.backfillQueueSize).to.be.greaterThan(0)
  })
})

import express from 'express'
import cors from 'cors'
import path from 'path'
import { ethers } from 'ethers'
import { EventMonitor } from './core/EventMonitor'
import { EventParser } from './core/EventParser'
import { TransactionIndexer, IndexerProgress } from './core/TransactionIndexer'

const app = express()
const PORT = process.env.PORT || 3001
const RPC_URL = process.env.RPC_URL || 'https://arb1.arbitrum.io/rpc'
const ETH_PRICE = parseFloat(process.env.ETH_USD_PRICE || '2600')

// Middleware
app.use(cors())
app.use(express.json())

// Serve static files from the UI directory
app.use(express.static(path.join(__dirname, '../ui')))

// Initialize components
const eventMonitor = new EventMonitor(RPC_URL)
const eventParser = new EventParser()
const transactionIndexer = new TransactionIndexer(RPC_URL)

// Cache for data
let cachedData = {
  metrics: null as any,
  bidders: null as any,
  recentRounds: null as any,
  lastUpdate: 0,
  startBlock: 0
}

// Indexer progress tracking
let indexerProgress: IndexerProgress | null = null

const CACHE_DURATION = 30000 // 30 seconds

// Function to update cache
async function updateCache() {
  try {
    console.log('Updating cache...')
    
    // Get recent blocks to scan
    const provider = new ethers.JsonRpcProvider(RPC_URL)
    const latestBlock = await provider.getBlockNumber()
    const fromBlock = Math.max(1, latestBlock - 10000) // Last ~10k blocks
    
    console.log(`Scanning blocks ${fromBlock} to ${latestBlock}...`)
    
    // Store the starting block
    cachedData.startBlock = fromBlock
    
    // Get events in batches
    const batchSize = 1000
    let allEvents: any[] = []
    
    for (let start = fromBlock; start <= latestBlock; start += batchSize) {
      const end = Math.min(start + batchSize - 1, latestBlock)
      try {
        const events = await eventMonitor.getEvents(start, end)
        allEvents = allEvents.concat(events)
        console.log(`Fetched ${events.length} events from blocks ${start}-${end}`)
      } catch (error) {
        console.error(`Error fetching events for blocks ${start}-${end}:`, error)
      }
    }
    
    // Process all events
    allEvents.forEach(event => eventParser.processEvent(event))
    
    const metrics = eventParser.getKeyMetrics()
    const bidders = eventParser.getBidderStats()
    
    // Update cache
    cachedData = {
      metrics: {
        totalRounds: metrics.totalRounds,
        totalRevenue: eventParser.formatEther(metrics.totalRevenue),
        totalRevenueUSD: eventParser.formatUSD(metrics.totalRevenue, ETH_PRICE),
        averagePricePerRound: eventParser.formatEther(metrics.averagePricePerRound),
        averagePricePerRoundUSD: eventParser.formatUSD(metrics.averagePricePerRound, ETH_PRICE),
        lastProcessedBlock: latestBlock,
        startBlock: fromBlock
      },
      bidders: bidders.map(bidder => ({
        address: bidder.address,
        label: bidder.label,
        roundsWon: bidder.roundsWon,
        totalSpent: eventParser.formatEther(bidder.totalSpent),
        totalSpentUSD: eventParser.formatUSD(bidder.totalSpent, ETH_PRICE),
        currentBalance: eventParser.formatEther(bidder.currentBalance),
        currentBalanceUSD: eventParser.formatUSD(bidder.currentBalance, ETH_PRICE)
      })),
      recentRounds: metrics.recentRounds.map(round => ({
        round: round.round.toString(),
        startTimestamp: Number(round.startTimestamp),
        endTimestamp: Number(round.endTimestamp),
        expressLaneController: round.expressLaneController,
        auctionType: round.auctionType,
        winnerBidder: round.winnerBidder,
        pricePaid: round.pricePaid ? eventParser.formatEther(round.pricePaid) : null,
        pricePaidUSD: round.pricePaid ? eventParser.formatUSD(round.pricePaid, ETH_PRICE) : null,
        auctionTransactionHash: round.auctionTransactionHash,
        transactionCount: round.transactions.length
      })),
      lastUpdate: Date.now(),
      startBlock: fromBlock
    }
    
    console.log('Cache updated successfully')
  } catch (error) {
    console.error('Error updating cache:', error)
  }
}

// Initial cache update
updateCache()

// Update cache periodically
setInterval(updateCache, 60000) // Every minute

// API Routes

app.get('/api/metrics', async (req, res) => {
  try {
    // Return cached data if available and fresh
    if (cachedData.metrics && Date.now() - cachedData.lastUpdate < CACHE_DURATION) {
      return res.json(cachedData.metrics)
    }
    
    // Otherwise return default data
    return res.json({
      totalRounds: 0,
      totalRevenue: '0',
      totalRevenueUSD: '0',
      averagePricePerRound: '0',
      averagePricePerRoundUSD: '0',
      lastProcessedBlock: 0
    })
  } catch (error) {
    console.error('Error in /api/metrics:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/bidders', async (req, res) => {
  try {
    if (cachedData.bidders && Date.now() - cachedData.lastUpdate < CACHE_DURATION) {
      return res.json(cachedData.bidders)
    }
    
    return res.json([])
  } catch (error) {
    console.error('Error in /api/bidders:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/rounds/recent', async (req, res) => {
  try {
    if (cachedData.recentRounds && Date.now() - cachedData.lastUpdate < CACHE_DURATION) {
      return res.json(cachedData.recentRounds)
    }
    
    return res.json([])
  } catch (error) {
    console.error('Error in /api/rounds/recent:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/rounds/:round', async (req, res) => {
  try {
    const roundNumber = BigInt(req.params.round)
    const round = eventParser.getRoundInfo(roundNumber)
    
    if (!round) {
      return res.status(404).json({ error: 'Round not found' })
    }
    
    // Set progress callback for this request
    transactionIndexer.setProgressCallback((progress) => {
      indexerProgress = progress
    })
    
    // Fetch timeboosted transactions for this round
    let transactions: any[] = []
    try {
      const startTime = Number(round.startTimestamp)
      const endTime = Number(round.endTimestamp)
      transactions = await transactionIndexer.getTimeboostedTransactionsForRound(startTime, endTime)
    } catch (txError) {
      console.error('Error fetching timeboosted transactions:', txError)
    }
    
    return res.json({
      round: round.round.toString(),
      startTimestamp: Number(round.startTimestamp),
      endTimestamp: Number(round.endTimestamp),
      expressLaneController: round.expressLaneController,
      auctionType: round.auctionType,
      winnerBidder: round.winnerBidder,
      winnerBidAmount: round.winnerBidAmount ? eventParser.formatEther(round.winnerBidAmount) : null,
      pricePaid: round.pricePaid ? eventParser.formatEther(round.pricePaid) : null,
      pricePaidUSD: round.pricePaid ? eventParser.formatUSD(round.pricePaid, ETH_PRICE) : null,
      auctionTransactionHash: round.auctionTransactionHash,
      transactions: transactions.map(tx => ({
        hash: tx.hash,
        blockNumber: tx.blockNumber,
        timestamp: tx.timestamp,
        from: tx.from,
        to: tx.to,
        value: eventParser.formatEther(tx.value),
        gasUsed: tx.gasUsed.toString(),
        effectiveGasPrice: eventParser.formatEther(tx.effectiveGasPrice),
        arbiscanUrl: `https://arbiscan.io/tx/${tx.hash}`
      }))
    })
  } catch (error) {
    console.error('Error in /api/rounds/:round:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/rounds', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50
    const offset = parseInt(req.query.offset as string) || 0
    
    const allRounds = eventParser.getAllRounds()
    const rounds = allRounds.slice(offset, offset + limit)
    
    const formattedRounds = rounds.map(round => ({
      round: round.round.toString(),
      startTimestamp: Number(round.startTimestamp),
      endTimestamp: Number(round.endTimestamp),
      expressLaneController: round.expressLaneController,
      auctionType: round.auctionType,
      winnerBidder: round.winnerBidder,
      winnerBidAmount: round.winnerBidAmount ? eventParser.formatEther(round.winnerBidAmount) : null,
      pricePaid: round.pricePaid ? eventParser.formatEther(round.pricePaid) : null,
      pricePaidUSD: round.pricePaid ? eventParser.formatUSD(round.pricePaid, ETH_PRICE) : null,
      auctionTransactionHash: round.auctionTransactionHash,
      transactionCount: round.transactions.length
    }))
    
    return res.json({
      rounds: formattedRounds,
      total: allRounds.length,
      limit,
      offset
    })
  } catch (error) {
    console.error('Error in /api/rounds:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/indexer/progress', (req, res) => {
  if (!indexerProgress) {
    return res.json({ status: 'idle' })
  }
  
  return res.json({
    status: 'indexing',
    progress: indexerProgress
  })
})

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    lastProcessedBlock: cachedData.metrics?.lastProcessedBlock || 0,
    ethPrice: ETH_PRICE,
    lastUpdate: cachedData.lastUpdate
  })
})

// Start server
app.listen(PORT, () => {
  console.log(`Timeboost server running on port ${PORT}`)
  console.log(`Dashboard available at: http://localhost:${PORT}`)
  console.log(`RPC URL: ${RPC_URL}`)
  console.log(`ETH Price: $${ETH_PRICE}`)
})
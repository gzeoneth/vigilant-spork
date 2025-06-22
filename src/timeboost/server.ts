import express from 'express'
import cors from 'cors'
import path from 'path'
import { ethers } from 'ethers'
import { EventMonitor } from './core/EventMonitor'
import { EventParser } from './core/EventParser'
import { TransactionIndexer, IndexerProgress } from './core/TransactionIndexer'
import { RoundIndexer, RoundIndexStatus } from './core/RoundIndexer'

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
const roundIndexer = new RoundIndexer(RPC_URL)

// Cache for data
let cachedData = {
  metrics: null as any,
  bidders: null as any,
  recentRounds: null as any,
  lastUpdate: 0,
  startBlock: 0,
}

// Indexer progress tracking
let indexerProgress: IndexerProgress | null = null
let currentRoundIndexStatus: RoundIndexStatus | null = null

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

    // Get events in batches with rate limiting
    const batchSize = 500 // Smaller batches to avoid rate limits
    let allEvents: any[] = []

    for (let start = fromBlock; start <= latestBlock; start += batchSize) {
      const end = Math.min(start + batchSize - 1, latestBlock)
      try {
        const events = await eventMonitor.getEvents(start, end)
        allEvents = allEvents.concat(events)
        console.log(
          `Fetched ${events.length} events from blocks ${start}-${end}`
        )

        // Add delay between batches to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200))
      } catch (error) {
        console.error(
          `Error fetching events for blocks ${start}-${end}:`,
          error
        )
        // Add longer delay on error (might be rate limited)
        await new Promise(resolve => setTimeout(resolve, 1000))
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
        averagePricePerRound: eventParser.formatEther(
          metrics.averagePricePerRound
        ),
        averagePricePerRoundUSD: eventParser.formatUSD(
          metrics.averagePricePerRound,
          ETH_PRICE
        ),
        lastProcessedBlock: latestBlock,
        startBlock: fromBlock,
      },
      bidders: bidders.map(bidder => ({
        address: bidder.address,
        label: bidder.label,
        roundsWon: bidder.roundsWon,
        totalSpent: eventParser.formatEther(bidder.totalSpent),
        totalSpentUSD: eventParser.formatUSD(bidder.totalSpent, ETH_PRICE),
        currentBalance: eventParser.formatEther(bidder.currentBalance),
        currentBalanceUSD: eventParser.formatUSD(
          bidder.currentBalance,
          ETH_PRICE
        ),
      })),
      recentRounds: metrics.recentRounds.map(round => ({
        round: round.round.toString(),
        startTimestamp: Number(round.startTimestamp),
        endTimestamp: Number(round.endTimestamp),
        expressLaneController: round.expressLaneController,
        auctionType: round.auctionType,
        winnerBidder: round.winnerBidder,
        pricePaid: round.pricePaid
          ? eventParser.formatEther(round.pricePaid)
          : null,
        pricePaidUSD: round.pricePaid
          ? eventParser.formatUSD(round.pricePaid, ETH_PRICE)
          : null,
        auctionTransactionHash: round.auctionTransactionHash,
        transactionCount: round.transactions.length,
      })),
      lastUpdate: Date.now(),
      startBlock: fromBlock,
    }

    console.log('Cache updated successfully')
  } catch (error) {
    console.error('Error updating cache:', error)
  }
}

// Initial cache update
updateCache()

// Background fetcher - single threaded execution
let isFetching = false

async function backgroundFetcher() {
  if (isFetching) {
    console.log('Fetcher already running, skipping...')
    return
  }

  isFetching = true

  try {
    await updateCache()
  } catch (error) {
    console.error('Error in background fetcher:', error)
  } finally {
    isFetching = false
  }
}

// Update cache periodically with single-threaded execution
setInterval(backgroundFetcher, 60000) // Every minute

// API Routes

app.get('/api/metrics', async (req, res) => {
  try {
    // Return cached data if available and fresh
    if (
      cachedData.metrics &&
      Date.now() - cachedData.lastUpdate < CACHE_DURATION
    ) {
      return res.json(cachedData.metrics)
    }

    // Otherwise return default data
    return res.json({
      totalRounds: 0,
      totalRevenue: '0',
      totalRevenueUSD: '0',
      averagePricePerRound: '0',
      averagePricePerRoundUSD: '0',
      lastProcessedBlock: 0,
    })
  } catch (error) {
    console.error('Error in /api/metrics:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/bidders', async (req, res) => {
  try {
    if (
      cachedData.bidders &&
      Date.now() - cachedData.lastUpdate < CACHE_DURATION
    ) {
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
    if (
      cachedData.recentRounds &&
      Date.now() - cachedData.lastUpdate < CACHE_DURATION
    ) {
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

    // Check if round is being indexed or cached
    const roundKey = round.round.toString()
    const cachedRound = await roundIndexer.getCachedRound(roundKey)

    if (cachedRound) {
      // Return cached data
      return res.json({
        round: round.round.toString(),
        startTimestamp: Number(round.startTimestamp),
        endTimestamp: Number(round.endTimestamp),
        expressLaneController: round.expressLaneController,
        auctionType: round.auctionType,
        winnerBidder: round.winnerBidder,
        winnerBidAmount: round.winnerBidAmount
          ? eventParser.formatEther(round.winnerBidAmount)
          : null,
        pricePaid: round.pricePaid
          ? eventParser.formatEther(round.pricePaid)
          : null,
        pricePaidUSD: round.pricePaid
          ? eventParser.formatUSD(round.pricePaid, ETH_PRICE)
          : null,
        auctionTransactionHash: round.auctionTransactionHash,
        transactionCount: cachedRound.transactions.length,
        transactions: cachedRound.transactions.map(tx => ({
          hash: tx.hash,
          blockNumber: tx.blockNumber,
          timestamp: tx.timestamp,
          from: tx.from,
          to: tx.to,
          value: eventParser.formatEther(tx.value),
          gasUsed: tx.gasUsed.toString(),
          effectiveGasPrice: eventParser.formatEther(tx.effectiveGasPrice),
          arbiscanUrl: `https://arbiscan.io/tx/${tx.hash}`,
        })),
        indexStatus: 'completed',
      })
    }

    // Check indexing status
    const status = roundIndexer.getRoundStatus(roundKey)

    // Return round info with current indexing status
    return res.json({
      round: round.round.toString(),
      startTimestamp: Number(round.startTimestamp),
      endTimestamp: Number(round.endTimestamp),
      expressLaneController: round.expressLaneController,
      auctionType: round.auctionType,
      winnerBidder: round.winnerBidder,
      winnerBidAmount: round.winnerBidAmount
        ? eventParser.formatEther(round.winnerBidAmount)
        : null,
      pricePaid: round.pricePaid
        ? eventParser.formatEther(round.pricePaid)
        : null,
      pricePaidUSD: round.pricePaid
        ? eventParser.formatUSD(round.pricePaid, ETH_PRICE)
        : null,
      auctionTransactionHash: round.auctionTransactionHash,
      transactionCount: status?.transactionCount || 0,
      transactions: [],
      indexStatus: status?.status || 'not_started',
    })
  } catch (error) {
    console.error('Error in /api/rounds/:round:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/rounds', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const offset = (page - 1) * limit

    const allRounds = eventParser.getAllRounds()
    // Sort rounds by round number descending (newest first)
    const sortedRounds = allRounds.sort((a, b) => Number(b.round - a.round))
    const rounds = sortedRounds.slice(offset, offset + limit)

    // Get indexing status for each round
    const formattedRounds = await Promise.all(
      rounds.map(async round => {
        const roundKey = round.round.toString()
        const status = roundIndexer.getRoundStatus(roundKey)
        const cached = await roundIndexer.getCachedRound(roundKey)

        return {
          round: round.round.toString(),
          startTimestamp: Number(round.startTimestamp),
          endTimestamp: Number(round.endTimestamp),
          expressLaneController: round.expressLaneController,
          auctionType: round.auctionType,
          winnerBidder: round.winnerBidder,
          winnerBidAmount: round.winnerBidAmount
            ? eventParser.formatEther(round.winnerBidAmount)
            : null,
          pricePaid: round.pricePaid
            ? eventParser.formatEther(round.pricePaid)
            : null,
          pricePaidUSD: round.pricePaid
            ? eventParser.formatUSD(round.pricePaid, ETH_PRICE)
            : null,
          auctionTransactionHash: round.auctionTransactionHash,
          transactionCount:
            cached?.transactions.length || status?.transactionCount || 0,
          indexStatus: status?.status || (cached ? 'completed' : 'not_started'),
        }
      })
    )

    const totalPages = Math.ceil(allRounds.length / limit)

    return res.json({
      rounds: formattedRounds,
      pagination: {
        page,
        limit,
        total: allRounds.length,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    })
  } catch (error) {
    console.error('Error in /api/rounds:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/indexer/progress', (req, res) => {
  const roundId = req.query.round as string

  if (roundId) {
    const status = roundIndexer.getRoundStatus(roundId)
    if (status) {
      return res.json({
        round: roundId,
        status: status.status,
        transactionCount: status.transactionCount,
        error: status.error,
      })
    }
  }

  // Return all round statuses
  const allStatuses = roundIndexer.getAllRoundStatuses()
  return res.json({
    rounds: allStatuses,
  })
})

app.post('/api/rounds/:round/index', async (req, res) => {
  try {
    const roundNumber = BigInt(req.params.round)
    const round = eventParser.getRoundInfo(roundNumber)

    if (!round) {
      return res.status(404).json({ error: 'Round not found' })
    }

    // Start indexing
    roundIndexer
      .indexRound(round, status => {
        currentRoundIndexStatus = status
      })
      .catch(error => {
        console.error(`Error indexing round ${round.round}:`, error)
      })

    return res.json({
      message: 'Indexing started',
      round: round.round.toString(),
    })
  } catch (error) {
    console.error('Error in /api/rounds/:round/index:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    lastProcessedBlock: cachedData.metrics?.lastProcessedBlock || 0,
    ethPrice: ETH_PRICE,
    lastUpdate: cachedData.lastUpdate,
  })
})

// Start server
app.listen(PORT, () => {
  console.log(`Timeboost server running on port ${PORT}`)
  console.log(`Dashboard available at: http://localhost:${PORT}`)
  console.log(`RPC URL: ${RPC_URL}`)
  console.log(`ETH Price: $${ETH_PRICE}`)
})

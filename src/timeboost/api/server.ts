import express from 'express'
import cors from 'cors'
import path from 'path'
import { TimeboostIndexer } from '../indexer/TimeboostIndexer'
import { ethers } from 'ethers'

const app = express()
const PORT = process.env.PORT || 3001
const RPC_URL = process.env.RPC_URL || 'https://arb1.arbitrum.io/rpc'
const ETH_PRICE = parseFloat(process.env.ETH_USD_PRICE || '2600')

// Middleware
app.use(cors())
app.use(express.json())

// Serve static files from the UI directory
app.use(express.static(path.join(__dirname, '../../ui')))

// Initialize indexer
const indexer = new TimeboostIndexer({
  rpcUrl: RPC_URL,
  batchSize: 100,
})

// Start indexer
indexer.start().catch(console.error)

// API Routes

// Get overall metrics
app.get('/api/metrics', (req, res) => {
  const parser = indexer.getEventParser()
  const metrics = parser.getKeyMetrics()

  res.json({
    totalRounds: metrics.totalRounds,
    totalRevenue: parser.formatEther(metrics.totalRevenue),
    totalRevenueUSD: parser.formatUSD(metrics.totalRevenue, ETH_PRICE),
    averagePricePerRound: parser.formatEther(metrics.averagePricePerRound),
    averagePricePerRoundUSD: parser.formatUSD(
      metrics.averagePricePerRound,
      ETH_PRICE
    ),
    lastProcessedBlock: indexer.getLastProcessedBlock(),
  })
})

// Get bidder statistics
app.get('/api/bidders', (req, res) => {
  const parser = indexer.getEventParser()
  const bidders = parser.getBidderStats()

  const formattedBidders = bidders.map(bidder => ({
    address: bidder.address,
    label: bidder.label,
    roundsWon: bidder.roundsWon,
    totalSpent: parser.formatEther(bidder.totalSpent),
    totalSpentUSD: parser.formatUSD(bidder.totalSpent, ETH_PRICE),
    currentBalance: parser.formatEther(bidder.currentBalance),
    currentBalanceUSD: parser.formatUSD(bidder.currentBalance, ETH_PRICE),
  }))

  res.json(formattedBidders)
})

// Get rounds
app.get('/api/rounds', (req, res) => {
  const parser = indexer.getEventParser()
  const limit = parseInt(req.query.limit as string) || 50
  const offset = parseInt(req.query.offset as string) || 0

  const allRounds = parser.getAllRounds()
  const rounds = allRounds.slice(offset, offset + limit)

  const formattedRounds = rounds.map(round => ({
    round: round.round.toString(),
    startTimestamp: Number(round.startTimestamp),
    endTimestamp: Number(round.endTimestamp),
    expressLaneController: round.expressLaneController,
    auctionType: round.auctionType,
    winnerBidder: round.winnerBidder,
    winnerBidAmount: round.winnerBidAmount
      ? parser.formatEther(round.winnerBidAmount)
      : null,
    pricePaid: round.pricePaid ? parser.formatEther(round.pricePaid) : null,
    pricePaidUSD: round.pricePaid
      ? parser.formatUSD(round.pricePaid, ETH_PRICE)
      : null,
    transactionCount: round.transactions.length,
  }))

  res.json({
    rounds: formattedRounds,
    total: allRounds.length,
    limit,
    offset,
  })
})

// Get specific round details
app.get('/api/rounds/:round', (req, res) => {
  const parser = indexer.getEventParser()
  const roundNumber = BigInt(req.params.round)

  const round = parser.getRoundInfo(roundNumber)
  if (!round) {
    return res.status(404).json({ error: 'Round not found' })
  }

  const formattedRound = {
    round: round.round.toString(),
    startTimestamp: Number(round.startTimestamp),
    endTimestamp: Number(round.endTimestamp),
    expressLaneController: round.expressLaneController,
    auctionType: round.auctionType,
    winnerBidder: round.winnerBidder,
    winnerBidAmount: round.winnerBidAmount
      ? parser.formatEther(round.winnerBidAmount)
      : null,
    pricePaid: round.pricePaid ? parser.formatEther(round.pricePaid) : null,
    pricePaidUSD: round.pricePaid
      ? parser.formatUSD(round.pricePaid, ETH_PRICE)
      : null,
    transactions: round.transactions.map(tx => ({
      hash: tx.hash,
      blockNumber: tx.blockNumber,
      timestamp: tx.timestamp,
      from: tx.from,
      to: tx.to,
      value: parser.formatEther(tx.value),
      valueUSD: parser.formatUSD(tx.value, ETH_PRICE),
      gasUsed: tx.gasUsed.toString(),
      effectiveGasPrice: tx.effectiveGasPrice.toString(),
      arbiscanUrl: `https://arbiscan.io/tx/${tx.hash}`,
    })),
  }

  res.json(formattedRound)
})

// Get recent rounds
app.get('/api/rounds/recent', (req, res) => {
  const parser = indexer.getEventParser()
  const metrics = parser.getKeyMetrics()

  const formattedRounds = metrics.recentRounds.map(round => ({
    round: round.round.toString(),
    startTimestamp: Number(round.startTimestamp),
    endTimestamp: Number(round.endTimestamp),
    expressLaneController: round.expressLaneController,
    auctionType: round.auctionType,
    winnerBidder: round.winnerBidder,
    pricePaid: round.pricePaid ? parser.formatEther(round.pricePaid) : null,
    pricePaidUSD: round.pricePaid
      ? parser.formatUSD(round.pricePaid, ETH_PRICE)
      : null,
    transactionCount: round.transactions.length,
  }))

  res.json(formattedRounds)
})

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    lastProcessedBlock: indexer.getLastProcessedBlock(),
    ethPrice: ETH_PRICE,
  })
})

// Start server
app.listen(PORT, () => {
  console.log(`Timeboost API server running on port ${PORT}`)
  console.log(`Dashboard available at: http://localhost:${PORT}`)
  console.log(`API endpoints at: http://localhost:${PORT}/api`)
  console.log(`RPC URL: ${RPC_URL}`)
  console.log(`ETH Price: $${ETH_PRICE}`)
})

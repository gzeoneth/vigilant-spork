import express from 'express'
import cors from 'cors'
import path from 'path'

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(cors())
app.use(express.json())

// Serve static files from the UI directory
app.use(express.static(path.join(__dirname, '../ui')))

// Mock API endpoints for testing
app.get('/api/metrics', (req, res) => {
  res.json({
    totalRounds: 1234,
    totalRevenue: '45.6789',
    totalRevenueUSD: '118563.14',
    averagePricePerRound: '0.037',
    averagePricePerRoundUSD: '96.20',
    lastProcessedBlock: 294000000
  })
})

app.get('/api/bidders', (req, res) => {
  res.json([
    {
      address: '0x95c0d21482fd6bc204e588c06632fdb1cf51b018',
      label: 'SeliniCap',
      roundsWon: 456,
      totalSpent: '12.3456',
      totalSpentUSD: '32099.86',
      currentBalance: '2.1234',
      currentBalanceUSD: '5520.84'
    },
    {
      address: '0x2b38a73dd32a2eafe849825a4b515ae5187eda42',
      label: 'Kairos',
      roundsWon: 234,
      totalSpent: '8.7654',
      totalSpentUSD: '22790.04',
      currentBalance: '1.5678',
      currentBalanceUSD: '4076.28'
    }
  ])
})

app.get('/api/rounds/recent', (req, res) => {
  res.json([
    {
      round: '1234',
      startTimestamp: 1700000000,
      endTimestamp: 1700003600,
      expressLaneController: '0x95c0d21482fd6bc204e588c06632fdb1cf51b018',
      auctionType: 'multi',
      winnerBidder: '0x95c0d21482fd6bc204e588c06632fdb1cf51b018',
      pricePaid: '0.05',
      pricePaidUSD: '130.00',
      transactionCount: 42
    },
    {
      round: '1233',
      startTimestamp: 1699996400,
      endTimestamp: 1700000000,
      expressLaneController: '0x2b38a73dd32a2eafe849825a4b515ae5187eda42',
      auctionType: 'single',
      winnerBidder: '0x2b38a73dd32a2eafe849825a4b515ae5187eda42',
      pricePaid: '0.001',
      pricePaidUSD: '2.60',
      transactionCount: 15
    }
  ])
})

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    lastProcessedBlock: 294000000,
    ethPrice: 2600
  })
})

// Start server
app.listen(PORT, () => {
  console.log(`Simple Timeboost server running on port ${PORT}`)
  console.log(`Dashboard available at: http://localhost:${PORT}`)
})
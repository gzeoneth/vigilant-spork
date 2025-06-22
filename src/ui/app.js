const API_URL = 'http://localhost:3001/api'

let isLoading = false
let isConnected = false

async function fetchData(endpoint) {
  try {
    const response = await fetch(`${API_URL}${endpoint}`)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    if (!isConnected) {
      setConnectionStatus(true)
    }
    return await response.json()
  } catch (error) {
    console.error(`Error fetching ${endpoint}:`, error)
    setConnectionStatus(false)
    showError(`Failed to fetch data from ${endpoint}`)
    return null
  }
}

function setConnectionStatus(connected) {
  isConnected = connected
  const indicator = document.getElementById('status-indicator')
  const text = document.getElementById('status-text')

  if (connected) {
    indicator.classList.remove('error')
    text.textContent = 'Connected'
  } else {
    indicator.classList.add('error')
    text.textContent = 'Disconnected'
  }
}

function showError(message) {
  const errorContainer = document.getElementById('error-container')
  errorContainer.innerHTML = `<div class="error">${message}</div>`
  setTimeout(() => {
    errorContainer.innerHTML = ''
  }, 5000)
}

function formatAddress(address) {
  if (!address) return ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function formatTimestamp(timestamp) {
  return new Date(timestamp * 1000).toLocaleString()
}

async function loadMetrics() {
  const metrics = await fetchData('/metrics')
  if (!metrics) return

  const metricsContainer = document.getElementById('metrics')
  metricsContainer.innerHTML = `
        <div class="metric-card">
            <div class="metric-label">Total Rounds</div>
            <div class="metric-value">${metrics.totalRounds.toLocaleString()}</div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Total Revenue</div>
            <div class="metric-value">${parseFloat(metrics.totalRevenue).toFixed(4)} ETH</div>
            <div class="metric-usd">$${parseFloat(metrics.totalRevenueUSD).toLocaleString()}</div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Average Price/Round</div>
            <div class="metric-value">${parseFloat(metrics.averagePricePerRound).toFixed(4)} ETH</div>
            <div class="metric-usd">$${parseFloat(metrics.averagePricePerRoundUSD).toFixed(2)}</div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Last Processed Block</div>
            <div class="metric-value">${metrics.lastProcessedBlock.toLocaleString()}</div>
            ${metrics.startBlock ? `<div class="metric-usd">From block ${metrics.startBlock.toLocaleString()}</div>` : ''}
    `
}

async function loadBidders() {
  const bidders = await fetchData('/bidders')
  if (!bidders || bidders.length === 0) {
    document.getElementById('bidders').innerHTML = '<p>No bidders found</p>'
    return
  }

  const biddersHtml = `
        <table>
            <thead>
                <tr>
                    <th>Rank</th>
                    <th>Bidder</th>
                    <th>Address</th>
                    <th>Rounds Won</th>
                    <th>Total Spent</th>
                    <th>Current Balance</th>
                </tr>
            </thead>
            <tbody>
                ${bidders
                  .slice(0, 10)
                  .map(
                    (bidder, index) => `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${bidder.label}</td>
                        <td class="address">${formatAddress(bidder.address)}</td>
                        <td>${bidder.roundsWon}</td>
                        <td>
                            ${parseFloat(bidder.totalSpent).toFixed(4)} ETH
                            <br>
                            <span class="metric-usd">$${parseFloat(bidder.totalSpentUSD).toLocaleString()}</span>
                        </td>
                        <td>
                            ${parseFloat(bidder.currentBalance).toFixed(4)} ETH
                            <br>
                            <span class="metric-usd">$${parseFloat(bidder.currentBalanceUSD).toLocaleString()}</span>
                        </td>
                    </tr>
                `
                  )
                  .join('')}
            </tbody>
        </table>
    `

  document.getElementById('bidders').innerHTML = biddersHtml
}

async function loadRounds() {
  const data = await fetchData('/rounds/recent')
  if (!data || data.length === 0) {
    document.getElementById('rounds').innerHTML = '<p>No rounds found</p>'
    return
  }

  const roundsHtml = `
        <table>
            <thead>
                <tr>
                    <th>Round</th>
                    <th>Type</th>
                    <th>Controller</th>
                    <th>Winner</th>
                    <th>Price Paid</th>
                    <th>Auction Tx</th>
                    <th>Transactions</th>
                    <th>Time</th>
                </tr>
            </thead>
            <tbody>
                ${data
                  .map(
                    round => `
                    <tr class="clickable-row" onclick="showRoundDetails('${round.round}')">
                        <td>${round.round}</td>
                        <td>
                            ${
                              round.auctionType
                                ? `<span class="auction-type ${round.auctionType}">${round.auctionType === 'multi' ? 'Multi-bid' : 'Single-bid'}</span>`
                                : '-'
                            }
                        </td>
                        <td class="address">
                            ${
                              round.expressLaneController
                                ? `<a href="https://arbiscan.io/address/${round.expressLaneController}" target="_blank" class="transaction-link" onclick="event.stopPropagation()">
                                    ${formatAddress(round.expressLaneController)}
                                    <svg class="external-icon" viewBox="0 0 20 20" fill="currentColor">
                                        <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                                        <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                                    </svg>
                                </a>`
                                : '-'
                            }
                        </td>
                        <td class="address">
                            ${round.winnerBidder ? formatAddress(round.winnerBidder) : '-'}
                        </td>
                        <td>
                            ${
                              round.pricePaid
                                ? `${parseFloat(round.pricePaid).toFixed(4)} ETH<br>
                                <span class="metric-usd">$${parseFloat(round.pricePaidUSD).toFixed(2)}</span>`
                                : '-'
                            }
                        </td>
                        <td>
                            ${
                              round.auctionTransactionHash
                                ? `<a href="https://arbiscan.io/tx/${round.auctionTransactionHash}" target="_blank" class="transaction-link" onclick="event.stopPropagation()">
                                    ${formatAddress(round.auctionTransactionHash)}
                                    <svg class="external-icon" viewBox="0 0 20 20" fill="currentColor">
                                        <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                                        <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                                    </svg>
                                </a>`
                                : '-'
                            }
                        </td>
                        <td>${round.transactionCount}</td>
                        <td>${formatTimestamp(round.startTimestamp)}</td>
                    </tr>
                `
                  )
                  .join('')}
            </tbody>
        </table>
    `

  document.getElementById('rounds').innerHTML = roundsHtml
}

async function refreshData() {
  if (isLoading) return

  isLoading = true

  try {
    await Promise.all([loadMetrics(), loadBidders(), loadRounds()])
  } catch (error) {
    console.error('Error refreshing data:', error)
  } finally {
    isLoading = false
  }
}

// Modal functions
function showRoundDetails(roundNumber) {
  const modal = document.getElementById('roundModal')
  const modalTitle = document.getElementById('modalTitle')
  const modalContent = document.getElementById('modalContent')
  
  modal.style.display = 'block'
  modalTitle.textContent = `Round ${roundNumber} Details`
  modalContent.innerHTML = '<div class="loading"><span class="spinner"></span>Loading round details...</div>'
  
  // Start progress monitoring
  const progressInterval = setInterval(async () => {
    const progress = await fetchData('/indexer/progress')
    if (progress && progress.status === 'indexing') {
      updateProgressDisplay(progress.progress)
    }
  }, 500)
  
  // Fetch round details
  fetchData(`/rounds/${roundNumber}`).then(round => {
    clearInterval(progressInterval)
    if (!round) {
      modalContent.innerHTML = '<div class="error">Failed to load round details</div>'
      return
    }
    
    let transactionsHtml = ''
    if (round.transactions && round.transactions.length > 0) {
      transactionsHtml = `
        <h3 style="margin-top: 30px; margin-bottom: 20px;">Timeboosted Transactions (${round.transactions.length})</h3>
        <table>
          <thead>
            <tr>
              <th>Transaction Hash</th>
              <th>Block</th>
              <th>From</th>
              <th>To</th>
              <th>Value</th>
              <th>Gas Used</th>
              <th>Gas Price</th>
            </tr>
          </thead>
          <tbody>
            ${round.transactions.map(tx => `
              <tr>
                <td>
                  <a href="${tx.arbiscanUrl}" target="_blank" class="transaction-link">
                    ${formatAddress(tx.hash)}
                    <svg class="external-icon" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                      <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                    </svg>
                  </a>
                </td>
                <td>${tx.blockNumber}</td>
                <td class="address">${formatAddress(tx.from)}</td>
                <td class="address">${formatAddress(tx.to)}</td>
                <td>${tx.value} ETH</td>
                <td>${tx.gasUsed}</td>
                <td>${tx.effectiveGasPrice} ETH</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `
    } else {
      transactionsHtml = `
        <div style="margin-top: 30px; padding: 20px; background: #27272a; border-radius: 8px; text-align: center;">
          <p style="color: #71717a;">No timeboosted transactions found for this round</p>
        </div>
      `
    }
    
    modalContent.innerHTML = `
      <div class="round-details">
        <div class="detail-row">
          <span class="detail-label">Round Number</span>
          <span class="detail-value">${round.round}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Start Time</span>
          <span class="detail-value">${formatTimestamp(round.startTimestamp)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">End Time</span>
          <span class="detail-value">${formatTimestamp(round.endTimestamp)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Express Lane Controller</span>
          <span class="detail-value">
            ${round.expressLaneController ? `
              <a href="https://arbiscan.io/address/${round.expressLaneController}" target="_blank" class="transaction-link">
                ${round.expressLaneController}
                <svg class="external-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                  <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                </svg>
              </a>
            ` : 'None'}
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Auction Type</span>
          <span class="detail-value">
            ${round.auctionType ? `<span class="auction-type ${round.auctionType}">${round.auctionType === 'multi' ? 'Multi-bid' : 'Single-bid'}</span>` : '-'}
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Winner Bidder</span>
          <span class="detail-value">${round.winnerBidder || '-'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Price Paid</span>
          <span class="detail-value">
            ${round.pricePaid ? `${round.pricePaid} ETH ($${round.pricePaidUSD})` : '-'}
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Auction Transaction</span>
          <span class="detail-value">
            ${round.auctionTransactionHash ? `
              <a href="https://arbiscan.io/tx/${round.auctionTransactionHash}" target="_blank" class="transaction-link">
                ${formatAddress(round.auctionTransactionHash)}
                <svg class="external-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                  <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                </svg>
              </a>
            ` : '-'}
          </span>
        </div>
      </div>
      <div id="progressContainer"></div>
      ${transactionsHtml}
    `
  })
}

function updateProgressDisplay(progress) {
  const progressContainer = document.getElementById('progressContainer')
  if (!progressContainer) return
  
  const percentage = Math.round((progress.processedBlocks / progress.totalBlocks) * 100)
  
  progressContainer.innerHTML = `
    <div style="margin: 20px 0; padding: 20px; background: #27272a; border-radius: 8px;">
      <h3 style="margin-bottom: 10px;">Indexing Progress</h3>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${percentage}%"></div>
      </div>
      <div class="progress-text">
        ${progress.processedBlocks} / ${progress.totalBlocks} blocks processed (${percentage}%)
      </div>
      <div class="progress-text">
        Found ${progress.foundTransactions} timeboosted transactions
        ${progress.estimatedTimeRemaining ? ` - Est. ${progress.estimatedTimeRemaining}s remaining` : ''}
      </div>
    </div>
  `
}

function closeModal() {
  document.getElementById('roundModal').style.display = 'none'
}

// Close modal when clicking outside
window.onclick = function(event) {
  const modal = document.getElementById('roundModal')
  if (event.target === modal) {
    modal.style.display = 'none'
  }
}

// Initial load
refreshData()

// Auto-refresh every 30 seconds
setInterval(refreshData, 30000)

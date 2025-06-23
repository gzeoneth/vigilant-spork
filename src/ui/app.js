/* eslint-env browser */
const API_URL = window.location.origin + '/api'

let isLoading = false
let isConnected = false
let currentPage = 1
const roundsPerPage = 20
let isInitialLoad = true

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
  const metricsContainer = document.getElementById('metrics')

  // Show loading state if it's the initial load
  if (isInitialLoad) {
    metricsContainer.innerHTML =
      '<div class="loading"><span class="spinner"></span>Loading metrics...</div>'
  }

  const [metrics, orchestratorStatus] = await Promise.all([
    fetchData('/metrics'),
    fetchData('/indexer/orchestrator'),
  ])

  if (!metrics) {
    if (isInitialLoad) {
      metricsContainer.innerHTML =
        '<div class="error">Failed to load metrics</div>'
    }
    return
  }

  // Only update if we have actual data (not default zeros)
  if (metrics.totalRounds > 0 || !isInitialLoad) {
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
        </div>
        ${
          orchestratorStatus
            ? `
        <div class="metric-card">
            <div class="metric-label">Indexer Status</div>
            <div class="metric-value" style="color: ${orchestratorStatus.isRunning ? '#10b981' : '#ef4444'}">
                ${orchestratorStatus.isRunning ? 'Active' : 'Stopped'}
            </div>
            <div class="metric-usd">
                ${orchestratorStatus.activeIndexing} indexing, 
                ${orchestratorStatus.indexingQueueSize} queued
            </div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Indexed Range</div>
            <div class="metric-value">
                ${orchestratorStatus.lastIndexedRound ? `Round ${orchestratorStatus.lastIndexedRound}` : 'N/A'}
            </div>
            <div class="metric-usd">
                ${orchestratorStatus.backfillQueueSize} rounds to backfill
            </div>
        </div>
        `
            : ''
        }
    `
  }
}

async function loadBidders() {
  const biddersContainer = document.getElementById('bidders')

  // Show loading state if it's the initial load
  if (isInitialLoad) {
    biddersContainer.innerHTML =
      '<div class="loading"><span class="spinner"></span>Loading bidders...</div>'
  }

  const bidders = await fetchData('/bidders')
  if (!bidders) {
    if (isInitialLoad) {
      biddersContainer.innerHTML =
        '<div class="error">Failed to load bidders</div>'
    }
    return
  }

  if (bidders.length === 0) {
    if (isInitialLoad) {
      // Keep loading state until we get real data
      return
    }
    biddersContainer.innerHTML = '<p>No bidders found</p>'
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

async function loadRounds(page = 1) {
  currentPage = page
  const roundsContainer = document.getElementById('rounds')

  // Show loading state if it's the initial load
  if (isInitialLoad) {
    roundsContainer.innerHTML =
      '<div class="loading"><span class="spinner"></span>Loading rounds...</div>'
  }

  const data = await fetchData(`/rounds?page=${page}&limit=${roundsPerPage}`)
  if (!data || !data.rounds) {
    if (isInitialLoad) {
      roundsContainer.innerHTML =
        '<div class="error">Failed to load rounds</div>'
    }
    return
  }

  if (data.rounds.length === 0) {
    if (isInitialLoad) {
      // Keep loading state until we get real data
      return
    }
    roundsContainer.innerHTML = '<p>No rounds found</p>'
    return
  }

  const roundsHtml = `
        <div class="pagination" style="margin-bottom: 20px;">
            <button ${!data.pagination.hasPrev ? 'disabled' : ''} onclick="loadRounds(${page - 1})">Previous</button>
            <span>Page ${data.pagination.page} of ${data.pagination.totalPages} (${data.pagination.total} total rounds)</span>
            <button ${!data.pagination.hasNext ? 'disabled' : ''} onclick="loadRounds(${page + 1})">Next</button>
        </div>
        <table>
            <thead>
                <tr>
                    <th>Round</th>
                    <th>Type</th>
                    <th>Controller</th>
                    <th>Winner</th>
                    <th>Price Paid</th>
                    <th>Auction Tx</th>
                    <th>Status</th>
                    <th>Time</th>
                </tr>
            </thead>
            <tbody>
                ${data.rounds
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
                        <td>
                            ${
                              round.indexStatus === 'completed'
                                ? `<span style="color: #10b981;">${round.transactionCount} txs</span>`
                                : round.indexStatus === 'indexing'
                                  ? `<span style="color: #f59e0b;">Indexing...</span>`
                                  : round.indexStatus === 'pending'
                                    ? `<span style="color: #6b7280;">Queued</span>`
                                    : round.indexStatus === 'error'
                                      ? `<span style="color: #ef4444;">Error</span>`
                                      : `<span style="color: #6b7280;">Not indexed</span>`
                            }
                        </td>
                        <td>${formatTimestamp(round.startTimestamp)}</td>
                    </tr>
                `
                  )
                  .join('')}
            </tbody>
        </table>
        <div class="pagination" style="margin-top: 20px;">
            <button ${!data.pagination.hasPrev ? 'disabled' : ''} onclick="loadRounds(${page - 1})">Previous</button>
            <span>Page ${data.pagination.page} of ${data.pagination.totalPages}</span>
            <button ${!data.pagination.hasNext ? 'disabled' : ''} onclick="loadRounds(${page + 1})">Next</button>
        </div>
    `

  document.getElementById('rounds').innerHTML = roundsHtml
}

async function refreshData() {
  if (isLoading) return

  isLoading = true

  try {
    await Promise.all([loadMetrics(), loadBidders(), loadRounds()])
    // Mark initial load as complete after first successful load
    if (isInitialLoad && isConnected) {
      isInitialLoad = false
    }
  } catch (error) {
    console.error('Error refreshing data:', error)
  } finally {
    isLoading = false
  }
}

// Keep track of active intervals to clean them up
let activeProgressInterval = null

// Modal functions
function showRoundDetails(roundNumber) {
  const modal = document.getElementById('roundModal')
  const modalTitle = document.getElementById('modalTitle')
  const modalContent = document.getElementById('modalContent')

  // Clear any existing interval
  if (activeProgressInterval) {
    clearInterval(activeProgressInterval)
    activeProgressInterval = null
  }

  modal.style.display = 'block'
  modalTitle.textContent = `Round ${roundNumber} Details`
  modalContent.innerHTML =
    '<div class="loading"><span class="spinner"></span>Loading round details...</div>'

  // Fetch round details
  fetchData(`/rounds/${roundNumber}`).then(async round => {
    if (!round) {
      modalContent.innerHTML =
        '<div class="error">Failed to load round details</div>'
      return
    }

    // If round is being indexed or needs indexing, show progress
    if (
      round.indexStatus === 'not_started' ||
      round.indexStatus === 'pending' ||
      round.indexStatus === 'indexing'
    ) {
      // If not started, trigger indexing
      if (round.indexStatus === 'not_started') {
        await fetch(`${API_URL}/rounds/${roundNumber}/index`, {
          method: 'POST',
        })
      }

      // Show initial indexing status
      modalContent.innerHTML = getIndexingStatusHtml(round)

      // Start monitoring progress
      activeProgressInterval = setInterval(async () => {
        const updatedRound = await fetchData(`/rounds/${roundNumber}`)
        if (updatedRound) {
          if (
            updatedRound.indexStatus === 'completed' &&
            updatedRound.transactions
          ) {
            clearInterval(activeProgressInterval)
            activeProgressInterval = null
            // Show the complete round details
            displayRoundDetails(updatedRound)
          } else if (updatedRound.indexStatus === 'error') {
            clearInterval(activeProgressInterval)
            activeProgressInterval = null
            modalContent.innerHTML =
              '<div class="error">Error indexing round</div>'
          } else {
            // Update progress display without blinking
            const progressElement = document.getElementById('indexingProgress')
            if (progressElement) {
              progressElement.innerHTML = getProgressText(updatedRound)
            }
          }
        }
      }, 1000)
    } else {
      // Round is already indexed, display it
      displayRoundDetails(round)
    }
  })
}

function getIndexingStatusHtml(round) {
  return `
    <div class="round-details">
      <div class="detail-row">
        <span class="detail-label">Round Number</span>
        <span class="detail-value">${round.round}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Status</span>
        <span class="detail-value" id="indexingProgress">${getProgressText(round)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Start Time</span>
        <span class="detail-value">${formatTimestamp(round.startTimestamp)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">End Time</span>
        <span class="detail-value">${formatTimestamp(round.endTimestamp)}</span>
      </div>
    </div>
    <div style="margin-top: 30px; padding: 20px; background: #27272a; border-radius: 8px; text-align: center;">
      <span class="spinner"></span>
      <p style="color: #71717a; margin-top: 10px;">Indexing timeboosted transactions...</p>
    </div>
  `
}

function getProgressText(round) {
  if (round.indexStatus === 'pending') {
    return '<span style="color: #f59e0b;">Waiting in queue...</span>'
  } else if (round.indexStatus === 'indexing') {
    return `<span style="color: #f59e0b;">Indexing... Found ${round.transactionCount || 0} transactions</span>`
  } else if (round.indexStatus === 'completed') {
    return `<span style="color: #10b981;">Completed - ${round.transactionCount || 0} transactions</span>`
  } else if (round.indexStatus === 'error') {
    return '<span style="color: #ef4444;">Error during indexing</span>'
  }
  return '<span style="color: #6b7280;">Not indexed</span>'
}

function displayRoundDetails(round) {
  const modalContent = document.getElementById('modalContent')
  if (!modalContent) return

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
            ${round.transactions
              .map(
                tx => `
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
            `
              )
              .join('')}
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
        ${
          round.startBlock
            ? `
        <div class="detail-row">
          <span class="detail-label">Start Block</span>
          <span class="detail-value">
            <a href="https://arbiscan.io/block/${round.startBlock}" target="_blank" class="transaction-link">
              ${round.startBlock}
              <svg class="external-icon" viewBox="0 0 20 20" fill="currentColor">
                <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
              </svg>
            </a>
          </span>
        </div>
        `
            : ''
        }
        ${
          round.endBlock
            ? `
        <div class="detail-row">
          <span class="detail-label">End Block</span>
          <span class="detail-value">
            <a href="https://arbiscan.io/block/${round.endBlock}" target="_blank" class="transaction-link">
              ${round.endBlock}
              <svg class="external-icon" viewBox="0 0 20 20" fill="currentColor">
                <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
              </svg>
            </a>
          </span>
        </div>
        `
            : ''
        }
        ${
          round.startBlock && round.endBlock
            ? `
        <div class="detail-row">
          <span class="detail-label">Total Blocks</span>
          <span class="detail-value">${round.endBlock - round.startBlock + 1}</span>
        </div>
        `
            : ''
        }
        <div class="detail-row">
          <span class="detail-label">Express Lane Controller</span>
          <span class="detail-value">
            ${
              round.expressLaneController
                ? `
              <a href="https://arbiscan.io/address/${round.expressLaneController}" target="_blank" class="transaction-link">
                ${round.expressLaneController}
                <svg class="external-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                  <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                </svg>
              </a>
            `
                : 'None'
            }
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
            ${
              round.auctionTransactionHash
                ? `
              <a href="https://arbiscan.io/tx/${round.auctionTransactionHash}" target="_blank" class="transaction-link">
                ${formatAddress(round.auctionTransactionHash)}
                <svg class="external-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                  <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                </svg>
              </a>
            `
                : '-'
            }
          </span>
        </div>
      </div>
      <div id="progressContainer"></div>
      ${transactionsHtml}
    `
}

function updateProgressDisplay(progress) {
  const progressContainer = document.getElementById('progressContainer')
  if (!progressContainer) return

  const percentage = Math.round(
    (progress.processedBlocks / progress.totalBlocks) * 100
  )

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

function updateIndexingStatus(round, progress) {
  const modalContent = document.getElementById('modalContent')
  if (!modalContent) return

  let statusMessage = ''
  if (progress.status === 'pending') {
    statusMessage = 'Waiting in queue...'
  } else if (progress.status === 'indexing') {
    statusMessage = `Indexing... Found ${progress.transactionCount} transactions`
  } else if (progress.status === 'error') {
    statusMessage = `Error: ${progress.error || 'Unknown error'}`
  }

  modalContent.innerHTML = `
    <div class="round-details">
      <div class="detail-row">
        <span class="detail-label">Round Number</span>
        <span class="detail-value">${round.round}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Status</span>
        <span class="detail-value">${statusMessage}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Start Time</span>
        <span class="detail-value">${formatTimestamp(round.startTimestamp)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">End Time</span>
        <span class="detail-value">${formatTimestamp(round.endTimestamp)}</span>
      </div>
    </div>
  `
}

function closeModal() {
  // Clear any active progress interval
  if (activeProgressInterval) {
    clearInterval(activeProgressInterval)
    activeProgressInterval = null
  }
  document.getElementById('roundModal').style.display = 'none'
}

// Close modal when clicking outside
window.onclick = function (event) {
  const modal = document.getElementById('roundModal')
  if (event.target === modal) {
    closeModal()
  }
}

// Initial load
refreshData()

// Auto-refresh every 30 seconds
setInterval(refreshData, 30000)

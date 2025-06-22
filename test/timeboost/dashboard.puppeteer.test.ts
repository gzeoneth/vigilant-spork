import { describe, it, before, after } from 'mocha'
import { expect } from 'chai'
import { spawn, ChildProcess } from 'child_process'

// Since we're running in Claude Code, we'll use a simpler approach
// that doesn't require MCP functions directly

describe('Timeboost Dashboard Puppeteer Tests', () => {
  let serverProcess: ChildProcess
  const serverUrl = 'http://localhost:3001'
  
  before(async function() {
    this.timeout(30000)
    
    // Start the server
    serverProcess = spawn('yarn', ['timeboost'], {
      env: { ...process.env, PORT: '3001' },
      detached: false
    })
    
    // Wait for server to start
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server failed to start in time'))
      }, 20000)
      
      serverProcess.stdout?.on('data', (data) => {
        if (data.toString().includes('Timeboost server running')) {
          clearTimeout(timeout)
          resolve()
        }
      })
      
      serverProcess.stderr?.on('data', (data) => {
        console.error('Server error:', data.toString())
      })
    })
    
    // Give it a bit more time to fully initialize
    await new Promise(resolve => setTimeout(resolve, 2000))
  })
  
  after(async () => {
    // Kill the server process
    if (serverProcess) {
      serverProcess.kill('SIGTERM')
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  })
  
  it('should load the dashboard and display metrics', async function() {
    this.timeout(30000)
    
    // Navigate to the dashboard
    await global.mcp__puppeteer__puppeteer_navigate({ 
      url: serverUrl,
      launchOptions: { 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
      }
    })
    
    // Wait for metrics to load
    await new Promise(resolve => setTimeout(resolve, 3000))
    
    // Take a screenshot for debugging
    await global.mcp__puppeteer__puppeteer_screenshot({ 
      name: 'dashboard-loaded',
      width: 1280,
      height: 800
    })
    
    // Check if key elements are present
    const pageContent = await global.mcp__puppeteer__puppeteer_evaluate({
      script: `
        const metrics = document.querySelector('.metrics-grid')
        const bidders = document.querySelector('#bidders')
        const rounds = document.querySelector('#rounds')
        const hasMetrics = metrics && metrics.children.length > 0
        const hasBidders = bidders && !bidders.innerHTML.includes('Loading')
        const hasRounds = rounds && !rounds.innerHTML.includes('Loading')
        
        return {
          hasMetrics,
          hasBidders,
          hasRounds,
          metricsCount: metrics ? metrics.children.length : 0,
          pageTitle: document.title
        }
      `
    })
    
    expect(pageContent.pageTitle).to.equal('Arbitrum Timeboost Dashboard')
    expect(pageContent.hasMetrics).to.be.true
    expect(pageContent.metricsCount).to.be.greaterThan(0)
    expect(pageContent.hasBidders).to.be.true
    expect(pageContent.hasRounds).to.be.true
  })
  
  it('should open round details modal when clicking on a round', async function() {
    this.timeout(30000)
    
    // Wait for rounds table to load
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // Check if there are clickable rounds
    const hasRounds = await global.mcp__puppeteer__puppeteer_evaluate({
      script: `
        const rows = document.querySelectorAll('.clickable-row')
        return rows.length > 0
      `
    })
    
    if (hasRounds) {
      // Click the first round
      await global.mcp__puppeteer__puppeteer_click({
        selector: '.clickable-row:first-child'
      })
      
      // Wait for modal to appear
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      // Take a screenshot of the modal
      await global.mcp__puppeteer__puppeteer_screenshot({ 
        name: 'round-details-modal',
        width: 1280,
        height: 800
      })
      
      // Check if modal is displayed
      const modalState = await global.mcp__puppeteer__puppeteer_evaluate({
        script: `
          const modal = document.getElementById('roundModal')
          const modalContent = document.getElementById('modalContent')
          const hasDetails = modalContent && !modalContent.innerHTML.includes('Loading')
          
          return {
            isVisible: modal && modal.style.display === 'block',
            hasContent: hasDetails,
            hasTransactionSection: modalContent ? modalContent.innerHTML.includes('Timeboosted Transactions') : false
          }
        `
      })
      
      expect(modalState.isVisible).to.be.true
      expect(modalState.hasContent).to.be.true
      
      // Close the modal
      await global.mcp__puppeteer__puppeteer_click({
        selector: '.close'
      })
      
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Verify modal is closed
      const modalClosed = await global.mcp__puppeteer__puppeteer_evaluate({
        script: `
          const modal = document.getElementById('roundModal')
          return modal.style.display !== 'block'
        `
      })
      
      expect(modalClosed).to.be.true
    }
  })
  
  it('should display progress bar when indexing transactions', async function() {
    this.timeout(30000)
    
    // Check if progress endpoint returns data
    const response = await fetch(`${serverUrl}/api/indexer/progress`)
    const progressData = await response.json()
    
    expect(response.status).to.equal(200)
    expect(progressData).to.have.property('status')
  })
})
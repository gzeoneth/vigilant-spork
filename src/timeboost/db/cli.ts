#!/usr/bin/env node

import { initializeDatabase, closeDatabase } from './utils'
import { Command } from 'commander'

const program = new Command()

program
  .name('timeboost-db')
  .description('CLI tool for Timeboost database management')
  .version('1.0.0')

program
  .command('stats')
  .description('Show database statistics')
  .option('-d, --database <path>', 'Path to database file')
  .action(async options => {
    try {
      const repo = await initializeDatabase({ path: options.database })
      const stats = await repo.getStats()

      console.log('\n📊 Timeboost Database Statistics:')
      console.log('================================')
      console.log(`Total Rounds: ${stats.total_rounds}`)
      console.log(`Total Transactions: ${stats.total_transactions}`)
      console.log(
        `Timeboosted Transactions: ${stats.total_timeboosted_transactions}`
      )
      console.log(`Total Bidders: ${stats.total_bidders}`)
      console.log(`Last Indexed Round: ${stats.last_indexed_round || 'None'}`)
      console.log(`Last Indexed Block: ${stats.last_indexed_block || 'None'}`)

      await closeDatabase()
    } catch (error) {
      console.error('Error:', error)
      process.exit(1)
    }
  })

program
  .command('rounds')
  .description('List recent rounds')
  .option('-d, --database <path>', 'Path to database file')
  .option('-l, --limit <number>', 'Number of rounds to show', '10')
  .action(async options => {
    try {
      const repo = await initializeDatabase({ path: options.database })
      const { rounds, total } = await repo.rounds.findAll(
        1,
        parseInt(options.limit)
      )

      console.log(
        `\n📅 Recent Rounds (showing ${rounds.length} of ${total} total):`
      )
      console.log('================================================')

      for (const round of rounds) {
        console.log(`\nRound #${round.round_number}`)
        console.log(
          `  Start: ${new Date(round.start_timestamp * 1000).toISOString()}`
        )
        console.log(
          `  End: ${new Date(round.end_timestamp * 1000).toISOString()}`
        )
        console.log(`  Controller: ${round.express_lane_controller || 'None'}`)
        console.log(`  Winning Bid: ${round.winning_bid_amount || '0'} wei`)
        console.log(
          `  Transactions: ${round.total_transactions} (${round.total_timeboosted} timeboosted)`
        )
        console.log(`  Status: ${round.indexed ? 'Indexed' : 'Pending'}`)
      }

      await closeDatabase()
    } catch (error) {
      console.error('Error:', error)
      process.exit(1)
    }
  })

program
  .command('bidders')
  .description('List top bidders')
  .option('-d, --database <path>', 'Path to database file')
  .option('-l, --limit <number>', 'Number of bidders to show', '10')
  .action(async options => {
    try {
      const repo = await initializeDatabase({ path: options.database })
      const bidders = await repo.bidders.findTop(parseInt(options.limit))

      console.log(`\n🏆 Top Bidders (showing ${bidders.length}):`)
      console.log('================================')

      for (const [index, bidder] of bidders.entries()) {
        console.log(`\n${index + 1}. ${bidder.address}`)
        console.log(`   Wins: ${bidder.total_wins}`)
        console.log(`   Total Bid: ${bidder.total_bid_amount} wei`)
        if (bidder.last_win_round) {
          console.log(`   Last Win: Round #${bidder.last_win_round}`)
        }
      }

      await closeDatabase()
    } catch (error) {
      console.error('Error:', error)
      process.exit(1)
    }
  })

program
  .command('transactions')
  .description('List recent timeboosted transactions')
  .option('-d, --database <path>', 'Path to database file')
  .option('-l, --limit <number>', 'Number of transactions to show', '10')
  .action(async options => {
    try {
      const repo = await initializeDatabase({ path: options.database })
      const transactions = await repo.transactions.getRecentTimeboosted(
        parseInt(options.limit)
      )

      console.log(
        `\n⚡ Recent Timeboosted Transactions (showing ${transactions.length}):`
      )
      console.log('==================================================')

      for (const tx of transactions) {
        console.log(`\nTx: ${tx.transaction_hash}`)
        console.log(`  Block: ${tx.block_number}`)
        console.log(`  From: ${tx.from_address}`)
        console.log(`  To: ${tx.to_address || 'Contract Creation'}`)
        console.log(`  Value: ${tx.value} wei`)
        console.log(`  Gas Used: ${tx.gas_used}`)
        console.log(`  Round: #${tx.round_number}`)
      }

      await closeDatabase()
    } catch (error) {
      console.error('Error:', error)
      process.exit(1)
    }
  })

program.parse()

import { ethers } from 'ethers'
import { AllTimeboostEvents } from './types'
import { BatchProvider } from './BatchProvider'
import expressLaneAuctionABI from '../../../node_modules/@arbitrum/nitro-contracts/build/contracts/src/express-lane-auction/ExpressLaneAuction.sol/ExpressLaneAuction.json'

export class EventMonitor {
  private provider: BatchProvider
  private contract: ethers.Contract
  private readonly EXPRESS_LANE_AUCTION_ADDRESS =
    '0x5fcb496a31b7AE91e7c9078Ec662bd7A55cd3079'

  constructor(rpcUrl: string) {
    this.provider = new BatchProvider(rpcUrl, {
      batchSize: 100,
      batchDelay: 50,
      requestsPerSecond: 10,
    })
    this.contract = new ethers.Contract(
      this.EXPRESS_LANE_AUCTION_ADDRESS,
      expressLaneAuctionABI.abi,
      this.provider
    )
  }

  async getEvents(
    fromBlock: number,
    toBlock: number,
    eventName?: string
  ): Promise<AllTimeboostEvents[]> {
    const logs = eventName
      ? await this.contract.queryFilter(
          this.contract.filters[eventName](),
          fromBlock,
          toBlock
        )
      : await this.contract.queryFilter('*', fromBlock, toBlock)
    const events: AllTimeboostEvents[] = []

    // Batch fetch all blocks
    const blockNumbers = [...new Set(logs.map(log => log.blockNumber))]
    const blockPromises = blockNumbers.map(num => this.provider.getBlock(num))
    const blocks = await Promise.all(blockPromises)
    const blockMap = new Map(blocks.map((block, i) => [blockNumbers[i], block]))

    for (const log of logs) {
      const block = blockMap.get(log.blockNumber)
      const eventLog = log as ethers.EventLog
      const eventData = {
        name: eventLog.eventName || '',
        transactionHash: eventLog.transactionHash,
        blockNumber: eventLog.blockNumber,
        timestamp: block?.timestamp || 0,
        args: this.parseEventArgs(eventLog.eventName || '', eventLog.args),
      } as AllTimeboostEvents

      events.push(eventData)
    }

    return events
  }

  private parseEventArgs(eventName: string, args: any): any {
    switch (eventName) {
      case 'AuctionResolved':
        return {
          isMultiBid: args[0],
          round: args[1],
          winnerBidder: args[2],
          winnerExpressLaneController: args[3],
          winnerBidAmount: args[4],
          pricePaid: args[5],
          roundStart: args[6],
          roundEnd: args[7],
        }
      case 'SetExpressLaneController':
        return {
          round: args[0],
          prevExpressLaneController: args[1],
          newExpressLaneController: args[2],
          transferor: args[3],
          startTimestamp: args[4],
          endTimestamp: args[5],
        }
      case 'Deposit':
        return {
          account: args[0],
          amount: args[1],
        }
      case 'WithdrawalInitiated':
        return {
          account: args[0],
          amount: args[1],
          withdrawalRound: args[2],
        }
      case 'WithdrawalFinalized':
        return {
          account: args[0],
          amount: args[1],
        }
      case 'SetReservePrice':
        return {
          oldReservePrice: args[0],
          newReservePrice: args[1],
        }
      case 'SetBeneficiary':
        return {
          oldBeneficiary: args[0],
          newBeneficiary: args[1],
        }
      case 'SetRoundTimingInfo':
        return {
          currentRound: args[0],
          offsetTimestamp: args[1],
          roundDurationSeconds: args[2],
          auctionClosingSeconds: args[3],
          reserveSubmissionSeconds: args[4],
        }
      case 'SetMinReservePrice':
        return {
          oldMinReservePrice: args[0],
          newMinReservePrice: args[1],
        }
      case 'SetTransferor':
        return {
          expressLaneController: args[0],
          transferor: args[1],
          fixedUntilRound: args[2],
        }
      default:
        return args
    }
  }

  async subscribeToEvents(
    callback: (event: AllTimeboostEvents) => void
  ): Promise<void> {
    const eventNames = [
      'AuctionResolved',
      'SetExpressLaneController',
      'Deposit',
      'WithdrawalInitiated',
      'WithdrawalFinalized',
      'SetReservePrice',
      'SetBeneficiary',
      'SetRoundTimingInfo',
      'SetMinReservePrice',
      'SetTransferor',
    ]

    for (const eventName of eventNames) {
      this.contract.on(eventName, async (...args) => {
        const event = args[args.length - 1]
        const block = await this.provider.getBlock(event.blockNumber)
        const eventData = {
          name: eventName,
          transactionHash: event.transactionHash,
          blockNumber: event.blockNumber,
          timestamp: block?.timestamp || 0,
          args: this.parseEventArgs(eventName, args.slice(0, -1)),
        } as AllTimeboostEvents

        callback(eventData)
      })
    }
  }

  async getCurrentRound(): Promise<bigint> {
    return await this.contract.currentRound()
  }

  async getRoundTimestamps(
    round: bigint
  ): Promise<{ start: bigint; end: bigint }> {
    const [start, end] = await this.contract.roundTimestamps(round)
    return { start, end }
  }

  async getReservePrice(): Promise<bigint> {
    return await this.contract.reservePrice()
  }

  async getBeneficiary(): Promise<string> {
    return await this.contract.beneficiary()
  }

  async getBalanceOf(address: string): Promise<bigint> {
    return await this.contract.balanceOf(address)
  }

  async getRoundTimingInfo(): Promise<{
    offsetTimestamp: bigint
    roundDurationSeconds: bigint
    auctionClosingSeconds: bigint
    reserveSubmissionSeconds: bigint
  }> {
    const info = await this.contract.roundTimingInfo()
    return {
      offsetTimestamp: info.offsetTimestamp,
      roundDurationSeconds: info.roundDurationSeconds,
      auctionClosingSeconds: info.auctionClosingSeconds,
      reserveSubmissionSeconds: info.reserveSubmissionSeconds,
    }
  }

  async getEventsForRoundBlocks(
    roundNumber: bigint,
    startBlock: number,
    endBlock: number
  ): Promise<AllTimeboostEvents[]> {
    // Fetch events related to this specific round number
    const auctionEvents = await this.getEvents(
      startBlock,
      endBlock,
      'AuctionResolved'
    )
    const controllerEvents = await this.getEvents(
      startBlock,
      endBlock,
      'SetExpressLaneController'
    )
    
    // Filter events that belong to this round
    const roundEvents = [...auctionEvents, ...controllerEvents].filter(event => {
      if (event.name === 'AuctionResolved') {
        return event.args.round === roundNumber
      } else if (event.name === 'SetExpressLaneController') {
        return event.args.round === roundNumber
      }
      return false
    })
    
    return roundEvents
  }
}

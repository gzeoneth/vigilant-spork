import { ethers } from 'ethers'
import {
  AllTimeboostEvents,
  AuctionResolved,
  SetExpressLaneController,
  RoundInfo,
  BidderInfo,
  Deposit,
  WithdrawalInitiated,
  WithdrawalFinalized,
} from './types'

export class EventParser {
  private rounds: Map<string, RoundInfo> = new Map()
  private bidders: Map<string, BidderInfo> = new Map()
  private reservePrice: bigint = 0n
  private beneficiary: string = ''

  private knownBidders: { [address: string]: string } = {
    '0x95c0d21482fd6bc204e588c06632fdb1cf51b018': 'SeliniCap',
    '0x2b38a73dd32a2eafe849825a4b515ae5187eda42': 'Kairos',
  }

  processEvent(event: AllTimeboostEvents): void {
    switch (event.name) {
      case 'AuctionResolved':
        this.processAuctionResolved(event as AuctionResolved)
        break
      case 'SetExpressLaneController':
        this.processSetExpressLaneController(event as SetExpressLaneController)
        break
      case 'Deposit':
        this.processDeposit(event as Deposit)
        break
      case 'WithdrawalInitiated':
        this.processWithdrawalInitiated(event as WithdrawalInitiated)
        break
      case 'WithdrawalFinalized':
        this.processWithdrawalFinalized(event as WithdrawalFinalized)
        break
      case 'SetReservePrice':
        this.reservePrice = event.args.newReservePrice
        break
      case 'SetBeneficiary':
        this.beneficiary = event.args.newBeneficiary
        break
    }
  }

  private processAuctionResolved(event: AuctionResolved): void {
    const roundKey = event.args.round.toString()
    const round =
      this.rounds.get(roundKey) || this.createRoundInfo(event.args.round)

    round.auctionType = event.args.isMultiBid ? 'multi' : 'single'
    round.winnerBidder = event.args.winnerBidder
    round.winnerBidAmount = event.args.winnerBidAmount
    round.pricePaid = event.args.pricePaid
    round.startTimestamp = event.args.roundStart
    round.endTimestamp = event.args.roundEnd
    round.expressLaneController = event.args.winnerExpressLaneController
    round.auctionTransactionHash = event.transactionHash

    this.rounds.set(roundKey, round)

    // Update bidder info
    this.updateBidderInfo(event.args.winnerBidder, event.args.pricePaid, true)
  }

  private processSetExpressLaneController(
    event: SetExpressLaneController
  ): void {
    const roundKey = event.args.round.toString()
    const round =
      this.rounds.get(roundKey) || this.createRoundInfo(event.args.round)

    round.expressLaneController = event.args.newExpressLaneController
    round.startTimestamp = event.args.startTimestamp
    round.endTimestamp = event.args.endTimestamp

    this.rounds.set(roundKey, round)
  }

  private processDeposit(event: Deposit): void {
    this.updateBidderBalance(event.args.account, event.args.amount, 'deposit')
  }

  private processWithdrawalInitiated(event: WithdrawalInitiated): void {
    // Track pending withdrawal
    const bidder = this.getBidderInfo(event.args.account)
    bidder.totalWithdrawals += event.args.amount
    this.bidders.set(event.args.account.toLowerCase(), bidder)
  }

  private processWithdrawalFinalized(event: WithdrawalFinalized): void {
    this.updateBidderBalance(
      event.args.account,
      event.args.amount,
      'withdrawal'
    )
  }

  private createRoundInfo(round: bigint): RoundInfo {
    return {
      round,
      startTimestamp: 0n,
      endTimestamp: 0n,
      expressLaneController: '',
      auctionType: null,
      winnerBidder: null,
      winnerBidAmount: null,
      pricePaid: null,
      auctionTransactionHash: null,
      transactions: [],
    }
  }

  private getBidderInfo(address: string): BidderInfo {
    const key = address.toLowerCase()
    return (
      this.bidders.get(key) || {
        address,
        label: this.knownBidders[key] || address.slice(0, 6),
        totalDeposits: 0n,
        totalWithdrawals: 0n,
        currentBalance: 0n,
        roundsWon: 0,
        totalSpent: 0n,
      }
    )
  }

  private updateBidderInfo(
    address: string,
    pricePaid: bigint,
    won: boolean
  ): void {
    const bidder = this.getBidderInfo(address)
    if (won) {
      bidder.roundsWon++
      bidder.totalSpent += pricePaid
      bidder.currentBalance -= pricePaid
    }
    this.bidders.set(address.toLowerCase(), bidder)
  }

  private updateBidderBalance(
    address: string,
    amount: bigint,
    type: 'deposit' | 'withdrawal'
  ): void {
    const bidder = this.getBidderInfo(address)
    if (type === 'deposit') {
      bidder.totalDeposits += amount
      bidder.currentBalance += amount
    } else {
      bidder.currentBalance -= amount
    }
    this.bidders.set(address.toLowerCase(), bidder)
  }

  getRoundInfo(round: bigint): RoundInfo | undefined {
    return this.rounds.get(round.toString())
  }

  getAllRounds(): RoundInfo[] {
    return Array.from(this.rounds.values()).sort((a, b) =>
      Number(a.round - b.round)
    )
  }

  getBidderStats(): BidderInfo[] {
    return Array.from(this.bidders.values()).sort(
      (a, b) => b.roundsWon - a.roundsWon
    )
  }

  getKeyMetrics(): {
    totalRounds: number
    totalRevenue: bigint
    averagePricePerRound: bigint
    topBidders: BidderInfo[]
    recentRounds: RoundInfo[]
  } {
    const rounds = this.getAllRounds()
    const totalRevenue = rounds.reduce(
      (sum, round) => sum + (round.pricePaid || 0n),
      0n
    )

    const completedRounds = rounds.filter(r => r.pricePaid !== null)
    const averagePricePerRound =
      completedRounds.length > 0
        ? totalRevenue / BigInt(completedRounds.length)
        : 0n

    return {
      totalRounds: rounds.length,
      totalRevenue,
      averagePricePerRound,
      topBidders: this.getBidderStats().slice(0, 5),
      recentRounds: rounds.slice(-10).reverse(),
    }
  }

  formatEther(value: bigint): string {
    return ethers.formatEther(value)
  }

  formatUSD(ethValue: bigint, ethPrice: number): string {
    const eth = parseFloat(this.formatEther(ethValue))
    return (eth * ethPrice).toFixed(2)
  }
}

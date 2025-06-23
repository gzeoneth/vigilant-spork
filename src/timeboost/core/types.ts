export interface TimeboostEvent {
  name: string
  transactionHash: string
  blockNumber: number
  timestamp: number
  args: any
}

export interface AuctionResolved extends TimeboostEvent {
  name: 'AuctionResolved'
  args: {
    isMultiBid: boolean
    round: bigint
    winnerBidder: string
    winnerExpressLaneController: string
    winnerBidAmount: bigint
    pricePaid: bigint
    roundStart: bigint
    roundEnd: bigint
  }
}

export interface SetExpressLaneController extends TimeboostEvent {
  name: 'SetExpressLaneController'
  args: {
    round: bigint
    prevExpressLaneController: string
    newExpressLaneController: string
    transferor: string
    startTimestamp: bigint
    endTimestamp: bigint
  }
}

export interface Deposit extends TimeboostEvent {
  name: 'Deposit'
  args: {
    account: string
    amount: bigint
  }
}

export interface WithdrawalInitiated extends TimeboostEvent {
  name: 'WithdrawalInitiated'
  args: {
    account: string
    amount: bigint
    withdrawalRound: bigint
  }
}

export interface WithdrawalFinalized extends TimeboostEvent {
  name: 'WithdrawalFinalized'
  args: {
    account: string
    amount: bigint
  }
}

export interface SetReservePrice extends TimeboostEvent {
  name: 'SetReservePrice'
  args: {
    oldReservePrice: bigint
    newReservePrice: bigint
  }
}

export interface SetBeneficiary extends TimeboostEvent {
  name: 'SetBeneficiary'
  args: {
    oldBeneficiary: string
    newBeneficiary: string
  }
}

export interface SetRoundTimingInfo extends TimeboostEvent {
  name: 'SetRoundTimingInfo'
  args: {
    currentRound: bigint
    offsetTimestamp: bigint
    roundDurationSeconds: bigint
    auctionClosingSeconds: bigint
    reserveSubmissionSeconds: bigint
  }
}

export interface SetMinReservePrice extends TimeboostEvent {
  name: 'SetMinReservePrice'
  args: {
    oldMinReservePrice: bigint
    newMinReservePrice: bigint
  }
}

export interface SetTransferor extends TimeboostEvent {
  name: 'SetTransferor'
  args: {
    expressLaneController: string
    transferor: string
    fixedUntilRound: bigint
  }
}

export type AllTimeboostEvents =
  | AuctionResolved
  | SetExpressLaneController
  | Deposit
  | WithdrawalInitiated
  | WithdrawalFinalized
  | SetReservePrice
  | SetBeneficiary
  | SetRoundTimingInfo
  | SetMinReservePrice
  | SetTransferor

export interface TimeboostedTransaction {
  hash: string
  blockNumber: number
  timestamp: number
  from: string
  to: string
  value: bigint
  gasUsed: bigint
  effectiveGasPrice: bigint
  timeboosted: boolean
}

export interface RoundInfo {
  round: bigint
  startTimestamp: bigint
  endTimestamp: bigint
  expressLaneController: string
  auctionType: 'single' | 'multi' | null
  winnerBidder: string | null
  winnerBidAmount: bigint | null
  pricePaid: bigint | null
  auctionTransactionHash: string | null
  transactions: TimeboostedTransaction[]
  startBlock?: number
  endBlock?: number
}

export interface BidderInfo {
  address: string
  label: string
  totalDeposits: bigint
  totalWithdrawals: bigint
  currentBalance: bigint
  roundsWon: number
  totalSpent: bigint
}

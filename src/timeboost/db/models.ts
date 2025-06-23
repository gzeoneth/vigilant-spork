// Database model interfaces for the timeboost indexer

export interface EventRecord {
  id?: number
  transaction_hash: string
  block_number: number
  log_index: number
  event_name: string
  event_data: string // JSON string
  round_number?: number
  timestamp: number
  created_at?: string
}

export interface RoundRecord {
  round_number: number
  start_timestamp: number
  end_timestamp: number
  express_lane_controller?: string
  winning_bid_amount?: string // BigInt as string
  auction_closed: boolean
  total_transactions: number
  total_timeboosted: number
  indexed: boolean
  last_indexed_block?: number
  start_block?: number
  end_block?: number
  created_at?: string
  updated_at?: string
}

export interface TransactionRecord {
  id?: number
  transaction_hash: string
  block_number: number
  transaction_index: number
  from_address: string
  to_address?: string
  value: string // BigInt as string
  gas_used: string // BigInt as string
  gas_price: string // BigInt as string
  is_timeboosted: boolean
  round_number: number
  timestamp: number
  created_at?: string
}

export interface BidderRecord {
  address: string
  total_wins: number
  total_bid_amount: string // BigInt as string
  last_win_round?: number
  last_win_timestamp?: number
  created_at?: string
  updated_at?: string
}

export interface IndexingStatusRecord {
  id?: number
  round_number: number
  status: 'pending' | 'indexing' | 'completed' | 'failed'
  started_at?: string
  completed_at?: string
  error_message?: string
  blocks_indexed: number
  transactions_indexed: number
  created_at?: string
  updated_at?: string
}

export interface DatabaseStats {
  total_rounds: number
  total_transactions: number
  total_timeboosted_transactions: number
  total_bidders: number
  last_indexed_round?: number
  last_indexed_block?: number
}

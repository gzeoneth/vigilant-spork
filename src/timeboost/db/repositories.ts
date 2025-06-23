import { TimeboostDatabase } from './Database'
import {
  EventRecord,
  RoundRecord,
  TransactionRecord,
  BidderRecord,
  IndexingStatusRecord,
} from './models'

export class EventRepository {
  constructor(private db: TimeboostDatabase) {}

  async create(event: EventRecord): Promise<void> {
    this.db.insertEvent(event)
  }

  async findByRound(roundNumber: number): Promise<EventRecord[]> {
    return this.db.getEventsByRound(roundNumber)
  }

  async findByEventName(
    eventName: string,
    limit: number = 100
  ): Promise<EventRecord[]> {
    const stmt = this.db['db'].prepare(`
      SELECT * FROM events 
      WHERE event_name = ? 
      ORDER BY block_number DESC, log_index DESC 
      LIMIT ?
    `)

    return stmt.all(eventName, limit) as EventRecord[]
  }
}

export class RoundRepository {
  constructor(private db: TimeboostDatabase) {}

  async create(round: RoundRecord): Promise<void> {
    this.db.insertRound(round)
  }

  async findByNumber(roundNumber: number): Promise<RoundRecord | undefined> {
    return this.db.getRound(roundNumber)
  }

  async findAll(
    page: number = 1,
    pageSize: number = 10
  ): Promise<{ rounds: RoundRecord[]; total: number }> {
    const offset = (page - 1) * pageSize
    const rounds = this.db.getRounds(pageSize, offset)

    const countStmt = this.db['db'].prepare(
      'SELECT COUNT(*) as total FROM rounds'
    )
    const { total } = countStmt.get() as { total: number }

    return { rounds, total }
  }

  async findUnindexed(limit: number = 10): Promise<RoundRecord[]> {
    const stmt = this.db['db'].prepare(`
      SELECT * FROM rounds 
      WHERE indexed = 0 
      ORDER BY round_number ASC 
      LIMIT ?
    `)

    const rows = stmt.all(limit) as any[]

    return rows.map(row => ({
      ...row,
      auction_closed: Boolean(row.auction_closed),
      indexed: false,
    })) as RoundRecord[]
  }

  async updateStats(
    roundNumber: number,
    totalTransactions: number,
    totalTimeboosted: number
  ): Promise<void> {
    this.db.updateRoundStats(roundNumber, totalTransactions, totalTimeboosted)
  }

  async markAsIndexed(roundNumber: number, lastBlock: number): Promise<void> {
    const stmt = this.db['db'].prepare(`
      UPDATE rounds 
      SET indexed = 1, last_indexed_block = ? 
      WHERE round_number = ?
    `)

    stmt.run(lastBlock, roundNumber)
  }

  async updateBlockRange(
    roundNumber: number,
    startBlock: number,
    endBlock: number
  ): Promise<void> {
    const stmt = this.db['db'].prepare(`
      UPDATE rounds 
      SET start_block = ?, end_block = ? 
      WHERE round_number = ?
    `)

    stmt.run(startBlock, endBlock, roundNumber)
  }

  async findPartiallyIndexed(limit: number = 10): Promise<RoundRecord[]> {
    const stmt = this.db['db'].prepare(`
      SELECT r.* FROM rounds r
      LEFT JOIN indexing_status s ON r.round_number = s.round_number
      WHERE r.indexed = 0 
      AND s.status = 'indexing'
      AND s.started_at < datetime('now', '-30 minutes')
      ORDER BY r.round_number ASC 
      LIMIT ?
    `)

    const rows = stmt.all(limit) as any[]

    return rows.map(row => ({
      ...row,
      auction_closed: Boolean(row.auction_closed),
      indexed: false,
    })) as RoundRecord[]
  }

  async findGapRounds(minRound: number, maxRound: number): Promise<number[]> {
    const stmt = this.db['db'].prepare(`
      WITH RECURSIVE 
      range_cte(n) AS (
        SELECT ?
        UNION ALL
        SELECT n + 1 FROM range_cte WHERE n < ?
      )
      SELECT n as round_number FROM range_cte
      WHERE n NOT IN (SELECT round_number FROM rounds WHERE indexed = 1)
      ORDER BY n ASC
    `)

    const rows = stmt.all(minRound, maxRound) as { round_number: number }[]
    return rows.map(row => row.round_number)
  }
}

export class TransactionRepository {
  constructor(private db: TimeboostDatabase) {}

  async create(transaction: TransactionRecord): Promise<void> {
    this.db.insertTransaction(transaction)
  }

  async createBatch(transactions: TransactionRecord[]): Promise<void> {
    this.db.insertTransactionsBatch(transactions)
  }

  async findByRound(
    roundNumber: number,
    page?: number,
    pageSize?: number
  ): Promise<{ transactions: TransactionRecord[]; total: number }> {
    const countStmt = this.db['db'].prepare(
      'SELECT COUNT(*) as total FROM transactions WHERE round_number = ?'
    )
    const { total } = countStmt.get(roundNumber) as { total: number }

    let transactions: TransactionRecord[]
    if (page && pageSize) {
      const offset = (page - 1) * pageSize
      transactions = this.db.getTransactionsByRound(
        roundNumber,
        pageSize,
        offset
      )
    } else {
      transactions = this.db.getTransactionsByRound(roundNumber)
    }

    return { transactions, total }
  }

  async findTimeboostedByRound(
    roundNumber: number
  ): Promise<TransactionRecord[]> {
    return this.db.getTimeboostedTransactionsByRound(roundNumber)
  }

  async findByHash(hash: string): Promise<TransactionRecord | undefined> {
    const stmt = this.db['db'].prepare(
      'SELECT * FROM transactions WHERE transaction_hash = ?'
    )
    const row = stmt.get(hash) as any

    if (!row) return undefined

    return {
      ...row,
      is_timeboosted: Boolean(row.is_timeboosted),
    } as TransactionRecord
  }

  async getRecentTimeboosted(limit: number = 10): Promise<TransactionRecord[]> {
    const stmt = this.db['db'].prepare(`
      SELECT * FROM transactions 
      WHERE is_timeboosted = 1 
      ORDER BY block_number DESC, transaction_index DESC 
      LIMIT ?
    `)

    const rows = stmt.all(limit) as any[]

    return rows.map(row => ({
      ...row,
      is_timeboosted: true,
    })) as TransactionRecord[]
  }
}

export class BidderRepository {
  constructor(private db: TimeboostDatabase) {}

  async upsert(bidder: BidderRecord): Promise<void> {
    this.db.upsertBidder(bidder)
  }

  async findByAddress(address: string): Promise<BidderRecord | undefined> {
    return this.db.getBidder(address)
  }

  async findTop(limit: number = 10): Promise<BidderRecord[]> {
    return this.db.getTopBidders(limit)
  }

  async getRecentWinners(limit: number = 5): Promise<BidderRecord[]> {
    const stmt = this.db['db'].prepare(`
      SELECT * FROM bidders 
      WHERE last_win_round IS NOT NULL 
      ORDER BY last_win_timestamp DESC 
      LIMIT ?
    `)

    return stmt.all(limit) as BidderRecord[]
  }
}

export class IndexingStatusRepository {
  constructor(private db: TimeboostDatabase) {}

  async update(status: IndexingStatusRecord): Promise<void> {
    this.db.updateIndexingStatus(status)
  }

  async findByRound(
    roundNumber: number
  ): Promise<IndexingStatusRecord | undefined> {
    return this.db.getIndexingStatus(roundNumber)
  }

  async findPending(limit: number = 10): Promise<IndexingStatusRecord[]> {
    const stmt = this.db['db'].prepare(`
      SELECT * FROM indexing_status 
      WHERE status = 'pending' 
      ORDER BY round_number ASC 
      LIMIT ?
    `)

    return stmt.all(limit) as IndexingStatusRecord[]
  }

  async findFailed(limit: number = 10): Promise<IndexingStatusRecord[]> {
    const stmt = this.db['db'].prepare(`
      SELECT * FROM indexing_status 
      WHERE status = 'failed' 
      ORDER BY round_number DESC 
      LIMIT ?
    `)

    return stmt.all(limit) as IndexingStatusRecord[]
  }

  async markAsStarted(roundNumber: number): Promise<void> {
    this.update({
      round_number: roundNumber,
      status: 'indexing',
      started_at: new Date().toISOString(),
      blocks_indexed: 0,
      transactions_indexed: 0,
    })
  }

  async markAsCompleted(
    roundNumber: number,
    blocksIndexed: number,
    transactionsIndexed: number
  ): Promise<void> {
    this.update({
      round_number: roundNumber,
      status: 'completed',
      completed_at: new Date().toISOString(),
      blocks_indexed: blocksIndexed,
      transactions_indexed: transactionsIndexed,
    })
  }

  async markAsFailed(roundNumber: number, error: string): Promise<void> {
    this.update({
      round_number: roundNumber,
      status: 'failed',
      error_message: error,
      blocks_indexed: 0,
      transactions_indexed: 0,
    })
  }
}

// Main repository aggregator
export class TimeboostRepository {
  public events: EventRepository
  public rounds: RoundRepository
  public transactions: TransactionRepository
  public bidders: BidderRepository
  public indexingStatus: IndexingStatusRepository

  constructor(private db: TimeboostDatabase) {
    this.events = new EventRepository(db)
    this.rounds = new RoundRepository(db)
    this.transactions = new TransactionRepository(db)
    this.bidders = new BidderRepository(db)
    this.indexingStatus = new IndexingStatusRepository(db)
  }

  async getStats() {
    return this.db.getStats()
  }

  beginTransaction<T>(fn: (...args: any[]) => T): T {
    return this.db.beginTransaction(fn)
  }

  close() {
    this.db.close()
  }
}

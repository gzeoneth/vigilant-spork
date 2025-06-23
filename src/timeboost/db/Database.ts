import Database from 'better-sqlite3'
import {
  EventRecord,
  RoundRecord,
  TransactionRecord,
  BidderRecord,
  IndexingStatusRecord,
  DatabaseStats,
} from './models'
import * as path from 'path'
import * as fs from 'fs'

export class TimeboostDatabase {
  private db: Database.Database

  constructor(databasePath?: string) {
    const dbPath = databasePath || path.join(process.cwd(), 'timeboost.db')

    // Ensure directory exists
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')

    this.initializeSchema()
  }

  private initializeSchema(): void {
    this.db.exec(`
      -- Events table
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_hash TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        log_index INTEGER NOT NULL,
        event_name TEXT NOT NULL,
        event_data TEXT NOT NULL,
        round_number INTEGER,
        timestamp INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(transaction_hash, log_index)
      );

      -- Rounds table
      CREATE TABLE IF NOT EXISTS rounds (
        round_number INTEGER PRIMARY KEY,
        start_timestamp INTEGER NOT NULL,
        end_timestamp INTEGER NOT NULL,
        express_lane_controller TEXT,
        winning_bid_amount TEXT,
        auction_closed BOOLEAN DEFAULT FALSE,
        total_transactions INTEGER DEFAULT 0,
        total_timeboosted INTEGER DEFAULT 0,
        indexed BOOLEAN DEFAULT FALSE,
        last_indexed_block INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Transactions table
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_hash TEXT NOT NULL UNIQUE,
        block_number INTEGER NOT NULL,
        transaction_index INTEGER NOT NULL,
        from_address TEXT NOT NULL,
        to_address TEXT,
        value TEXT NOT NULL,
        gas_used TEXT NOT NULL,
        gas_price TEXT NOT NULL,
        is_timeboosted BOOLEAN NOT NULL,
        round_number INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (round_number) REFERENCES rounds(round_number)
      );

      -- Bidders table
      CREATE TABLE IF NOT EXISTS bidders (
        address TEXT PRIMARY KEY,
        total_wins INTEGER DEFAULT 0,
        total_bid_amount TEXT DEFAULT '0',
        last_win_round INTEGER,
        last_win_timestamp INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Indexing status table
      CREATE TABLE IF NOT EXISTS indexing_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        round_number INTEGER NOT NULL,
        status TEXT CHECK(status IN ('pending', 'indexing', 'completed', 'failed')) NOT NULL,
        started_at DATETIME,
        completed_at DATETIME,
        error_message TEXT,
        blocks_indexed INTEGER DEFAULT 0,
        transactions_indexed INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(round_number)
      );

      -- Create indexes for performance
      CREATE INDEX IF NOT EXISTS idx_events_block_number ON events(block_number);
      CREATE INDEX IF NOT EXISTS idx_events_round_number ON events(round_number);
      CREATE INDEX IF NOT EXISTS idx_events_event_name ON events(event_name);
      CREATE INDEX IF NOT EXISTS idx_transactions_block_number ON transactions(block_number);
      CREATE INDEX IF NOT EXISTS idx_transactions_round_number ON transactions(round_number);
      CREATE INDEX IF NOT EXISTS idx_transactions_is_timeboosted ON transactions(is_timeboosted);
      CREATE INDEX IF NOT EXISTS idx_transactions_from_address ON transactions(from_address);
      CREATE INDEX IF NOT EXISTS idx_rounds_indexed ON rounds(indexed);
      CREATE INDEX IF NOT EXISTS idx_indexing_status_round_status ON indexing_status(round_number, status);

      -- Create triggers for updated_at
      CREATE TRIGGER IF NOT EXISTS update_rounds_timestamp 
      AFTER UPDATE ON rounds
      BEGIN
        UPDATE rounds SET updated_at = CURRENT_TIMESTAMP WHERE round_number = NEW.round_number;
      END;

      CREATE TRIGGER IF NOT EXISTS update_bidders_timestamp 
      AFTER UPDATE ON bidders
      BEGIN
        UPDATE bidders SET updated_at = CURRENT_TIMESTAMP WHERE address = NEW.address;
      END;

      CREATE TRIGGER IF NOT EXISTS update_indexing_status_timestamp 
      AFTER UPDATE ON indexing_status
      BEGIN
        UPDATE indexing_status SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
    `)
  }

  // Event operations
  insertEvent(event: EventRecord): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO events (
        transaction_hash, block_number, log_index, event_name, 
        event_data, round_number, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      event.transaction_hash,
      event.block_number,
      event.log_index,
      event.event_name,
      event.event_data,
      event.round_number,
      event.timestamp
    )
  }

  getEventsByRound(roundNumber: number): EventRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM events 
      WHERE round_number = ? 
      ORDER BY block_number, log_index
    `)

    return stmt.all(roundNumber) as EventRecord[]
  }

  // Round operations
  insertRound(round: RoundRecord): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO rounds (
        round_number, start_timestamp, end_timestamp, express_lane_controller,
        winning_bid_amount, auction_closed, total_transactions, total_timeboosted,
        indexed, last_indexed_block
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      round.round_number,
      round.start_timestamp,
      round.end_timestamp,
      round.express_lane_controller,
      round.winning_bid_amount,
      round.auction_closed ? 1 : 0,
      round.total_transactions,
      round.total_timeboosted,
      round.indexed ? 1 : 0,
      round.last_indexed_block
    )
  }

  getRound(roundNumber: number): RoundRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM rounds WHERE round_number = ?')
    const row = stmt.get(roundNumber) as any

    if (!row) return undefined

    return {
      ...row,
      auction_closed: Boolean(row.auction_closed),
      indexed: Boolean(row.indexed),
    } as RoundRecord
  }

  getRounds(limit: number = 10, offset: number = 0): RoundRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM rounds 
      ORDER BY round_number DESC 
      LIMIT ? OFFSET ?
    `)

    const rows = stmt.all(limit, offset) as any[]

    return rows.map(row => ({
      ...row,
      auction_closed: Boolean(row.auction_closed),
      indexed: Boolean(row.indexed),
    })) as RoundRecord[]
  }

  updateRoundStats(
    roundNumber: number,
    totalTransactions: number,
    totalTimeboosted: number
  ): void {
    const stmt = this.db.prepare(`
      UPDATE rounds 
      SET total_transactions = ?, total_timeboosted = ?, indexed = 1 
      WHERE round_number = ?
    `)

    stmt.run(totalTransactions, totalTimeboosted, roundNumber)
  }

  // Transaction operations
  insertTransaction(tx: TransactionRecord): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO transactions (
        transaction_hash, block_number, transaction_index, from_address,
        to_address, value, gas_used, gas_price, is_timeboosted,
        round_number, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      tx.transaction_hash,
      tx.block_number,
      tx.transaction_index,
      tx.from_address,
      tx.to_address,
      tx.value,
      tx.gas_used,
      tx.gas_price,
      tx.is_timeboosted ? 1 : 0,
      tx.round_number,
      tx.timestamp
    )
  }

  insertTransactionsBatch(transactions: TransactionRecord[]): void {
    const insertMany = this.db.transaction((txs: TransactionRecord[]) => {
      for (const tx of txs) {
        this.insertTransaction(tx)
      }
    })

    insertMany(transactions)
  }

  getTransactionsByRound(
    roundNumber: number,
    limit?: number,
    offset?: number
  ): TransactionRecord[] {
    let query = `
      SELECT * FROM transactions 
      WHERE round_number = ? 
      ORDER BY block_number, transaction_index
    `

    if (limit !== undefined) {
      query += ` LIMIT ${limit}`
      if (offset !== undefined) {
        query += ` OFFSET ${offset}`
      }
    }

    const stmt = this.db.prepare(query)
    const rows = stmt.all(roundNumber) as any[]

    return rows.map(row => ({
      ...row,
      is_timeboosted: Boolean(row.is_timeboosted),
    })) as TransactionRecord[]
  }

  getTimeboostedTransactionsByRound(roundNumber: number): TransactionRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM transactions 
      WHERE round_number = ? AND is_timeboosted = 1
      ORDER BY block_number, transaction_index
    `)

    const rows = stmt.all(roundNumber) as any[]

    return rows.map(row => ({
      ...row,
      is_timeboosted: true,
    })) as TransactionRecord[]
  }

  // Bidder operations
  upsertBidder(bidder: BidderRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO bidders (
        address, total_wins, total_bid_amount, last_win_round, last_win_timestamp
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(address) DO UPDATE SET
        total_wins = total_wins + 1,
        total_bid_amount = CAST((CAST(total_bid_amount AS INTEGER) + CAST(excluded.total_bid_amount AS INTEGER)) AS TEXT),
        last_win_round = excluded.last_win_round,
        last_win_timestamp = excluded.last_win_timestamp
    `)

    stmt.run(
      bidder.address,
      1,
      bidder.total_bid_amount,
      bidder.last_win_round,
      bidder.last_win_timestamp
    )
  }

  getBidder(address: string): BidderRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM bidders WHERE address = ?')
    return stmt.get(address) as BidderRecord | undefined
  }

  getTopBidders(limit: number = 10): BidderRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM bidders 
      ORDER BY total_wins DESC, CAST(total_bid_amount AS INTEGER) DESC 
      LIMIT ?
    `)

    return stmt.all(limit) as BidderRecord[]
  }

  // Indexing status operations
  updateIndexingStatus(status: IndexingStatusRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO indexing_status (
        round_number, status, started_at, completed_at, error_message,
        blocks_indexed, transactions_indexed
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(round_number) DO UPDATE SET
        status = excluded.status,
        started_at = COALESCE(indexing_status.started_at, excluded.started_at),
        completed_at = excluded.completed_at,
        error_message = excluded.error_message,
        blocks_indexed = excluded.blocks_indexed,
        transactions_indexed = excluded.transactions_indexed
    `)

    stmt.run(
      status.round_number,
      status.status,
      status.started_at,
      status.completed_at,
      status.error_message,
      status.blocks_indexed,
      status.transactions_indexed
    )
  }

  getIndexingStatus(roundNumber: number): IndexingStatusRecord | undefined {
    const stmt = this.db.prepare(
      'SELECT * FROM indexing_status WHERE round_number = ?'
    )
    return stmt.get(roundNumber) as IndexingStatusRecord | undefined
  }

  // Statistics
  getStats(): DatabaseStats {
    const stats = this.db
      .prepare(
        `
      SELECT 
        (SELECT COUNT(*) FROM rounds) as total_rounds,
        (SELECT COUNT(*) FROM transactions) as total_transactions,
        (SELECT COUNT(*) FROM transactions WHERE is_timeboosted = 1) as total_timeboosted_transactions,
        (SELECT COUNT(*) FROM bidders) as total_bidders,
        (SELECT MAX(round_number) FROM rounds WHERE indexed = 1) as last_indexed_round,
        (SELECT MAX(block_number) FROM transactions) as last_indexed_block
    `
      )
      .get() as any

    return {
      total_rounds: stats.total_rounds || 0,
      total_transactions: stats.total_transactions || 0,
      total_timeboosted_transactions: stats.total_timeboosted_transactions || 0,
      total_bidders: stats.total_bidders || 0,
      last_indexed_round: stats.last_indexed_round,
      last_indexed_block: stats.last_indexed_block,
    }
  }

  // Utility methods
  beginTransaction<T>(fn: (...args: any[]) => T): T {
    return this.db.transaction(fn)()
  }

  close(): void {
    this.db.close()
  }

  // Migration support
  async runMigration(migration: string): Promise<void> {
    this.db.exec(migration)
  }

  getVersion(): number {
    const result = this.db.prepare('PRAGMA user_version').get() as any
    return result.user_version
  }

  setVersion(version: number): void {
    this.db.exec(`PRAGMA user_version = ${version}`)
  }
}

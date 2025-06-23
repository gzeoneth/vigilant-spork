import { TimeboostDatabase } from './Database'

export interface Migration {
  version: number
  name: string
  up: string
  down?: string
}

export class MigrationManager {
  private db: TimeboostDatabase
  private migrations: Migration[]

  constructor(db: TimeboostDatabase) {
    this.db = db
    this.migrations = []
    this.createMigrationTable()
  }

  private createMigrationTable(): void {
    this.db.runMigration(`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
  }

  registerMigration(migration: Migration): void {
    this.migrations.push(migration)
    this.migrations.sort((a, b) => a.version - b.version)
  }

  async getCurrentVersion(): Promise<number> {
    return this.db.getVersion()
  }

  async migrate(): Promise<void> {
    const currentVersion = await this.getCurrentVersion()

    for (const migration of this.migrations) {
      if (migration.version > currentVersion) {
        console.log(`Running migration ${migration.version}: ${migration.name}`)

        try {
          await this.db.runMigration(migration.up)
          await this.db.runMigration(`
            INSERT INTO migrations (version, name) VALUES (${migration.version}, '${migration.name}')
          `)
          this.db.setVersion(migration.version)

          console.log(`Migration ${migration.version} completed successfully`)
        } catch (error) {
          console.error(`Migration ${migration.version} failed:`, error)
          throw error
        }
      }
    }
  }

  async rollback(targetVersion: number): Promise<void> {
    const currentVersion = await this.getCurrentVersion()

    if (targetVersion >= currentVersion) {
      console.log('Target version must be less than current version')
      return
    }

    // Get migrations to rollback in reverse order
    const migrationsToRollback = this.migrations
      .filter(m => m.version > targetVersion && m.version <= currentVersion)
      .reverse()

    for (const migration of migrationsToRollback) {
      if (migration.down) {
        console.log(
          `Rolling back migration ${migration.version}: ${migration.name}`
        )

        try {
          await this.db.runMigration(migration.down)
          await this.db.runMigration(`
            DELETE FROM migrations WHERE version = ${migration.version}
          `)

          console.log(
            `Rollback of migration ${migration.version} completed successfully`
          )
        } catch (error) {
          console.error(
            `Rollback of migration ${migration.version} failed:`,
            error
          )
          throw error
        }
      } else {
        console.warn(
          `Migration ${migration.version} does not have a rollback script`
        )
      }
    }

    this.db.setVersion(targetVersion)
  }
}

// Example migrations (for future use)
export const migrations: Migration[] = [
  // {
  //   version: 1,
  //   name: 'add_gas_efficiency_column',
  //   up: `
  //     ALTER TABLE transactions ADD COLUMN gas_efficiency REAL;
  //     CREATE INDEX idx_transactions_gas_efficiency ON transactions(gas_efficiency);
  //   `,
  //   down: `
  //     DROP INDEX IF EXISTS idx_transactions_gas_efficiency;
  //     ALTER TABLE transactions DROP COLUMN gas_efficiency;
  //   `
  // }
]

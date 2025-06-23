import { TimeboostDatabase } from './Database'
import { TimeboostRepository } from './repositories'
import { MigrationManager, migrations } from './migrations'
import * as path from 'path'

let dbInstance: TimeboostDatabase | null = null
let repoInstance: TimeboostRepository | null = null

export interface DatabaseConfig {
  path?: string
  runMigrations?: boolean
}

export async function initializeDatabase(
  config: DatabaseConfig = {}
): Promise<TimeboostRepository> {
  if (repoInstance) {
    return repoInstance
  }

  const dbPath =
    config.path ||
    process.env.TIMEBOOST_DB_PATH ||
    path.join(process.cwd(), 'data', 'timeboost.db')

  dbInstance = new TimeboostDatabase(dbPath)

  if (config.runMigrations !== false) {
    const migrationManager = new MigrationManager(dbInstance)

    // Register all migrations
    migrations.forEach(migration => {
      migrationManager.registerMigration(migration)
    })

    // Run pending migrations
    await migrationManager.migrate()
  }

  repoInstance = new TimeboostRepository(dbInstance)

  return repoInstance
}

export function getDatabase(): TimeboostDatabase {
  if (!dbInstance) {
    throw new Error(
      'Database not initialized. Call initializeDatabase() first.'
    )
  }
  return dbInstance
}

export function getRepository(): TimeboostRepository {
  if (!repoInstance) {
    throw new Error(
      'Repository not initialized. Call initializeDatabase() first.'
    )
  }
  return repoInstance
}

export async function closeDatabase(): Promise<void> {
  if (repoInstance) {
    repoInstance.close()
    repoInstance = null
  }
  dbInstance = null
}

// Helper function to format BigInt values for storage
export function bigIntToString(value: bigint | string | number): string {
  return value.toString()
}

// Helper function to parse BigInt values from storage
export function stringToBigInt(value: string): bigint {
  return BigInt(value)
}

// Helper function to safely handle nullable BigInt values
export function bigIntToStringOrNull(
  value: bigint | string | number | null | undefined
): string | undefined {
  return value != null ? value.toString() : undefined
}

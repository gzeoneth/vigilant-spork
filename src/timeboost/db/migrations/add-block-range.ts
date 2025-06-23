import { Migration } from '../migrations'

export const addBlockRangeMigration: Migration = {
  version: 1,
  name: 'add_block_range_to_rounds',
  up: `
    ALTER TABLE rounds ADD COLUMN start_block INTEGER;
    ALTER TABLE rounds ADD COLUMN end_block INTEGER;
    CREATE INDEX idx_rounds_start_block ON rounds(start_block);
    CREATE INDEX idx_rounds_end_block ON rounds(end_block);
  `,
  down: `
    DROP INDEX IF EXISTS idx_rounds_end_block;
    DROP INDEX IF EXISTS idx_rounds_start_block;
    ALTER TABLE rounds DROP COLUMN end_block;
    ALTER TABLE rounds DROP COLUMN start_block;
  `,
}

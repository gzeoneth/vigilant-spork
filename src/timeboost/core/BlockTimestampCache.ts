interface CacheEntry {
  blockNumber: number
  timestamp: number
}

export class BlockTimestampCache {
  private cache: Map<number, number> = new Map() // blockNumber -> timestamp
  private timestampIndex: Map<number, number[]> = new Map() // timestamp -> blockNumbers[]
  private maxCacheSize: number
  private sequentialHints: Map<string, number> = new Map() // cacheKey -> lastBlockNumber

  constructor(maxCacheSize = 10000) {
    this.maxCacheSize = maxCacheSize
  }

  set(blockNumber: number, timestamp: number): void {
    // Check cache size and evict oldest entries if needed
    if (this.cache.size >= this.maxCacheSize) {
      const oldestBlock = Math.min(...Array.from(this.cache.keys()))
      const oldestTimestamp = this.cache.get(oldestBlock)
      this.cache.delete(oldestBlock)
      
      if (oldestTimestamp !== undefined) {
        const blocks = this.timestampIndex.get(oldestTimestamp) || []
        const filtered = blocks.filter(b => b !== oldestBlock)
        if (filtered.length === 0) {
          this.timestampIndex.delete(oldestTimestamp)
        } else {
          this.timestampIndex.set(oldestTimestamp, filtered)
        }
      }
    }

    this.cache.set(blockNumber, timestamp)
    
    // Update timestamp index
    const blocks = this.timestampIndex.get(timestamp) || []
    if (!blocks.includes(blockNumber)) {
      blocks.push(blockNumber)
      blocks.sort((a, b) => a - b)
      this.timestampIndex.set(timestamp, blocks)
    }
  }

  get(blockNumber: number): number | undefined {
    return this.cache.get(blockNumber)
  }

  getBlocksByTimestamp(timestamp: number): number[] {
    return this.timestampIndex.get(timestamp) || []
  }

  // Get closest cached blocks for a timestamp
  getClosestBlocks(timestamp: number): { before?: CacheEntry; after?: CacheEntry } {
    let closestBefore: CacheEntry | undefined
    let closestAfter: CacheEntry | undefined

    for (const [blockNumber, cachedTimestamp] of this.cache.entries()) {
      if (cachedTimestamp <= timestamp) {
        if (!closestBefore || cachedTimestamp > closestBefore.timestamp) {
          closestBefore = { blockNumber, timestamp: cachedTimestamp }
        }
      } else {
        if (!closestAfter || cachedTimestamp < closestAfter.timestamp) {
          closestAfter = { blockNumber, timestamp: cachedTimestamp }
        }
      }
    }

    return { before: closestBefore, after: closestAfter }
  }

  // Store hint for sequential access patterns
  setSequentialHint(key: string, blockNumber: number): void {
    this.sequentialHints.set(key, blockNumber)
  }

  getSequentialHint(key: string): number | undefined {
    return this.sequentialHints.get(key)
  }

  clear(): void {
    this.cache.clear()
    this.timestampIndex.clear()
    this.sequentialHints.clear()
  }

  size(): number {
    return this.cache.size
  }
}
import { expect } from 'chai'
import { BlockTimestampCache } from '../../src/timeboost/core/BlockTimestampCache'

describe('BlockTimestampCache', () => {
  let cache: BlockTimestampCache

  beforeEach(() => {
    cache = new BlockTimestampCache(100)
  })

  describe('Basic functionality', () => {
    it('should store and retrieve block timestamps', () => {
      cache.set(100, 1000)
      expect(cache.get(100)).to.equal(1000)
    })

    it('should return undefined for uncached blocks', () => {
      expect(cache.get(100)).to.be.undefined
    })

    it('should maintain timestamp index', () => {
      cache.set(100, 1000)
      cache.set(101, 1000)
      cache.set(102, 1001)

      const blocks = cache.getBlocksByTimestamp(1000)
      expect(blocks).to.have.lengthOf(2)
      expect(blocks).to.include(100)
      expect(blocks).to.include(101)
    })
  })

  describe('Cache eviction', () => {
    it('should evict oldest entries when cache is full', () => {
      const maxSize = 10
      cache = new BlockTimestampCache(maxSize)

      // Fill cache
      for (let i = 1; i <= maxSize; i++) {
        cache.set(i, i * 1000)
      }

      expect(cache.size()).to.equal(maxSize)
      expect(cache.get(1)).to.equal(1000)

      // Add one more - should evict block 1
      cache.set(maxSize + 1, (maxSize + 1) * 1000)
      expect(cache.size()).to.equal(maxSize)
      expect(cache.get(1)).to.be.undefined
      expect(cache.get(maxSize + 1)).to.equal((maxSize + 1) * 1000)
    })
  })

  describe('Closest blocks search', () => {
    it('should find closest blocks for a given timestamp', () => {
      cache.set(100, 1000)
      cache.set(200, 2000)
      cache.set(300, 3000)
      cache.set(400, 4000)

      const closest = cache.getClosestBlocks(2500)
      expect(closest.before).to.deep.equal({
        blockNumber: 200,
        timestamp: 2000,
      })
      expect(closest.after).to.deep.equal({ blockNumber: 300, timestamp: 3000 })
    })

    it('should handle edge cases in closest block search', () => {
      cache.set(100, 1000)
      cache.set(200, 2000)

      // Before all blocks
      let closest = cache.getClosestBlocks(500)
      expect(closest.before).to.be.undefined
      expect(closest.after).to.deep.equal({ blockNumber: 100, timestamp: 1000 })

      // After all blocks
      closest = cache.getClosestBlocks(2500)
      expect(closest.before).to.deep.equal({
        blockNumber: 200,
        timestamp: 2000,
      })
      expect(closest.after).to.be.undefined
    })
  })

  describe('Sequential hints', () => {
    it('should store and retrieve sequential hints', () => {
      cache.setSequentialHint('round-1000-before', 12345)
      expect(cache.getSequentialHint('round-1000-before')).to.equal(12345)
      expect(cache.getSequentialHint('round-1000-after')).to.be.undefined
    })
  })

  describe('Clear functionality', () => {
    it('should clear all data', () => {
      cache.set(100, 1000)
      cache.setSequentialHint('test', 100)

      cache.clear()

      expect(cache.size()).to.equal(0)
      expect(cache.get(100)).to.be.undefined
      expect(cache.getSequentialHint('test')).to.be.undefined
      expect(cache.getBlocksByTimestamp(1000)).to.have.lengthOf(0)
    })
  })
})

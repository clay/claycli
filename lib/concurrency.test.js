'use strict';
const { pLimit, mapConcurrent } = require('./concurrency');

describe('concurrency', () => {
  describe('pLimit', () => {
    it('limits concurrent execution', async () => {
      var running = 0, maxRunning = 0,
        limit = pLimit(2);

      function task() {
        return limit(async () => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          await new Promise((r) => setTimeout(r, 10));
          running--;
        });
      }

      await Promise.all([task(), task(), task(), task(), task()]);
      expect(maxRunning).toBe(2);
    });

    it('preserves result order', async () => {
      var limit = pLimit(2);

      var results = await Promise.all([
        limit(async () => { await new Promise((r) => setTimeout(r, 30)); return 'a'; }),
        limit(async () => { await new Promise((r) => setTimeout(r, 10)); return 'b'; }),
        limit(async () => 'c')
      ]);

      expect(results).toEqual(['a', 'b', 'c']);
    });

    it('handles errors without breaking queue', async () => {
      var limit = pLimit(1), results = [];

      await Promise.allSettled([
        limit(async () => { throw new Error('fail'); }),
        limit(async () => { results.push('ok'); })
      ]);

      expect(results).toEqual(['ok']);
    });
  });

  describe('mapConcurrent', () => {
    it('processes items with bounded concurrency', async () => {
      var running = 0, maxRunning = 0;

      var results = await mapConcurrent([1, 2, 3, 4], 2, async (item) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 10));
        running--;
        return item * 2;
      });

      expect(results).toEqual([2, 4, 6, 8]);
      expect(maxRunning).toBe(2);
    });

    it('works with concurrency of 1 (sequential)', async () => {
      var order = [];

      await mapConcurrent(['a', 'b', 'c'], 1, async (item) => {
        order.push(`start-${item}`);
        await new Promise((r) => setTimeout(r, 5));
        order.push(`end-${item}`);
      });

      expect(order).toEqual(['start-a', 'end-a', 'start-b', 'end-b', 'start-c', 'end-c']);
    });
  });
});

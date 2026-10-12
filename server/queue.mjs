// Create app is capped at 5 requests per minute, so creates run one at a time
// and wait for a free slot instead of failing.
export class CreateQueue {
  constructor({limit = 5, windowMs = 60_000, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms))} = {}) {
    Object.assign(this, {limit, windowMs, now, sleep}); this.started = []; this.tail = Promise.resolve();
  }
  run(task) {
    const result = this.tail.then(async () => {
      for (;;) {
        this.started = this.started.filter(t => this.now() - t < this.windowMs);
        if (this.started.length < this.limit) break;
        await this.sleep(this.windowMs - (this.now() - this.started[0]) + 50);
      }
      this.started.push(this.now());
      return task();
    });
    this.tail = result.catch(() => {});
    return result;
  }
}

const EventEmitter = require('events');

/**
 * Very small in-memory FIFO queue for MVP use.
 * For production, replace with BullMQ + Redis or SQS.
 */
class BuildQueue extends EventEmitter {
  constructor(concurrency = 1) {
    super();
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  add(task) {
    this.queue.push(task);
    this.emit('queued', task.id);
    this._runNext();
  }

  _runNext() {
    if (this.running >= this.concurrency || this.queue.length === 0) return;

    const task = this.queue.shift();
    this.running += 1;

    Promise.resolve()
      .then(() => this.emit('started', task.id))
      .then(() => task.handler())
      .then((result) => this.emit('completed', task.id, result))
      .catch((error) => this.emit('failed', task.id, error))
      .finally(() => {
        this.running -= 1;
        this._runNext();
      });
  }

  getStats() {
    return {
      queued: this.queue.length,
      running: this.running,
      concurrency: this.concurrency
    };
  }
}

module.exports = BuildQueue;

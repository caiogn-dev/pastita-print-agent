import fs from 'node:fs';
import path from 'node:path';

export class StateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = {
      completedJobIds: [],
      dedupeKeys: {},
    };
  }

  load() {
    if (!fs.existsSync(this.filePath)) {
      this.#ensureDir();
      this.save();
      return this.state;
    }

    this.state = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
    return this.state;
  }

  save() {
    this.#ensureDir();
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  hasSeenJob(job) {
    if (!job) return false;
    if (this.state.completedJobIds.includes(job.id)) return true;
    if (job.dedupe_key && this.state.dedupeKeys[job.dedupe_key]) return true;
    return false;
  }

  markCompleted(job) {
    if (!this.state.completedJobIds.includes(job.id)) {
      this.state.completedJobIds.push(job.id);
    }
    if (job.dedupe_key) {
      this.state.dedupeKeys[job.dedupe_key] = new Date().toISOString();
    }
    this.state.completedJobIds = this.state.completedJobIds.slice(-500);
    this.save();
  }

  #ensureDir() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }
}

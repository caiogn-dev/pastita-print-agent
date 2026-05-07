import os from 'node:os';

import { PrintApiClient } from './api-client.js';
import { buildKitchenTicket } from './escpos.js';
import { StateStore } from './state-store.js';
import { printRawWindows } from './printers/windows-raw.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PastitaPrintAgent {
  constructor(config) {
    this.config = config;
    this.clients = config.agentKeys.map((key) => new PrintApiClient({ backendUrl: config.backendUrl, agentKey: key }));
    this.stateStore = new StateStore(config.stateFile);
    this.stateStore.load();
    this.running = false;
    this.lastHeartbeatAt = 0;
  }

  async start() {
    this.running = true;
    while (this.running) {
      try {
        await this.#maybeHeartbeat();
        let gotJob = false;
        for (const api of this.clients) {
          const response = await api.claimNext({
            app_version: '0.1.0',
            host_name: os.hostname(),
          });
          const job = response.job;
          if (!job) continue;
          gotJob = true;
          if (this.stateStore.hasSeenJob(job)) {
            await api.completeJob(job.id, {
              printer_name: this.config.printerName,
              metadata: { skipped_duplicate: true },
            });
            continue;
          }
          const printResult = await this.#printJob(api, job);
          this.stateStore.markCompleted(job);
          await api.completeJob(job.id, {
            printer_name: this.config.printerName,
            metadata: {
              host_name: os.hostname(),
              printer_name: this.config.printerName,
              print_result: printResult,
            },
          });
        }
        if (!gotJob) {
          await sleep(this.config.pollIntervalMs);
        }
      } catch (error) {
        console.error('[print-agent] loop error:', error.message ?? JSON.stringify(error));
        await sleep(this.config.pollIntervalMs);
      }
    }
  }

  stop() {
    this.running = false;
  }

  async #maybeHeartbeat() {
    const now = Date.now();
    if (now - this.lastHeartbeatAt < this.config.heartbeatIntervalMs) return;
    await Promise.allSettled(
      this.clients.map((api) =>
        api.heartbeat({
          app_version: '0.1.0',
          host_name: os.hostname(),
          printer_name: this.config.printerName,
        })
      )
    );
    this.lastHeartbeatAt = now;
  }

  async #printJob(api, job) {
    if (job.template !== 'kitchen_ticket') {
      throw new Error(`Unsupported template: ${job.template}`);
    }
    const data = buildKitchenTicket(job.payload);
    try {
      return await printRawWindows({ printerName: this.config.printerName, data });
    } catch (error) {
      await api.failJob(job.id, { error: error.message, retryable: true });
      throw error;
    }
  }
}

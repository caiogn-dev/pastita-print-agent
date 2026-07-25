import os from 'node:os';

import { PrintApiClient } from './api-client.js';
import { buildKitchenTicket, buildCustomerReceipt } from './escpos.js';
import { StateStore } from './state-store.js';
import { printRawWindows, listWindowsPrinters } from './printers/windows-raw.js';

// Cache da lista de impressoras (5min) — evita rodar PowerShell a cada heartbeat
let printersCache = { at: 0, list: [] };
async function detectPrinters() {
  if (Date.now() - printersCache.at < 5 * 60 * 1000) return printersCache.list;
  try {
    const list = await listWindowsPrinters();
    printersCache = { at: Date.now(), list: Array.isArray(list) ? list : [] };
  } catch {
    printersCache = { at: Date.now(), list: [] };
  }
  return printersCache.list;
}

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
        await this.#watchJobsWithFallback();
      } catch (error) {
        console.error('[print-agent] loop error:', error.message ?? JSON.stringify(error));
        await sleep(this.config.pollIntervalMs);
      }
    }
  }

  async #watchJobsWithFallback() {
    // Node < 22 não tem EventSource global — sem ele, polling direto
    // (antes disso, o `new EventSource` explodia antes do fallback e o
    // agente ficava preso em "loop error: EventSource is not defined")
    if (typeof EventSource === 'undefined') {
      await this.#pollWithBackoff();
      return;
    }
    const promises = this.clients.map((api) =>
      new Promise((resolve) => {
        const closeUnwatch = api.watchJobs(
          async (job) => {
            if (this.stateStore.hasSeenJob(job)) {
              await api.completeJob(job.id, {
                printer_name: this.config.printerName,
                metadata: { skipped_duplicate: true },
              });
              return;
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
          },
          (error) => {
            console.error('[print-agent] SSE error:', error.message);
            closeUnwatch();
            resolve();
          },
          () => {
            console.warn('[print-agent] SSE connection closed, falling back to polling');
            resolve();
          }
        );
      })
    );

    await Promise.race(promises);
    await this.#pollWithBackoff();
  }

  async #pollWithBackoff() {
    let retries = 0;
    const maxRetries = 10;

    while (this.running && retries < maxRetries) {
      try {
        let gotJob = false;
        for (const api of this.clients) {
          // Erro numa chave (revogada, loja suspensa…) não pode travar as
          // outras — antes, uma chave morta no meio da lista reiniciava o
          // loop e as chaves seguintes nunca rodavam.
          try {
            const response = await api.claimNext({
              app_version: '0.1.0',
              host_name: os.hostname(),
            });
            const job = response.job;
            if (!job) continue;
            gotJob = true;
            retries = 0;
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
          } catch (error) {
            console.error('[print-agent] client error (chave ignorada neste ciclo):', error.message);
          }
        }
        if (!gotJob) {
          retries++;
          const delay = Math.min(1000 * Math.pow(2, retries), 30000);
          await sleep(delay);
        }
      } catch (error) {
        console.error('[print-agent] polling error:', error.message);
        retries++;
        const delay = Math.min(1000 * Math.pow(2, retries), 30000);
        await sleep(delay);
      }
    }

    console.log('[print-agent] Polling timeout reached, reconnecting to SSE');
  }

  stop() {
    this.running = false;
  }

  async #maybeHeartbeat() {
    const now = Date.now();
    if (now - this.lastHeartbeatAt < this.config.heartbeatIntervalMs) return;

    // Detecção dinâmica: envia as impressoras instaladas no PC; o painel
    // popula o dropdown e o lojista escolhe sem digitar nome de impressora
    const availablePrinters = await detectPrinters();

    const results = await Promise.allSettled(
      this.clients.map((api) =>
        api.heartbeat({
          app_version: '0.2.0',
          host_name: os.hostname(),
          printer_name: this.#effectivePrinter(api),
          available_printers: availablePrinters,
        })
      )
    );

    // O painel é a fonte de verdade: se o backend devolver printer_name,
    // o agent passa a usar essa impressora (por loja) sem editar o config
    results.forEach((res, idx) => {
      const name = res.status === 'fulfilled' ? res.value?.printer_name : null;
      if (name) this.clients[idx].panelPrinterName = name;
    });

    this.lastHeartbeatAt = now;
  }

  #effectivePrinter(api) {
    return api?.panelPrinterName || this.config.printerName;
  }

  async #printJob(api, job) {
    const builders = {
      kitchen_ticket: buildKitchenTicket,
      customer_receipt: buildCustomerReceipt,
    };
    const builder = builders[job.template];
    if (!builder) {
      throw new Error(`Unsupported template: ${job.template}`);
    }
    const data = builder(job.payload);
    try {
      return await printRawWindows({ printerName: this.#effectivePrinter(api), data });
    } catch (error) {
      await api.failJob(job.id, { error: error.message, retryable: true });
      throw error;
    }
  }
}

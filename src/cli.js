#!/usr/bin/env node
import { loadConfig } from './config.js';
import { PastitaPrintAgent } from './agent.js';
import { listWindowsPrinters } from './printers/windows-raw.js';

const command = process.argv[2];

if (command === 'start') {
  const config = loadConfig();
  const agent = new PastitaPrintAgent(config);

  process.on('SIGINT', () => {
    console.log('\n[print-agent] Stopping...');
    agent.stop();
  });
  process.on('SIGTERM', () => agent.stop());

  console.log(`[print-agent] Starting — printer: ${config.printerName}, backend: ${config.backendUrl}`);
  agent.start().catch((err) => {
    console.error('[print-agent] Fatal:', err.message);
    process.exit(1);
  });
} else if (command === 'list-printers') {
  listWindowsPrinters()
    .then((printers) => {
      console.log('Impressoras disponíveis:');
      printers.forEach((p) => console.log(' -', p));
    })
    .catch((err) => {
      console.error('Erro ao listar impressoras:', err.message);
      process.exit(1);
    });
} else if (command === 'test-print') {
  const config = loadConfig();
  const { printRawWindows } = await import('./printers/windows-raw.js');
  const { buildKitchenTicket } = await import('./escpos.js');
  const data = buildKitchenTicket({
    order_number: 'TEST-001',
    created_at: new Date().toISOString(),
    items: [{ name: 'Teste de impressão', quantity: 1, notes: '' }],
  });
  await printRawWindows({ printerName: config.printerName, data });
  console.log('[print-agent] Impressão de teste enviada para:', config.printerName);
} else {
  console.log('Uso: node src/cli.js <start|list-printers|test-print>');
  process.exit(1);
}

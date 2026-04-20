// Roda como CommonJS porque node-windows não suporta ESM
const path = require('path');
const { Service } = require('node-windows');

const cliPath = path.resolve(__dirname, '..', 'src', 'cli.js');

const svc = new Service({
  name: 'Pastita Print Agent',
  description: 'Agente de impressão automática de pedidos Pastita',
  script: cliPath,
  nodeOptions: [],
  env: [
    {
      name: 'PASTITA_PRINT_AGENT_CONFIG',
      value: path.resolve(__dirname, '..', 'config', 'agent.json'),
    },
  ],
});

const command = process.argv[2];

svc.on('install', () => {
  console.log('Serviço instalado. Iniciando...');
  svc.start();
});

svc.on('start', () => {
  console.log('Pastita Print Agent iniciado como serviço Windows.');
  console.log('Para verificar: Gerenciador de Serviços → "Pastita Print Agent"');
});

svc.on('uninstall', () => {
  console.log('Serviço removido.');
});

svc.on('error', (err) => {
  console.error('Erro no serviço:', err);
});

if (command === 'install') {
  svc.install();
} else if (command === 'uninstall') {
  svc.uninstall();
} else {
  console.log('Uso: node scripts/service.cjs <install|uninstall>');
  process.exit(1);
}

import fs from 'node:fs';
import path from 'node:path';

export function loadConfig() {
  const explicitPath = process.env.PASTITA_PRINT_AGENT_CONFIG;
  const configPath = explicitPath || path.resolve(process.cwd(), 'config/agent.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw);

  // Aceita `agentKeys` (lista) ou `agentKey` (texto OU lista). Em 25/09 o
  // notebook da loja ficou 20 h mudo porque o config tinha `agentKey: [a, b]`:
  // String([a, b]) vira "a,b" — uma chave só, com o segredo errado.
  const bruto = parsed.agentKeys ?? parsed.agentKey ?? [];
  const agentKeys = (Array.isArray(bruto) ? bruto : [bruto])
    .map((k) => String(k || '').trim())
    .filter(Boolean);

  return {
    backendUrl: String(parsed.backendUrl || '').replace(/\/+$/, ''),
    agentKeys,
    printerName: String(parsed.printerName || ''),
    pollIntervalMs: Number(parsed.pollIntervalMs || 2000),
    heartbeatIntervalMs: Number(parsed.heartbeatIntervalMs || 30000),
    stateFile: path.resolve(process.cwd(), parsed.stateFile || './data/agent-state.json'),
    logLevel: String(parsed.logLevel || 'info'),
  };
}

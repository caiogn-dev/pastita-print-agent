import fs from 'node:fs';
import path from 'node:path';

export function loadConfig() {
  const explicitPath = process.env.PASTITA_PRINT_AGENT_CONFIG;
  const configPath = explicitPath || path.resolve(process.cwd(), 'config/agent.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw);

  // suporta agentKey (string) ou agentKeys (array)
  const agentKeys = Array.isArray(parsed.agentKeys)
    ? parsed.agentKeys
    : [String(parsed.agentKey || '')];

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

import { execFile } from 'node:child_process';

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = { at: 0, printers: [] };

function exec(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: 15000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

async function viaPowerShell() {
  const out = await exec('powershell.exe', [
    '-NoProfile',
    '-Command',
    'Get-Printer | Select-Object -ExpandProperty Name',
  ]);
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

async function viaWmic() {
  const out = await exec('wmic', ['printer', 'get', 'name']);
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && l.toLowerCase() !== 'name');
}

/**
 * Lista as impressoras instaladas no Windows (com cache de 5min).
 * Em plataformas não-Windows ou em falha, retorna [] sem quebrar o agent.
 */
export async function listWindowsPrinters() {
  if (Date.now() - cache.at < CACHE_TTL_MS) return cache.printers;
  if (process.platform !== 'win32') return [];

  let printers = [];
  try {
    printers = await viaPowerShell();
  } catch {
    try {
      printers = await viaWmic();
    } catch {
      printers = [];
    }
  }
  cache = { at: Date.now(), printers };
  return printers;
}

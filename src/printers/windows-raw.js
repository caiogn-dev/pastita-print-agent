import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const PRINT_SCRIPT = path.join(ROOT, 'scripts', 'windows-print-raw.ps1');
const LIST_SCRIPT = path.join(ROOT, 'scripts', 'list-printers.ps1');

function runPowerShell(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      ...args,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `PowerShell exited with ${code}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

export async function listWindowsPrinters() {
  const output = await runPowerShell(LIST_SCRIPT);
  if (!output) return [];
  return JSON.parse(output);
}

export async function printRawWindows({ printerName, data }) {
  const tempFile = path.join(os.tmpdir(), `pastita-print-${Date.now()}.bin`);
  fs.writeFileSync(tempFile, data);
  try {
    await runPowerShell(PRINT_SCRIPT, [
      '-PrinterName', printerName,
      '-FilePath', tempFile,
    ]);
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
}

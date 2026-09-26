import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

function comConfig(obj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  const p = path.join(dir, 'agent.json');
  fs.writeFileSync(p, JSON.stringify({ backendUrl: 'https://x', ...obj }));
  process.env.PASTITA_PRINT_AGENT_CONFIG = p;
  try { return loadConfig(); } finally { delete process.env.PASTITA_PRINT_AGENT_CONFIG; }
}

test('agentKeys em lista', () => {
  assert.deepEqual(comConfig({ agentKeys: ['pa_a.1', 'pa_b.2'] }).agentKeys, ['pa_a.1', 'pa_b.2']);
});

test('agentKey em texto', () => {
  assert.deepEqual(comConfig({ agentKey: 'pa_a.1' }).agentKeys, ['pa_a.1']);
});

test('agentKey com lista não vira "a,b" (armadilha de 25/09)', () => {
  assert.deepEqual(comConfig({ agentKey: ['pa_a.1', ' pa_b.2 '] }).agentKeys, ['pa_a.1', 'pa_b.2']);
});

test('chave vazia é descartada', () => {
  assert.deepEqual(comConfig({ agentKeys: ['', 'pa_a.1'] }).agentKeys, ['pa_a.1']);
});

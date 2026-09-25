import test from 'node:test';
import assert from 'node:assert/strict';
import { buildZplLabel } from '../src/zpl.js';
import { PrintApiClient } from '../src/api-client.js';

test('ZPL vira bytes UTF-8 sem mexer no conteúdo', () => {
  const zpl = '^XA^CI28^FDSódio^FS^XZ';
  const buf = buildZplLabel({ zpl });
  assert.equal(buf.toString('utf8'), zpl);
  assert.ok(buf.includes(Buffer.from('ó', 'utf8')));
});

test('job sem ZPL é recusado antes de tocar na impressora', () => {
  assert.throws(() => buildZplLabel({}), /sem ZPL/);
  assert.throws(() => buildZplLabel({ zpl: 'ESC/POS' }), /sem ZPL/);
});

test('cliente expõe só o prefixo da chave', () => {
  const api = new PrintApiClient({ backendUrl: 'http://x', agentKey: 'pa_abc123.segredo' });
  assert.equal(api.keyPrefix, 'pa_abc123');
  assert.equal(new PrintApiClient({ backendUrl: 'http://x', agentKey: '' }).keyPrefix, '(vazia)');
});

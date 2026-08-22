// Renderiza no terminal o que a impressora vai fazer com o buffer ESC/POS.
// Serve para conferir larguras e alinhamento sem gastar fita.
//   node scripts/preview.mjs [kitchen|receipt]
import iconv from 'iconv-lite';
import { buildTestTicket } from '../src/escpos.js';

const W = 48;
const R = '\x1b[0m', REV = '\x1b[7m', BLD = '\x1b[1m', DIM = '\x1b[2m';

function render(buf) {
  let align = 0, invert = false, bold = false, dbl = false;
  let segs = [], out = [];

  const width = () => segs.reduce((n, s) => n + s.t.length * (s.d ? 2 : 1), 0);
  const flush = () => {
    const w = width();
    const pad = align === 1 ? Math.max(0, Math.floor((W - w) / 2)) : align === 2 ? Math.max(0, W - w) : 0;
    const body = segs.map((s) =>
      (s.i ? REV : '') + (s.b || s.d ? BLD : '') + s.t + R).join('');
    out.push(' '.repeat(pad) + body + (w > W ? `  ${DIM}<- ${w} col!${R}` : ''));
    segs = [];
  };

  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x1b) {                       // ESC
      const c = buf[i + 1];
      if (c === 0x40) { i += 1; continue; }                      // init
      if (c === 0x74) { i += 2; continue; }                      // codepage
      if (c === 0x61) { align = buf[i + 2]; i += 2; continue; }  // align
      if (c === 0x45) { bold = !!buf[i + 2]; i += 2; continue; } // bold
      i += 1; continue;
    }
    if (b === 0x1d) {                       // GS
      const c = buf[i + 1];
      if (c === 0x21) { dbl = buf[i + 2] === 0x11; i += 2; continue; }      // tamanho
      if (c === 0x42) { invert = !!buf[i + 2]; i += 2; continue; }          // inverso
      if (c === 0x56) { out.push(DIM + '─'.repeat(W) + '  corte' + R); i += 2; continue; }
      if (c === 0x76) {                                                     // raster
        const bpr = buf[i + 4] | (buf[i + 5] << 8);
        const h   = buf[i + 6] | (buf[i + 7] << 8);
        out.push(' '.repeat(Math.floor((W - 14) / 2)) + DIM + `[ logo ${bpr * 8}x${h} ]` + R);
        i += 7 + bpr * h; continue;
      }
      if (c === 0x68 || c === 0x77 || c === 0x48) { i += 2; continue; }     // params barcode
      if (c === 0x6b) {                                                     // barcode
        const n = buf[i + 3];
        out.push(' '.repeat(Math.floor((W - 20) / 2)) + DIM + '║▌║▌▌║▌║▌▌▌║▌║▌' + R);
        i += 3 + n; continue;
      }
      i += 1; continue;
    }
    if (b === 0x0a) { flush(); continue; }
    let j = i;
    while (j < buf.length && buf[j] !== 0x0a && buf[j] !== 0x1b && buf[j] !== 0x1d) j++;
    segs.push({ t: iconv.decode(buf.subarray(i, j), 'cp850'), i: invert, b: bold, d: dbl });
    i = j - 1;
  }
  if (segs.length) flush();
  return out;
}

const buf = buildTestTicket();
console.log(DIM + '┌' + '─'.repeat(W) + '┐' + R);
for (const l of render(buf)) console.log(DIM + '│' + R + l);
console.log(DIM + '└' + '─'.repeat(W) + '┘  ' + buf.length + ' bytes' + R);

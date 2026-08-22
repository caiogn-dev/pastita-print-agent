import iconv from 'iconv-lite';

import { TEST_LOGO } from './test-logo.js';

// ── Constantes ESC/POS ────────────────────────────────────────────────────────
const ESC = 0x1b;
const GS  = 0x1d;
const W   = 48; // colunas em fonte normal (papel 80mm)

const cmd = (...bytes) => Buffer.from(bytes);

const INIT             = cmd(ESC, 0x40);
const CODEPAGE_PC850   = cmd(ESC, 0x74, 0x02);   // PC850 — cobre todos os acentos pt-BR
const ALIGN_LEFT       = cmd(ESC, 0x61, 0x00);
const ALIGN_CENTER     = cmd(ESC, 0x61, 0x01);
const BOLD_ON          = cmd(ESC, 0x45, 0x01);
const BOLD_OFF         = cmd(ESC, 0x45, 0x00);
const DOUBLE_ON        = cmd(GS,  0x21, 0x11);   // largura + altura x2
const DOUBLE_HEIGHT_ON = cmd(GS,  0x21, 0x01);   // só altura x2
const DOUBLE_OFF       = cmd(GS,  0x21, 0x00);
const INVERT_ON        = cmd(GS,  0x42, 0x01);   // fundo preto / texto branco
const INVERT_OFF       = cmd(GS,  0x42, 0x00);
const LF               = cmd(0x0a);
const CUT              = cmd(GS,  0x56, 0x00);

// ── Helpers ───────────────────────────────────────────────────────────────────

// Codifica string para PC850 (resolve acentos pt-BR)
function enc(str) {
  return iconv.encode(String(str ?? ''), 'cp850');
}

function line(text) {
  return Buffer.concat([enc(text), LF]);
}

function divider(char = '\u2500') {
  return line(char.repeat(W));
}

function dashed() {
  return line('- '.repeat(W / 2));
}

// Duas colunas: esquerda + direita, alinhadas em W chars
function twoCols(left, right, w = W) {
  const l = String(left ?? '');
  const r = String(right ?? '');
  const space = Math.max(1, w - l.length - r.length);
  return line(l + ' '.repeat(space) + r);
}

function money(val) {
  const n = parseFloat(val ?? 0) || 0;
  return `R$ ${n.toFixed(2).replace('.', ',')}`;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    }).replace(',', '');
  } catch { return String(iso ?? ''); }
}

// Quebra texto longo em array de strings de até maxLen chars
function wrap(text, maxLen = W, indentLen = 0) {
  const indent = ' '.repeat(indentLen);
  const words  = String(text ?? '').split(' ');
  const lines  = [];
  let cur = indent;
  for (const w of words) {
    if (cur.length + w.length + 1 > maxLen && cur.trim()) {
      lines.push(cur.trimEnd());
      cur = indent + w + ' ';
    } else {
      cur += w + ' ';
    }
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines;
}

// ── Faixas, raster e código de barras ─────────────────────────────────────────

// Centraliza dentro de uma largura fixa. O INVERT pinta o espaço também, então
// preencher até a borda é o que faz a faixa sair cheia de ponta a ponta.
function center(text, w = W) {
  const t = String(text ?? '').slice(0, w);
  const left = Math.floor((w - t.length) / 2);
  return ' '.repeat(left) + t + ' '.repeat(w - t.length - left);
}

// Faixa invertida. `big` dobra o corpo — e como cada caractere passa a ocupar
// duas colunas, a largura útil cai pela metade (24, não 48).
function band(text, { big = false } = {}) {
  const w = big ? W / 2 : W;
  return [
    ALIGN_LEFT, INVERT_ON, BOLD_ON, ...(big ? [DOUBLE_ON] : []),
    enc(center(text, w)), LF,
    ...(big ? [DOUBLE_OFF] : []), BOLD_OFF, INVERT_OFF,
  ];
}

// Logo em raster (GS v 0). O backend manda o bitmap já em 1 bit; o agent não
// converte imagem nenhuma — só despeja os bytes.
function raster(logo) {
  if (!logo?.data || !logo.width || !logo.height) return [];
  const bytesPerRow = Math.ceil(logo.width / 8);
  const data = Buffer.from(logo.data, 'base64');
  // Bitmap truncado imprime lixo por metros de fita: melhor não imprimir nada.
  if (data.length !== bytesPerRow * logo.height) return [];
  return [
    ALIGN_CENTER,
    cmd(GS, 0x76, 0x30, 0x00,
        bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
        logo.height & 0xff, (logo.height >> 8) & 0xff),
    data,
  ];
}

// Code128 nativo (GS k 73). HRI desligada de propósito: com ela ligada a
// impressora imprime o seletor '{B' junto do número.
function barcode(code) {
  const value = String(code ?? '').replace(/[^\x20-\x7e]/g, '').slice(0, 22);
  if (!value) return [];
  const data = Buffer.from(`{B${value}`, 'ascii');
  return [
    ALIGN_CENTER,
    cmd(GS, 0x68, 0x50),  // altura 80 dots
    cmd(GS, 0x77, 0x02),  // largura do módulo
    cmd(GS, 0x48, 0x00),  // HRI off
    cmd(GS, 0x6b, 0x49, data.length), data, LF,
  ];
}

const IND = ' '.repeat(8);

// ── Renderiza item ─────────────────────────────────────────────────────────────
// Layout: '[ ] ' + quantidade em corpo duplo + nome. A quantidade é o dado que
// mais gera erro na cozinha, então é a única coisa da linha que cresce.
function renderItem(item) {
  const out    = [];
  const qty    = item.qty ?? item.quantity ?? 1;
  const name   = String(item.name ?? item.product_name ?? '').toUpperCase();
  const qtyTxt = `${qty}x`;
  // corpo duplo = 2 colunas por caractere; '[ ] ' são 4 e o espaço depois, 1
  const indent = 4 + qtyTxt.length * 2 + 1;
  const nameLines = wrap(name, W - indent);

  out.push(ALIGN_LEFT, BOLD_ON, enc('[ ] '), DOUBLE_ON, enc(qtyTxt), DOUBLE_OFF);
  out.push(enc(' ' + (nameLines[0] ?? '')), LF);
  for (const l of nameLines.slice(1)) out.push(line(' '.repeat(indent) + l));
  out.push(BOLD_OFF);

  const variant = item.variant_name ?? item.variant ?? '';
  if (variant) out.push(line(`${IND}· ${variant}`));

  // Escolhas de combo / detalhes vindos do backend (payload 'details').
  // Quando o backend também manda as escolhas espelhadas em 'ingredients'
  // (compat com agents antigos), pula details p/ não imprimir 2x.
  const ingredients = item.ingredients ?? item.options?.ingredients ?? [];
  if (ingredients.length === 0) {
    for (const d of (item.details ?? [])) {
      for (const l of wrap(String(d), W - IND.length)) out.push(line(IND + l));
    }
  }

  for (const ing of ingredients) {
    const role  = ing.role ? `${ing.role}: ` : '';
    const extra = ing.price > 0 ? ` (+${money(ing.price)})` : '';
    for (const l of wrap(`· ${role}${ing.name}${extra}`, W - IND.length)) out.push(line(IND + l));
  }

  // A observação do item é o que gera retrabalho quando passa batido, então é a
  // única coisa invertida dentro do bloco.
  if (item.notes) {
    for (const l of wrap(String(item.notes).toUpperCase(), W - IND.length - 2)) {
      out.push(enc(IND), INVERT_ON, BOLD_ON, enc(` ${l} `), BOLD_OFF, INVERT_OFF, LF);
    }
  }

  out.push(LF);
  return out;
}

// ── Renderiza combo ────────────────────────────────────────────────────────────
function renderCombo(combo) {
  const out    = [];
  const qty    = combo.quantity ?? 1;
  const name   = String(combo.combo_name ?? combo.name ?? '').toUpperCase();
  const qtyTxt = `${qty}x`;
  const indent = 4 + qtyTxt.length * 2 + 1;
  const nameLines = wrap(name, W - indent);

  out.push(ALIGN_LEFT, BOLD_ON, enc('[ ] '), DOUBLE_ON, enc(qtyTxt), DOUBLE_OFF);
  out.push(enc(' ' + (nameLines[0] ?? '')), LF);
  for (const l of nameLines.slice(1)) out.push(line(' '.repeat(indent) + l));
  out.push(BOLD_OFF);
  out.push(line(`${IND}[COMBO]`));

  for (const c of (combo.customizations?.ingredients ?? combo.ingredients ?? [])) {
    const role  = c.role ? `${c.role}: ` : '';
    const extra = c.price > 0 ? ` (+${money(c.price)})` : '';
    for (const l of wrap(`· ${role}${c.name}${extra}`, W - IND.length)) out.push(line(IND + l));
  }

  if (combo.notes) {
    for (const l of wrap(String(combo.notes).toUpperCase(), W - IND.length - 2)) {
      out.push(enc(IND), INVERT_ON, BOLD_ON, enc(` ${l} `), BOLD_OFF, INVERT_OFF, LF);
    }
  }

  out.push(LF);
  return out;
}

// ── Builder principal ──────────────────────────────────────────────────────────
export function buildKitchenTicket(payload) {
  const store    = payload.store    ?? {};
  const order    = payload.order    ?? {};
  const customer = payload.customer ?? {};
  const totals   = payload.totals   ?? {};
  const items    = payload.items    ?? [];
  const combos   = payload.combo_items ?? [];

  // Três modos, não dois. `!== 'pickup'` jogava 'digital' em ENTREGA: a
  // cobrança por link virava comanda mandando entregar, sem endereço nenhum.
  const modo = order.delivery_method ?? 'delivery';
  const isDelivery = modo === 'delivery';
  const isPickup = modo === 'pickup';

  const PAYMENT_LABELS = {
    pix: 'PIX', credit_card: 'CREDITO', debit_card: 'DEBITO',
    cash: 'DINHEIRO', card: 'CARTAO', mercadopago: 'MERCADO PAGO',
  };
  const STATUS_LABELS = {
    pending: 'AGUARDANDO PAGAMENTO', paid: 'PAGO',
    failed: 'PAGAMENTO FALHOU', refunded: 'REEMBOLSADO',
  };
  const SOURCE_LABELS = {
    whatsapp: 'WhatsApp', instagram: 'Instagram', pdv: 'PDV', balcao: 'balcao',
    web: 'site', site: 'site', storefront: 'site', payment_link: 'link de pagamento',
  };

  const payMethod = PAYMENT_LABELS[order.payment_method] ?? String(order.payment_method ?? '').toUpperCase();
  const payStatus = STATUS_LABELS[order.payment_status]  ?? String(order.payment_status  ?? '').toUpperCase();
  const isPaid    = order.payment_status === 'paid';

  const out = [];
  out.push(INIT, CODEPAGE_PC850);

  // ── Cabeçalho: selo da loja + nome ────────────────────────────────────────
  // Com quatro lojas na mesma impressora, é a forma que separa as comandas na
  // bancada. Sem logo no payload, sobra o nome — a comanda sai igual.
  const logo = raster(store.logo_escpos);
  if (logo.length) out.push(...logo, LF);
  out.push(ALIGN_CENTER, BOLD_ON, enc(String(store.name ?? 'LOJA').toUpperCase()), LF, BOLD_OFF, LF);

  // ── Faixa 1: o modo, que decide o fluxo inteiro ──────────────────────────
  out.push(...band(isDelivery ? 'ENTREGA' : isPickup ? 'RETIRADA' : 'PAGTO POR LINK', { big: true }));
  out.push(LF);

  // ── Número do pedido + contexto ──────────────────────────────────────────
  out.push(ALIGN_CENTER, DOUBLE_ON, BOLD_ON, enc(`#${order.order_number ?? ''}`), LF, BOLD_OFF, DOUBLE_OFF);
  const canal = SOURCE_LABELS[order.source] ?? '';
  const contexto = [
    order.created_at ? formatDate(order.created_at) : '',
    canal ? `via ${canal}` : '',
  ].filter(Boolean).join('  ');
  if (contexto) out.push(ALIGN_CENTER, enc(contexto), LF);

  // ── Faixa 2: agendamento (só quando existe, e aí manda no papel) ─────────
  const sched = [order.scheduled_date, order.scheduled_time].filter(Boolean).join(' ');
  if (sched) out.push(LF, ...band(`AGENDADO ${sched}`));
  out.push(LF);

  // ── Cliente, centralizado ────────────────────────────────────────────────
  if (customer.name) out.push(ALIGN_CENTER, BOLD_ON, enc(String(customer.name).toUpperCase()), LF, BOLD_OFF);
  if (customer.phone) out.push(ALIGN_CENTER, enc(String(customer.phone)), LF);
  if (isDelivery && payload.address_lines?.length) {
    for (const l of payload.address_lines) {
      for (const w of wrap(String(l))) out.push(ALIGN_CENTER, enc(w), LF);
    }
  }
  out.push(LF);

  // ── Faixa 3: atenção da loja ─────────────────────────────────────────────
  const kitchenNotes = [order.internal_notes, order.delivery_instructions].filter(Boolean).join(' | ');
  if (kitchenNotes) {
    out.push(...band('!! ATENCAO DA LOJA !!'));
    for (const l of wrap(kitchenNotes)) out.push(ALIGN_CENTER, BOLD_ON, enc(l), LF, BOLD_OFF);
    out.push(LF);
  }

  // ── Faixa 4: observação do cliente (só imprime se existir) ───────────────
  const custNotes = order.customer_notes ?? order.observacoes ?? order.delivery_notes ?? '';
  if (custNotes) {
    out.push(...band('OBSERVACAO DO CLIENTE'));
    for (const l of wrap(custNotes)) out.push(ALIGN_CENTER, BOLD_ON, enc(l), LF, BOLD_OFF);
    out.push(LF);
  }

  // ── Itens ────────────────────────────────────────────────────────────────
  // A contagem é a soma das quantidades, não o número de linhas: é o número
  // que se confere contra a sacola fechada.
  const unidades =
    items.reduce((n, i) => n + Number(i.qty ?? i.quantity ?? 1), 0) +
    combos.reduce((n, c) => n + Number(c.quantity ?? 1), 0);
  out.push(...band(`${unidades} ${unidades === 1 ? 'ITEM' : 'ITENS'}`));
  out.push(LF);

  for (const item  of items)  out.push(...renderItem(item));
  for (const combo of combos) out.push(...renderCombo(combo));

  // ── Totais ───────────────────────────────────────────────────────────────
  const subtotal    = parseFloat(totals.subtotal     ?? order.subtotal     ?? 0);
  const deliveryFee = parseFloat(totals.delivery_fee ?? order.delivery_fee ?? 0);
  const discount    = parseFloat(totals.discount     ?? order.discount     ?? 0);
  const total       = parseFloat(totals.total        ?? order.total        ?? 0);

  out.push(ALIGN_LEFT, divider());
  out.push(twoCols('Subtotal', money(subtotal)));
  if (deliveryFee > 0) out.push(twoCols('Entrega', money(deliveryFee)));
  if (discount    > 0) out.push(twoCols('Desconto', `- ${money(discount)}`));
  out.push(LF);
  out.push(ALIGN_CENTER, DOUBLE_HEIGHT_ON, BOLD_ON, enc(`TOTAL  ${money(total)}`), LF, BOLD_OFF, DOUBLE_OFF);
  out.push(LF);

  // ── Faixa 5: pagamento — calma quando pago, grito quando não ─────────────
  out.push(...band(isPaid ? `${payMethod} - PAGO` : `!! ${payStatus} !!`));

  // ── Código de barras do pedido (bipável na expedição) ───────────────────
  out.push(LF, ...barcode(order.order_number));
  if (order.order_number) out.push(ALIGN_CENTER, enc(String(order.order_number)), LF);

  // ── Rodapé: a loja sai daqui, não do topo ───────────────────────────────
  out.push(LF, ALIGN_CENTER, enc([store.name, store.phone].filter(Boolean).join(' · ')), LF);
  out.push(LF, LF, LF);
  out.push(CUT);

  return Buffer.concat(out.flat().map((b) => Buffer.isBuffer(b) ? b : enc(b)));
}

export function buildTestTicket() {
  return buildKitchenTicket({
    store: {
      name: 'Cê Saladas',
      phone: '(63) 3025-0000',
      logo_escpos: TEST_LOGO,
    },
    order: {
      order_number: 'TESTE-001',
      created_at: new Date().toISOString(),
      source: 'whatsapp',
      delivery_method: 'delivery',
      payment_method: 'pix',
      payment_status: 'paid',
      customer_notes: 'Sem cebola na salada, por favor.',
    },
    customer: { name: 'Ana Paula Souza', phone: '(63) 98888-1234' },
    address_lines: [
      'Rua das Palmeiras, 145 - Apto 302',
      'Plano Diretor Sul - Palmas/TO',
    ],
    items: [
      {
        qty: 2,
        name: 'Salada Caesar Grande',
        subtotal: '59.80',
        notes: 'Sem cebola',
        ingredients: [
          { role: 'Proteina', name: 'Frango grelhado', price: 0 },
          { role: 'Molho', name: 'Caesar', price: 0 },
        ],
      },
      { qty: 1, name: 'Suco de Laranja Natural 500ml', subtotal: '12.00' },
    ],
    combo_items: [],
    totals: { subtotal: '71.80', delivery_fee: '8.00', discount: '7.18', total: '72.62' },
  });
}

// ── Cupom do cliente (não fiscal) — venda de balcão/PDV ───────────────────────
export function buildCustomerReceipt(payload) {
  const store    = payload.store    ?? {};
  const order    = payload.order    ?? {};
  const customer = payload.customer ?? {};
  const totals   = payload.totals   ?? {};
  const items    = payload.items    ?? [];

  const PAYMENT_LABELS = {
    pix: 'PIX', credit_card: 'CREDITO', debit_card: 'DEBITO',
    cash: 'DINHEIRO', card: 'CARTAO', mercadopago: 'MERCADO PAGO',
  };
  const payMethod = PAYMENT_LABELS[order.payment_method] ?? String(order.payment_method ?? '').toUpperCase();

  const out = [];
  out.push(INIT, CODEPAGE_PC850);

  // Cabeçalho
  out.push(ALIGN_CENTER, LF);
  out.push(DOUBLE_ON, BOLD_ON, enc(String(store.name ?? 'LOJA').toUpperCase()), LF, BOLD_OFF, DOUBLE_OFF);
  if (store.phone)   out.push(enc(store.phone), LF);
  if (store.address) out.push(enc(store.address), LF);
  out.push(LF, enc('*** CUPOM NAO FISCAL ***'), LF, dashed());

  out.push(BOLD_ON, enc(`PEDIDO #${order.order_number ?? ''}`), LF, BOLD_OFF);
  if (order.created_at) out.push(enc(formatDate(order.created_at)), LF);
  out.push(ALIGN_LEFT, dashed());

  // Itens com preço unitário
  for (const item of items) {
    const qty  = item.qty ?? 1;
    const name = String(item.name ?? '');
    for (const l of wrap(`${qty}x ${name}`)) out.push(line(l));
    out.push(twoCols(`   ${money(item.unit_price)} un.`, money(item.subtotal)));
  }
  out.push(divider());

  // Totais
  const subtotal = parseFloat(totals.subtotal ?? 0);
  const discount = parseFloat(totals.discount ?? 0);
  const total    = parseFloat(totals.total    ?? 0);
  out.push(twoCols('Subtotal:', money(subtotal)));
  if (discount > 0) out.push(twoCols('Desconto:', `- ${money(discount)}`));
  out.push(divider('='));
  out.push(BOLD_ON, DOUBLE_HEIGHT_ON, twoCols('TOTAL:', money(total)), DOUBLE_OFF, BOLD_OFF);
  out.push(divider('='));
  out.push(twoCols('Pagamento:', payMethod));
  out.push(dashed());

  // Cliente (quando vinculado)
  if (customer.name && customer.name !== 'Cliente Balcão') {
    out.push(line(`Cliente: ${customer.name}`));
    out.push(dashed());
  }

  // Rodapé
  out.push(ALIGN_CENTER);
  out.push(BOLD_ON, enc('Obrigado pela preferencia!'), LF, BOLD_OFF);
  out.push(enc('Documento sem valor fiscal'), LF);
  out.push(LF, LF, LF, LF);
  out.push(CUT);

  return Buffer.concat(out.flat().map((b) => Buffer.isBuffer(b) ? b : enc(b)));
}

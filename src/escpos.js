import iconv from 'iconv-lite';

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

function divider(char = '-') {
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
    });
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

// ── Renderiza item ─────────────────────────────────────────────────────────────
function renderItem(item) {
  const out    = [];
  const qty    = item.qty ?? item.quantity ?? 1;
  const name   = item.name ?? item.product_name ?? '';
  const sub    = parseFloat(item.subtotal ?? item.total_price ?? qty * Number(item.unit_price ?? 0));
  const price  = money(sub);
  const label  = `${qty}x ${name}`;
  const maxLbl = W - price.length - 1;

  out.push(BOLD_ON);
  if (label.length <= maxLbl) {
    out.push(twoCols(label, price));
  } else {
    out.push(twoCols(`${qty}x`, price));
    for (const l of wrap(name, W, 3)) out.push(line(`   ${l}`));
  }
  out.push(BOLD_OFF);

  const variant = item.variant_name ?? item.variant ?? '';
  if (variant) out.push(line(`   > ${variant}`));

  // Escolhas de combo / detalhes vindos do backend (payload 'details').
  // Quando o backend também manda as escolhas espelhadas em 'ingredients'
  // (compat com agents antigos), pula details p/ não imprimir 2x.
  const hasIngredients = (item.ingredients ?? item.options?.ingredients ?? []).length > 0;
  if (!hasIngredients) {
    for (const d of (item.details ?? [])) {
      for (const l of wrap(String(d), W, 3)) out.push(line(`   ${l}`));
    }
  }

  for (const ing of (item.ingredients ?? item.options?.ingredients ?? [])) {
    const role  = ing.role ? `${ing.role}: ` : '';
    const extra = ing.price > 0 ? ` (+${money(ing.price)})` : '';
    out.push(line(`   + ${role}${ing.name}${extra}`));
  }

  if (item.notes) {
    out.push(BOLD_ON);
    for (const l of wrap(`OBS: ${item.notes}`, W, 3)) out.push(line(`   ${l}`));
    out.push(BOLD_OFF);
  }

  return out;
}

// ── Renderiza combo ────────────────────────────────────────────────────────────
function renderCombo(combo) {
  const out   = [];
  const qty   = combo.quantity ?? 1;
  const name  = combo.combo_name ?? combo.name ?? '';
  const price = money(combo.subtotal ?? 0);
  const label = `${qty}x ${name}`;

  out.push(BOLD_ON, twoCols(label, price), BOLD_OFF);
  out.push(line('   [COMBO]'));

  for (const c of (combo.customizations?.ingredients ?? combo.ingredients ?? [])) {
    const role  = c.role ? `${c.role}: ` : '';
    const extra = c.price > 0 ? ` (+${money(c.price)})` : '';
    out.push(line(`   + ${role}${c.name}${extra}`));
  }

  if (combo.notes) {
    out.push(BOLD_ON);
    for (const l of wrap(`OBS: ${combo.notes}`, W, 3)) out.push(line(`   ${l}`));
    out.push(BOLD_OFF);
  }

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
    pending: 'AGUARDANDO', paid: 'PAGO', failed: 'FALHOU', refunded: 'REEMBOLSADO',
  };

  const payMethod = PAYMENT_LABELS[order.payment_method] ?? String(order.payment_method ?? '').toUpperCase();
  const payStatus = STATUS_LABELS[order.payment_status]  ?? String(order.payment_status  ?? '').toUpperCase();

  const out = [];

  // ── Init ──────────────────────────────────────────────────────────────────
  out.push(INIT, CODEPAGE_PC850);

  // ── Cabeçalho: nome da loja ───────────────────────────────────────────────
  out.push(ALIGN_CENTER);
  out.push(LF);
  out.push(DOUBLE_ON, BOLD_ON, enc(String(store.name ?? 'LOJA').toUpperCase()), LF, BOLD_OFF, DOUBLE_OFF);
  if (store.phone)   out.push(enc(store.phone), LF);
  if (store.address) out.push(enc(store.address), LF);
  out.push(LF, dashed());

  // ── Numero do pedido (invertido) ─────────────────────────────────────────
  const orderNum = `  PEDIDO #${order.order_number ?? ''}  `;
  out.push(ALIGN_CENTER, INVERT_ON, BOLD_ON, DOUBLE_HEIGHT_ON);
  out.push(enc(orderNum), LF);
  out.push(DOUBLE_OFF, BOLD_OFF, INVERT_OFF);

  // Data/hora + tipo de entrega
  if (order.created_at) out.push(enc(formatDate(order.created_at)), LF);
  const deliveryLabel = isDelivery
    ? '*** ENTREGA ***'
    : isPickup ? '*** RETIRADA ***' : '*** PAGAMENTO POR LINK ***';
  out.push(BOLD_ON, enc(deliveryLabel), LF, BOLD_OFF);

  // Agendado
  const sched = [order.scheduled_date, order.scheduled_time].filter(Boolean).join(' ');
  if (sched) out.push(BOLD_ON, enc(`AGENDADO: ${sched}`), LF, BOLD_OFF);

  out.push(LF, ALIGN_LEFT, dashed());

  // ── Cliente ───────────────────────────────────────────────────────────────
  out.push(BOLD_ON, line('CLIENTE'), BOLD_OFF);
  out.push(BOLD_ON, line(String(customer.name ?? '')), BOLD_OFF);
  if (customer.phone) out.push(line(customer.phone));

  if (isDelivery && payload.address_lines?.length) {
    out.push(LF, BOLD_ON, line('ENDERECO DE ENTREGA:'), BOLD_OFF);
    for (const l of payload.address_lines) out.push(line(String(l)));
  } else if (isPickup) {
    out.push(LF, BOLD_ON, line('** RETIRADA NO LOCAL **'), BOLD_OFF);
  }
  out.push(dashed());

  // ── Atenção da loja ───────────────────────────────────────────────────────
  const kitchenNotes = [order.internal_notes, order.delivery_instructions].filter(Boolean).join(' | ');
  if (kitchenNotes) {
    out.push(ALIGN_CENTER, INVERT_ON, BOLD_ON, enc('  !! ATENCAO DA LOJA !!  '), LF, BOLD_OFF, INVERT_OFF);
    out.push(ALIGN_LEFT);
    for (const l of wrap(kitchenNotes)) out.push(BOLD_ON, line(l), BOLD_OFF);
    out.push(dashed());
  }

  // ── Observações do cliente ────────────────────────────────────────────────
  const custNotes = order.customer_notes ?? order.observacoes ?? order.delivery_notes ?? '';
  if (custNotes) {
    out.push(BOLD_ON, line('OBSERVACOES:'), BOLD_OFF);
    for (const l of wrap(custNotes)) out.push(line(l));
    out.push(dashed());
  }

  // ── Itens ─────────────────────────────────────────────────────────────────
  out.push(BOLD_ON, line('ITENS DO PEDIDO'), BOLD_OFF);
  out.push(divider());

  for (const item  of items)  { out.push(...renderItem(item),  divider()); }
  for (const combo of combos) { out.push(...renderCombo(combo), divider()); }

  // ── Totais ────────────────────────────────────────────────────────────────
  const subtotal    = parseFloat(totals.subtotal    ?? order.subtotal    ?? 0);
  const deliveryFee = parseFloat(totals.delivery_fee ?? order.delivery_fee ?? 0);
  const discount    = parseFloat(totals.discount    ?? order.discount    ?? 0);
  const total       = parseFloat(totals.total       ?? order.total       ?? 0);

  out.push(twoCols('Subtotal:', money(subtotal)));
  if (deliveryFee > 0) out.push(twoCols('Taxa de Entrega:', money(deliveryFee)));
  if (discount    > 0) out.push(twoCols('Desconto:', `- ${money(discount)}`));
  out.push(divider('='));
  out.push(BOLD_ON, twoCols('TOTAL:', money(total)), BOLD_OFF);
  out.push(divider('='));

  // ── Pagamento ─────────────────────────────────────────────────────────────
  out.push(twoCols('Pagamento:', payMethod));
  out.push(twoCols('Status pgto:', payStatus));
  out.push(dashed());

  // ── Rodapé ────────────────────────────────────────────────────────────────
  out.push(ALIGN_CENTER);
  out.push(BOLD_ON, enc('Obrigado pela preferencia!'), LF, BOLD_OFF);
  out.push(enc(`Impresso em ${formatDate(new Date().toISOString())}`), LF);
  out.push(LF, LF, LF, LF);
  out.push(CUT);

  return Buffer.concat(out.flat().map((b) => Buffer.isBuffer(b) ? b : enc(b)));
}

export function buildTestTicket() {
  return buildKitchenTicket({
    store: { name: 'Pastita', phone: '(11) 99999-9999' },
    order: {
      order_number: 'TESTE-001',
      created_at: new Date().toISOString(),
      delivery_method: 'pickup',
      payment_method: 'pix',
      payment_status: 'paid',
      customer_notes: 'Sem cebola e sem tomate, obrigado!',
      internal_notes: 'Cliente VIP — atenção especial',
    },
    customer: { name: 'Joao da Silva', phone: '(11) 91234-5678' },
    address_lines: [],
    items: [
      { qty: 2, name: 'Pastita Tradicional', subtotal: '50.00', notes: 'Sem molho' },
      { qty: 1, name: 'Suco de Laranja Natural', subtotal: '10.00' },
    ],
    combo_items: [],
    totals: { subtotal: '60.00', delivery_fee: '0.00', discount: '5.00', total: '55.00' },
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

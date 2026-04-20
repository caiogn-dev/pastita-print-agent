const ESC = '\x1b';
const GS = '\x1d';
const WIDTH = 48; // chars por linha em fonte normal (80mm)

// Converte string para CP1252 (latin1) — resolve acentos portugueses
function enc(str = '') {
  return Buffer.from(String(str), 'latin1');
}

function cmd(...bytes) {
  return Buffer.from(bytes);
}

const INIT         = () => enc(`${ESC}@`);                     // reset
const CODEPAGE_CP1252 = () => cmd(0x1b, 0x74, 0x10);          // ESC t 16 = WPC1252
const ALIGN_CENTER = () => enc(`${ESC}a\x01`);
const ALIGN_LEFT   = () => enc(`${ESC}a\x00`);
const BOLD_ON      = () => enc(`${ESC}E\x01`);
const BOLD_OFF     = () => enc(`${ESC}E\x00`);
const DOUBLE_ON    = () => enc(`${GS}!\x11`);                  // altura+largura dobrada
const DOUBLE_HEIGHT_ON = () => enc(`${GS}!\x01`);             // só altura dobrada
const DOUBLE_OFF   = () => enc(`${GS}!\x00`);
const INVERT_ON    = () => cmd(0x1d, 0x42, 0x01);             // fundo preto, texto branco
const INVERT_OFF   = () => cmd(0x1d, 0x42, 0x00);
const LF           = () => enc('\n');
const CUT          = () => cmd(0x1d, 0x56, 0x00);             // corte total

function line(text = '') {
  return Buffer.concat([enc(text), LF()]);
}

function divider(char = '-') {
  return line(char.repeat(WIDTH));
}

function dashed() {
  return line('- '.repeat(WIDTH / 2));
}

// Texto centralizado numa largura de WIDTH
function centered(text) {
  const t = String(text);
  const pad = Math.max(0, Math.floor((WIDTH - t.length) / 2));
  return line(' '.repeat(pad) + t);
}

// Duas colunas: esquerda e direita
function twoCols(left, right, width = WIDTH) {
  const l = String(left || '');
  const r = String(right || '');
  const space = Math.max(1, width - l.length - r.length);
  return line(l + ' '.repeat(space) + r);
}

// Formata valor monetário
function money(value) {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value || 0);
  return `R$ ${n.toFixed(2).replace('.', ',')}`;
}

// Formata data ISO para pt-BR
function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  } catch {
    return String(iso || '');
  }
}

// Quebra texto longo em linhas de maxLen chars, com prefixo de indentação
function wordWrap(text, maxLen = WIDTH, indent = 0) {
  const words = String(text || '').split(' ');
  const lines = [];
  let current = ' '.repeat(indent);
  for (const word of words) {
    if (current.length + word.length + 1 > maxLen && current.trim()) {
      lines.push(current.trimEnd());
      current = ' '.repeat(indent) + word + ' ';
    } else {
      current += word + ' ';
    }
  }
  if (current.trim()) lines.push(current.trimEnd());
  return lines;
}

function renderItem(item) {
  const chunks = [];
  const qty = item.qty ?? item.quantity ?? 1;
  const name = item.name ?? item.product_name ?? '';
  const subtotal = item.subtotal ?? item.total_price ?? (qty * Number(item.unit_price || 0));
  const price = money(subtotal);
  const label = `${qty}x ${name}`;
  const maxNameLen = WIDTH - price.length - 1;

  // linha principal: qty x nome | preco
  if (label.length <= maxNameLen) {
    chunks.push(
      BOLD_ON(),
      twoCols(label, price),
      BOLD_OFF(),
    );
  } else {
    // nome longo: preco na primeira linha, nome quebra
    chunks.push(BOLD_ON(), twoCols(`${qty}x`, price), BOLD_OFF());
    for (const l of wordWrap(name, WIDTH, 3)) {
      chunks.push(line(`   ${l}`));
    }
  }

  // variante
  const variant = item.variant_name ?? item.variant ?? '';
  if (variant) chunks.push(line(`   > ${variant}`));

  // ingredientes / opções
  const ingredients = item.ingredients ?? item.options?.ingredients ?? [];
  for (const ing of ingredients) {
    const role = ing.role ? `${ing.role}: ` : '';
    const ingPrice = ing.price && ing.price > 0 ? ` (+${money(ing.price)})` : '';
    chunks.push(line(`   + ${role}${ing.name}${ingPrice}`));
  }

  // obs do item
  const notes = item.notes ?? '';
  if (notes) {
    chunks.push(
      BOLD_ON(),
      line(`   OBS: ${notes}`),
      BOLD_OFF(),
    );
  }

  return chunks;
}

function renderComboItem(combo) {
  const chunks = [];
  const qty = combo.quantity ?? 1;
  const name = combo.combo_name ?? combo.name ?? '';
  const price = money(combo.subtotal ?? 0);
  const label = `${qty}x ${name}`;

  chunks.push(BOLD_ON(), twoCols(label, price), BOLD_OFF());
  chunks.push(line('   [COMBO]'));

  const customizations = combo.customizations?.ingredients ?? combo.ingredients ?? [];
  for (const c of customizations) {
    const role = c.role ? `${c.role}: ` : '';
    const p = c.price && c.price > 0 ? ` (+${money(c.price)})` : '';
    chunks.push(line(`   + ${role}${c.name}${p}`));
  }

  if (combo.notes) {
    chunks.push(BOLD_ON(), line(`   OBS: ${combo.notes}`), BOLD_OFF());
  }

  return chunks;
}

export function buildKitchenTicket(payload) {
  const store    = payload.store    ?? {};
  const order    = payload.order    ?? {};
  const customer = payload.customer ?? {};
  const totals   = payload.totals   ?? {};
  const items    = payload.items    ?? [];
  const combos   = payload.combo_items ?? [];

  const isDelivery = (order.delivery_method ?? 'delivery') !== 'pickup';
  const deliveryLabel = isDelivery ? 'ENTREGA' : 'RETIRADA';

  const paymentLabels = {
    pix: 'PIX', credit_card: 'CREDITO', debit_card: 'DEBITO',
    cash: 'DINHEIRO', card: 'CARTAO', mercadopago: 'MERCADO PAGO',
  };
  const paymentStatusLabels = {
    pending: 'AGUARDANDO', paid: 'PAGO', failed: 'FALHOU', refunded: 'REEMBOLSADO',
  };

  const paymentMethod = paymentLabels[order.payment_method] ?? String(order.payment_method ?? '').toUpperCase();
  const paymentStatus = paymentStatusLabels[order.payment_status] ?? String(order.payment_status ?? '').toUpperCase();

  const chunks = [];

  // ── INIT + CODEPAGE ──────────────────────────────────────
  chunks.push(INIT(), CODEPAGE_CP1252());

  // ── HEADER: NOME DA LOJA ─────────────────────────────────
  chunks.push(
    ALIGN_CENTER(),
    DOUBLE_ON(), BOLD_ON(),
    enc(String(store.name ?? 'LOJA').toUpperCase()), LF(),
    BOLD_OFF(), DOUBLE_OFF(),
  );
  if (store.phone) chunks.push(centered(store.phone));
  if (store.address) chunks.push(centered(store.address));
  chunks.push(dashed());

  // ── NUMERO DO PEDIDO (invertido: fundo preto) ────────────
  const orderLine = `  PEDIDO #${order.order_number ?? ''}  `;
  const padOrder = ' '.repeat(Math.max(0, Math.floor((WIDTH - orderLine.length) / 2)));
  chunks.push(
    ALIGN_CENTER(),
    INVERT_ON(), BOLD_ON(), DOUBLE_HEIGHT_ON(),
    enc(padOrder + orderLine + padOrder), LF(),
    DOUBLE_OFF(), BOLD_OFF(), INVERT_OFF(),
  );

  if (order.created_at) chunks.push(centered(formatDate(order.created_at)));
  chunks.push(
    BOLD_ON(), centered(`[ ${deliveryLabel} ]`), BOLD_OFF(),
  );

  // Agendado
  const scheduledLabel = [order.scheduled_date, order.scheduled_time].filter(Boolean).join(' ');
  if (scheduledLabel) {
    chunks.push(BOLD_ON(), centered(`AGENDADO: ${scheduledLabel}`), BOLD_OFF());
  }

  chunks.push(dashed(), ALIGN_LEFT());

  // ── CLIENTE ───────────────────────────────────────────────
  chunks.push(BOLD_ON(), line('CLIENTE'), BOLD_OFF());
  chunks.push(line(String(customer.name ?? '')));
  if (customer.phone) chunks.push(line(customer.phone));

  // Endereço de entrega
  if (isDelivery && payload.address_lines?.length) {
    chunks.push(LF(), BOLD_ON(), line('ENDERECO DE ENTREGA:'), BOLD_OFF());
    for (const l of payload.address_lines) chunks.push(line(String(l)));
  } else if (!isDelivery) {
    chunks.push(LF(), line('** PEDIDO PARA RETIRADA **'));
  }

  chunks.push(dashed());

  // ── ATENCAO DA LOJA ───────────────────────────────────────
  const kitchenNotes = [order.internal_notes, order.delivery_instructions].filter(Boolean).join(' | ');
  if (kitchenNotes) {
    chunks.push(BOLD_ON(), INVERT_ON(), line(' !! ATENCAO DA LOJA !!  '), INVERT_OFF());
    for (const l of wordWrap(kitchenNotes)) chunks.push(BOLD_ON(), line(l), BOLD_OFF());
    chunks.push(dashed());
  }

  // ── OBSERVACOES DO CLIENTE ────────────────────────────────
  const customerNotes = order.customer_notes ?? order.observacoes ?? order.delivery_notes ?? '';
  if (customerNotes) {
    chunks.push(BOLD_ON(), line('OBSERVACOES:'), BOLD_OFF());
    for (const l of wordWrap(customerNotes)) chunks.push(line(l));
    chunks.push(dashed());
  }

  // ── ITENS ─────────────────────────────────────────────────
  chunks.push(BOLD_ON(), line('ITENS DO PEDIDO'), BOLD_OFF());
  chunks.push(divider());

  for (const item of items) {
    chunks.push(...renderItem(item));
    chunks.push(divider());
  }
  for (const combo of combos) {
    chunks.push(...renderComboItem(combo));
    chunks.push(divider());
  }

  // ── TOTAIS ────────────────────────────────────────────────
  const subtotal    = parseFloat(totals.subtotal    ?? order.subtotal    ?? 0);
  const deliveryFee = parseFloat(totals.delivery_fee ?? order.delivery_fee ?? 0);
  const discount    = parseFloat(totals.discount    ?? order.discount    ?? 0);
  const total       = parseFloat(totals.total       ?? order.total       ?? 0);

  chunks.push(twoCols('Subtotal:', money(subtotal)));
  if (deliveryFee > 0) chunks.push(twoCols('Taxa de Entrega:', money(deliveryFee)));
  if (discount    > 0) chunks.push(twoCols('Desconto:', `- ${money(discount)}`));
  chunks.push(divider('='));
  chunks.push(BOLD_ON(), twoCols('TOTAL:', money(total)), BOLD_OFF());
  chunks.push(divider('='));

  // ── PAGAMENTO ─────────────────────────────────────────────
  chunks.push(twoCols('Pagamento:', paymentMethod));
  chunks.push(twoCols('Status:', paymentStatus));
  chunks.push(dashed());

  // ── RODAPE ────────────────────────────────────────────────
  chunks.push(
    ALIGN_CENTER(),
    BOLD_ON(), line('Obrigado pela preferencia!'), BOLD_OFF(),
    line(`Impresso em ${formatDate(new Date().toISOString())}`),
    LF(), LF(), LF(),
  );

  chunks.push(CUT());

  return Buffer.concat(chunks.flat().map((c) => (Buffer.isBuffer(c) ? c : enc(c))));
}

export function buildTestTicket() {
  return buildKitchenTicket({
    store: { name: 'PASTITA PRINT AGENT', phone: '(11) 99999-9999' },
    order: {
      order_number: 'TESTE-001',
      created_at: new Date().toISOString(),
      delivery_method: 'pickup',
      payment_method: 'pix',
      payment_status: 'pending',
      customer_notes: 'Pedido de teste — acentos: acao coracao ventilaçao',
    },
    customer: { name: 'Cliente Teste', phone: '(11) 91234-5678' },
    address_lines: [],
    items: [
      {
        qty: 2,
        name: 'Pastita Tradicional',
        subtotal: '50.00',
        notes: 'Sem cebola, por favor',
      },
      {
        qty: 1,
        name: 'Suco de Laranja',
        subtotal: '10.00',
      },
    ],
    totals: {
      subtotal: '60.00',
      delivery_fee: '0.00',
      discount: '0.00',
      total: '60.00',
    },
  });
}

const ESC = '\x1b';
const GS = '\x1d';

function text(value = '') {
  return Buffer.from(String(value), 'utf8');
}

function center(value) {
  return Buffer.concat([text(`${ESC}a\x01`), text(value), text('\n')]);
}

function left(value) {
  return Buffer.concat([text(`${ESC}a\x00`), text(value), text('\n')]);
}

function bold(on = true) {
  return text(`${ESC}E${on ? '\x01' : '\x00'}`);
}

function doubleSize(on = true) {
  return text(`${GS}!${on ? '\x11' : '\x00'}`);
}

function divider() {
  return text('------------------------------------------------\n');
}

function twoCols(leftText, rightText, width = 48) {
  const leftValue = String(leftText || '');
  const rightValue = String(rightText || '');
  const space = Math.max(1, width - leftValue.length - rightValue.length);
  return `${leftValue}${' '.repeat(space)}${rightValue}`;
}

function linesFromItem(item) {
  const output = [];
  output.push(twoCols(`${item.qty}x ${item.name}`, `R$ ${item.subtotal}`));
  for (const detail of item.details || []) {
    output.push(`   - ${detail}`);
  }
  if (item.notes) {
    output.push(`   OBS: ${item.notes}`);
  }
  return output;
}

export function buildKitchenTicket(payload) {
  const chunks = [];
  const storeName = payload.store?.name || 'LOJA';
  const order = payload.order || {};
  const customer = payload.customer || {};
  const totals = payload.totals || {};

  chunks.push(text('\x1b@\n'));
  chunks.push(doubleSize(true), bold(true), center(storeName), bold(false), doubleSize(false));
  chunks.push(center(`PEDIDO #${order.order_number || ''}`));
  chunks.push(center((order.delivery_method || '').toUpperCase()));
  chunks.push(divider());

  chunks.push(left(`CLIENTE: ${customer.name || ''}`));
  chunks.push(left(`FONE: ${customer.phone || ''}`));
  if (payload.address_lines?.length) {
    chunks.push(left('ENTREGA:'));
    for (const line of payload.address_lines) {
      chunks.push(left(line));
    }
  }
  if (order.scheduled_for) {
    chunks.push(left(`AGENDADO: ${order.scheduled_for}`));
  }
  if (order.internal_notes) {
    chunks.push(divider());
    chunks.push(bold(true), left('ATENCAO DA LOJA:'), bold(false));
    chunks.push(left(order.internal_notes));
  }
  if (order.customer_notes) {
    chunks.push(divider());
    chunks.push(bold(true), left('OBSERVACOES:'), bold(false));
    chunks.push(left(order.customer_notes));
  }

  chunks.push(divider());
  for (const item of payload.items || []) {
    for (const line of linesFromItem(item)) {
      chunks.push(left(line));
    }
    chunks.push(divider());
  }

  chunks.push(left(twoCols('SUBTOTAL', `R$ ${totals.subtotal || '0.00'}`)));
  if (totals.delivery_fee && totals.delivery_fee !== '0.00') {
    chunks.push(left(twoCols('ENTREGA', `R$ ${totals.delivery_fee}`)));
  }
  if (totals.discount && totals.discount !== '0.00') {
    chunks.push(left(twoCols('DESCONTO', `R$ ${totals.discount}`)));
  }
  chunks.push(bold(true), left(twoCols('TOTAL', `R$ ${totals.total || '0.00'}`)), bold(false));
  chunks.push(left(`PAGAMENTO: ${(order.payment_method || '').toUpperCase()}`));
  chunks.push(left(`STATUS PGTO: ${(order.payment_status || '').toUpperCase()}`));
  chunks.push(text('\n\n\n'));
  chunks.push(text(`${GS}V\x00`));
  return Buffer.concat(chunks);
}

export function buildTestTicket() {
  return buildKitchenTicket({
    store: { name: 'PASTITA PRINT AGENT' },
    order: {
      order_number: 'TESTE-001',
      delivery_method: 'pickup',
      payment_method: 'pix',
      payment_status: 'pending',
      customer_notes: 'Teste local da Epson TM-T20',
    },
    customer: { name: 'Teste', phone: '000000000' },
    address_lines: ['PEDIDO PARA RETIRADA'],
    items: [
      {
        qty: 1,
        name: 'COMANDA DE TESTE',
        subtotal: '0.00',
        details: ['ESC/POS RAW', 'Windows printer'],
        notes: 'Se imprimiu certo, o agent esta pronto.',
      },
    ],
    totals: {
      subtotal: '0.00',
      delivery_fee: '0.00',
      discount: '0.00',
      total: '0.00',
    },
  });
}

/**
 * Etiqueta ZPL: o backend já monta o rótulo inteiro (`payload.zpl`); aqui só
 * viram bytes UTF-8 (o rótulo abre com ^CI28) e vão RAW para a Zebra. Nada de
 * ESC/POS: mandar isto para a Epson imprime lixo, e mandar ESC/POS para a
 * Zebra não imprime nada — por isso o job nasce apontado para um agent.
 */
export function buildZplLabel(payload) {
  const zpl = payload?.zpl;
  if (typeof zpl !== 'string' || !zpl.includes('^XA')) {
    throw new Error('Job etiqueta_zpl sem ZPL no payload');
  }
  return Buffer.from(zpl, 'utf8');
}

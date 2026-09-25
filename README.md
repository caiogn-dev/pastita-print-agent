# Pastita Print Agent

Agente local para impressão automática de pedidos vindos do backend `backend.pastita.com.br`.

Pensado para Windows + Epson TM-T20 USB instalada no sistema operacional.

## Como funciona

1. O backend cria um `print_job` quando entra pedido novo.
2. O agent faz polling no backend.
3. Ao receber um job, ele monta a comanda em ESC/POS.
4. Envia o RAW para a impressora Windows configurada.
5. Marca o job como `completed` ou `failed`.

## Requisitos

- Windows com a Epson TM-T20 instalada
- Node.js 20+
- Uma chave de agente criada no backend

## Configuração

Crie `config/agent.json`:

```json
{
  "backendUrl": "https://backend.pastita.com.br",
  "agentKey": "pa_xxxxx.yyyyy",
  "printerName": "EPSON TM-T20 Receipt",
  "pollIntervalMs": 2000,
  "heartbeatIntervalMs": 30000,
  "stateFile": "./data/agent-state.json",
  "logLevel": "info"
}
```

## Comandos

Listar impressoras:

```bash
npm run list-printers
```

Rodar agent:

```bash
npm start
```

Impressão de teste local:

```bash
npm run test-print
```

## Etiquetas ZPL (Zebra)

Além das comandas ESC/POS, o agent imprime jobs `etiqueta_zpl`: o painel (Etiquetas →
"Enviar para a Zebra") manda os dados, o backend monta o ZPL e o job nasce apontado
para o agent cuja impressora do painel é a Zebra (`ZDesigner ...`). O agent só repassa
os bytes UTF-8 — nada de ESC/POS numa Zebra nem ZPL numa Epson.

Se o log mostrar `HTTP 401` com o prefixo da chave (`pa_xxxx`), é aquela chave que está
errada ou foi trocada no painel: cole a nova em `config/agent.json` e reinicie o serviço.

`npm test` roda os testes (`node --test`).

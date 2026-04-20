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

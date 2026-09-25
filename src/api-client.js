export class PrintApiClient {
  constructor({ backendUrl, agentKey }) {
    this.backendUrl = backendUrl;
    this.agentKey = agentKey;
    // Só o prefixo aparece em log — é o que o painel mostra; o segredo nunca.
    this.keyPrefix = String(agentKey || '').split('.')[0] || '(vazia)';
  }

  async heartbeat(payload = {}) {
    return this.#post('/api/v1/stores/print/agent/heartbeat/', payload);
  }

  async claimNext(payload = {}) {
    return this.#post('/api/v1/stores/print/agent/claim-next/', payload);
  }

  async completeJob(jobId, payload = {}) {
    return this.#post(`/api/v1/stores/print/jobs/${jobId}/complete/`, payload);
  }

  async failJob(jobId, payload = {}) {
    return this.#post(`/api/v1/stores/print/jobs/${jobId}/fail/`, payload);
  }

  watchJobs(onJob, onError, onClose) {
    const url = new URL(`${this.backendUrl}/api/v1/stores/print/agent/watch/`);
    const eventSource = new EventSource(url, {
      headers: {
        'X-Print-Agent-Key': this.agentKey,
      },
    });

    eventSource.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'job' && data.data) {
          onJob(data.data);
        }
      } catch (e) {
        onError?.(new Error(`Failed to parse SSE message: ${e.message}`));
      }
    });

    eventSource.addEventListener('error', (event) => {
      if (event.type === 'error') {
        onError?.(new Error('SSE connection error'));
      }
      eventSource.close();
      onClose?.();
    });

    return () => eventSource.close();
  }

  async #post(path, payload) {
    const response = await fetch(`${this.backendUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Print-Agent-Key': this.agentKey,
      },
      body: JSON.stringify(payload),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = body.detail || body.error || body;
      const message = typeof detail === 'string' ? detail : JSON.stringify(detail);
      throw new Error(`HTTP ${response.status}: ${message}`);
    }
    return body;
  }
}

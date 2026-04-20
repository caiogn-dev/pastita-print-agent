export class PrintApiClient {
  constructor({ backendUrl, agentKey }) {
    this.backendUrl = backendUrl;
    this.agentKey = agentKey;
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

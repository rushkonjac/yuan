/**
 * @fileoverview WebSocket client wrapper for 渊 online.
 */

export class Network {
  constructor() {
    /** @type {WebSocket|null} */
    this.ws = null;
    /** @type {Map<string, Function[]>} */
    this.listeners = new Map();
  }

  connect(url) {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this._emit('connected');
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.event) {
          this._emit(msg.event, msg);
        }
      } catch { /* ignore */ }
    };

    this.ws.onclose = () => {
      this._emit('disconnected');
    };

    this.ws.onerror = () => {};
  }

  disconnect() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  /** @param {string} action @param {object} data */
  send(action, data = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action, ...data }));
    }
  }

  /** @param {string} event @param {Function} fn */
  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }

  _emit(event, data) {
    const fns = this.listeners.get(event);
    if (fns) fns.forEach(fn => fn(data));
  }
}

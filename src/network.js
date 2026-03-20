/**
 * @fileoverview WebSocket client wrapper for 渊 online.
 */

export class Network {
  constructor() {
    /** @type {WebSocket|null} */
    this.ws = null;
    this.url = '';
    /** @type {Map<string, Function[]>} */
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    /** @type {string|null} */
    this.roomCode = null;
    /** @type {number|null} */
    this.player = null;
    this._shouldReconnect = false;
  }

  connect(url) {
    this.url = url;
    this._shouldReconnect = true;
    this._doConnect();
  }

  _doConnect() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this._emit('connected');

      if (this.roomCode && this.player) {
        this.send('reconnect', { code: this.roomCode, player: this.player });
      }
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
      if (this._shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
        setTimeout(() => this._doConnect(), delay);
      }
    };

    this.ws.onerror = () => {};
  }

  disconnect() {
    this._shouldReconnect = false;
    if (this.ws) {
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

  /** @param {string} event @param {Function} fn */
  off(event, fn) {
    const fns = this.listeners.get(event);
    if (fns) {
      const idx = fns.indexOf(fn);
      if (idx >= 0) fns.splice(idx, 1);
    }
  }

  _emit(event, data) {
    const fns = this.listeners.get(event);
    if (fns) fns.forEach(fn => fn(data));
  }
}

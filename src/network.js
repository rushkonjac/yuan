/**
 * @fileoverview WebSocket client wrapper for 渊 online.
 */

export class Network {
  constructor() {
    /** @type {WebSocket|null} */
    this.ws = null;
    /** @type {Map<string, Function[]>} */
    this.listeners = new Map();
    /** 每次 connect 递增，忽略上一次连接晚到的 onopen/onclose */
    this._connectGen = 0;
  }

  connect(url) {
    this._connectGen += 1;
    const gen = this._connectGen;

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
    }

    const socket = new WebSocket(url);
    this.ws = socket;

    socket.onopen = () => {
      if (gen !== this._connectGen || this.ws !== socket) return;
      this._emit('connected');
    };

    socket.onmessage = (e) => {
      if (this.ws !== socket) return;
      try {
        const msg = JSON.parse(e.data);
        if (msg.event) {
          this._emit(msg.event, msg);
        }
      } catch { /* ignore */ }
    };

    socket.onclose = () => {
      if (gen !== this._connectGen) return;
      this._emit('disconnected');
    };

    socket.onerror = () => {
      /* 具体原因在 onclose；部分浏览器首连仅触发 error 不立刻 close */
    };
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

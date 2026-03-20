/**
 * @fileoverview 渊 game server — Express static files + WebSocket game rooms.
 */

import { createServer } from 'http';
import express from 'express';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { RoomManager } from './room.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(join(__dirname, '..')));

app.get('/health', (_req, res) => res.json({ status: 'ok', rooms: rooms.rooms.size }));

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });
const rooms = new RoomManager();

setInterval(() => rooms.cleanup(), 60000);

server.on('upgrade', (request, socket, head) => {
  console.log('Upgrade request received');
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  ws._player = null;
  ws._room = null;
  ws._roomCode = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.action === 'create') {
      const room = rooms.createRoom();
      const player = room.addPlayer(ws);
      ws._roomCode = room.code;
      ws.send(JSON.stringify({ event: 'roomCreated', code: room.code, player }));
      console.log(`Room ${room.code} created`);
      return;
    }

    if (msg.action === 'join') {
      const code = msg.code?.toUpperCase();
      const room = rooms.getRoom(code);
      if (!room) {
        ws.send(JSON.stringify({ event: 'error', message: '房间不存在' }));
        return;
      }
      if (room.players.size >= 2) {
        ws.send(JSON.stringify({ event: 'error', message: '房间已满' }));
        return;
      }
      const player = room.addPlayer(ws);
      ws._roomCode = room.code;
      ws.send(JSON.stringify({ event: 'roomJoined', code: room.code, player }));
      console.log(`Player ${player} joined room ${room.code}`);
      return;
    }

    if (msg.action === 'reconnect') {
      const code = msg.code?.toUpperCase();
      const room = rooms.getRoom(code);
      if (!room) {
        ws.send(JSON.stringify({ event: 'error', message: '房间不存在' }));
        return;
      }
      const player = msg.player;
      if (player !== 1 && player !== 2) return;
      room.handleReconnect(player, ws);
      ws._roomCode = room.code;
      console.log(`Player ${player} reconnected to room ${room.code}`);
      return;
    }

    if (ws._room && ws._player) {
      ws._room.handleAction(ws._player, msg);
    }
  });

  ws.on('close', () => {
    if (ws._room && ws._player) {
      ws._room.handleDisconnect(ws._player);
      console.log(`Player ${ws._player} disconnected from room ${ws._roomCode}`);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

wss.on('error', (err) => {
  console.error('WSS error:', err.message);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`渊 server running on port ${PORT}`);
});

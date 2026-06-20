/**
 * Tic-Tac-Toe WebSocket Relay Server
 * Hosts rooms with 6-digit codes for P2P multiplayer.
 * Also serves static HTML/CSS/JS files.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;

/* ─── Room Management ─── */
const rooms = new Map();

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function createRoom() {
  let code;
  do {
    code = generateRoomCode();
  } while (rooms.has(code));
  return code;
}

function removeRoom(code) {
  rooms.delete(code);
}

function broadcastToRoom(roomCode, message, excludeSocket) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const msg = JSON.stringify(message);
  if (room.host && room.host !== excludeSocket && room.host.readyState === 1) {
    room.host.send(msg);
  }
  if (room.guest && room.guest !== excludeSocket && room.guest.readyState === 1) {
    room.guest.send(msg);
  }
}

function sendTo(socket, message) {
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}

/* ─── Static file serving ─── */
const STATIC_DIR = __dirname;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
};

function serveStatic(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server error');
      }
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

/* ─── HTTP Server ─── */
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', rooms: rooms.size }));
    return;
  }

  let filePath;
  if (req.url === '/' || req.url === '/index.html') {
    filePath = path.join(STATIC_DIR, 'index.html');
  } else {
    filePath = path.join(STATIC_DIR, req.url);
  }

  // Prevent directory traversal
  const resolved = path.resolve(filePath);
  const root = path.resolve(STATIC_DIR);
  if (!resolved.startsWith(root)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  serveStatic(req, res, resolved);
});

/* ─── WebSocket Server ─── */
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('[ws] client connected');
  ws.roomCode = null;
  ws.role = null;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      sendTo(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    switch (msg.type) {
      case 'host': {
        const code = createRoom();
        rooms.set(code, { code, host: ws, guest: null });
        ws.roomCode = code;
        ws.role = 'host';
        sendTo(ws, { type: 'hosted', roomCode: code, yourSymbol: 'X' });
        console.log(`[ws] room created: ${code}`);
        break;
      }

      case 'join': {
        const code = String(msg.roomCode || '').trim();
        if (!/^[0-9]{6}$/.test(code)) {
          sendTo(ws, { type: 'error', message: 'Invalid room code. Must be 6 digits.' });
          return;
        }
        const room = rooms.get(code);
        if (!room) {
          sendTo(ws, { type: 'error', message: 'Room not found.' });
          return;
        }
        if (room.guest) {
          sendTo(ws, { type: 'error', message: 'Room is full.' });
          return;
        }
        room.guest = ws;
        ws.roomCode = code;
        ws.role = 'guest';
        sendTo(ws, { type: 'joined', roomCode: code, yourSymbol: 'O', hostSymbol: 'X' });
        sendTo(room.host, { type: 'playerJoined', guestSymbol: 'O' });
        console.log(`[ws] guest joined room: ${code}`);
        break;
      }

      case 'move': {
        if (!ws.roomCode) return;
        broadcastToRoom(ws.roomCode, {
          type: 'opponentMove',
          index: msg.index,
          player: msg.player,
        }, ws);
        break;
      }

      case 'restart': {
        if (!ws.roomCode) return;
        broadcastToRoom(ws.roomCode, { type: 'opponentRestart', from: ws.role }, ws);
        break;
      }

      case 'newgame': {
        if (!ws.roomCode) return;
        broadcastToRoom(ws.roomCode, { type: 'opponentNewGame', from: ws.role }, ws);
        break;
      }

      case 'chat': {
        if (!ws.roomCode) return;
        broadcastToRoom(ws.roomCode, {
          type: 'chat',
          from: ws.role,
          text: String(msg.text || '').slice(0, 120),
        }, ws);
        break;
      }

      default:
        sendTo(ws, { type: 'error', message: 'Unknown message type: ' + msg.type });
    }
  });

  ws.on('close', () => {
    if (!ws.roomCode) return;
    const room = rooms.get(ws.roomCode);
    if (!room) return;

    if (ws.role === 'host') {
      if (room.guest) {
        sendTo(room.guest, { type: 'opponentDisconnected' });
      }
      removeRoom(ws.roomCode);
      console.log(`[ws] host left; room closed: ${ws.roomCode}`);
    } else if (ws.role === 'guest') {
      room.guest = null;
      sendTo(room.host, { type: 'opponentDisconnected' });
      console.log(`[ws] guest left; room ${ws.roomCode} waiting`);
    }
  });

  ws.on('error', (err) => {
    console.error('[ws] error:', err.message);
  });
});

server.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
  console.log(`[server] game url: http://localhost:${PORT}`);
  console.log(`[server] ws endpoint: ws://localhost:${PORT}`);
});

/* ─── Graceful shutdown ─── */
process.on('SIGINT', () => {
  console.log('\n[server] shutting down...');
  for (const [code, room] of rooms) {
    if (room.host) room.host.close();
    if (room.guest) room.guest.close();
  }
  wss.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
});

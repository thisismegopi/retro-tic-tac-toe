/**
 * Retro Tic-Tac-Toe — Game Logic (Local + Network PvP)
 * One player hosts, another joins via 6-digit room code.
 */

/* ═══════════════════════ */
/*    NETWORK STATE        */
/* ═══════════════════════ */

let ws = null;
let netGame = null;  // { mode:'local'|'host'|'guest', roomCode, mySymbol, opponentConnected }

function ensureNetGame() {
  if (!netGame) {
    netGame = { mode: 'local', roomCode: null, mySymbol: null, opponentConnected: false };
  }
}

const WS_URL = (() => {
  const u = new URL(window.location.href);
  const protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${u.host}`;
})();

/* ═══════════════════════ */
/*    AUDIO SYSTEM         */
/* ═══════════════════════ */

const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new AudioCtx();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playTone(freq, type = 'square', duration = 0.15, vol = 0.08) {
  ensureAudio();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  gain.gain.setValueAtTime(vol, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function soundClick(player) {
  if (player === 'X') {
    playTone(440, 'square', 0.12, 0.08);
    setTimeout(() => playTone(554, 'square', 0.12, 0.06), 60);
  } else {
    playTone(330, 'square', 0.12, 0.08);
    setTimeout(() => playTone(440, 'square', 0.12, 0.06), 60);
  }
}

function soundWin() {
  const notes = [523, 659, 784, 1047];
  notes.forEach((n, i) => playTone(n, 'square', 0.25, 0.1));
  setTimeout(() => playTone(1047, 'square', 0.5, 0.1), 320);
}

function soundDraw() {
  playTone(200, 'sawtooth', 0.3, 0.06);
  setTimeout(() => playTone(180, 'sawtooth', 0.3, 0.06), 120);
  setTimeout(() => playTone(160, 'sawtooth', 0.4, 0.06), 240);
}

function soundConnect() {
  playTone(523, 'square', 0.1, 0.06);
  setTimeout(() => playTone(659, 'square', 0.1, 0.06), 80);
  setTimeout(() => playTone(784, 'square', 0.15, 0.06), 160);
}

function soundError() {
  playTone(150, 'sawtooth', 0.3, 0.07);
  setTimeout(() => playTone(130, 'sawtooth', 0.3, 0.07), 150);
}

/* ═══════════════════════ */
/*    PARTICLES            */
/* ═══════════════════════ */

function createParticles(x, y, color) {
  const count = 24;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle square';
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.backgroundColor = color;
    p.style.width = `${Math.random() * 5 + 3}px`;
    p.style.height = p.style.width;

    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 120 + 60;
    const tx = Math.cos(angle) * speed;
    const ty = Math.sin(angle) * speed;

    p.style.transition = 'all 0.7s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    document.body.appendChild(p);

    requestAnimationFrame(() => {
      p.style.transform = `translate(${tx}px, ${ty}px) rotate(${Math.random() * 720}deg)`;
      p.style.opacity = '0';
    });

    setTimeout(() => p.remove(), 750);
  }
}

function burstOnWin(cells, winner) {
  cells.forEach((idx, i) => {
    const cell = document.querySelector(`.cell[data-index="${idx}"]`);
    if (cell) {
      const rect = cell.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const color = winner === 'X' ? '#e94560' : '#00d9ff';
      setTimeout(() => createParticles(cx, cy, color), i * 80);
    }
  });
}

/* ═══════════════════════ */
/*    GAME STATE           */
/* ═══════════════════════ */

const state = {
  board: Array(9).fill(null),
  currentPlayer: 'X',
  gameActive: true,
  scores: { X: 0, O: 0 },
};

const WINNING_COMBOS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

/* ═══════════════════════ */
/*    DOM REFS             */
/* ═══════════════════════ */

const boardEl = document.getElementById('board');
const messageEl = document.getElementById('message');
const turnEl = document.getElementById('turnIndicator');
const scoreXEl = document.getElementById('scoreX');
const scoreOEl = document.getElementById('scoreO');
const restartBtn = document.getElementById('restartBtn');
const newGameBtn = document.getElementById('newGameBtn');
const cells = document.querySelectorAll('.cell');
const badgeEl = document.getElementById('connectionBadge');
const lobbyOverlay = document.getElementById('lobbyOverlay');
const lobbyMenu = document.getElementById('lobbyMenu');
const hostPanel = document.getElementById('hostPanel');
const joinPanel = document.getElementById('joinPanel');
const hostRoomCode = document.getElementById('hostRoomCode');
const hostStatus = document.getElementById('hostStatus');
const joinInput = document.getElementById('joinInput');
const joinError = document.getElementById('joinError');

/* ═══════════════════════ */
/*    UI HELPERS           */
/* ═══════════════════════ */

function updateTurn() {
  turnEl.textContent = state.currentPlayer === 'X' ? "X's Turn" : "O's Turn";
  turnEl.style.color = state.currentPlayer === 'X' ? '#e94560' : '#00d9ff';
  turnEl.style.textShadow = `0 0 8px ${state.currentPlayer === 'X' ? '#e94560' : '#00d9ff'}`;
}

function updateScores() {
  scoreXEl.textContent = `X: ${state.scores.X}`;
  scoreOEl.textContent = `O: ${state.scores.O}`;
}

function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = 'message show';
  if (type) messageEl.classList.add(type);
}

function clearMessage() {
  messageEl.textContent = '';
  messageEl.className = 'message';
}

function setBadge(text, cls) {
  badgeEl.textContent = text;
  badgeEl.className = 'connection-badge' + (cls ? ' ' + cls : '');
}

function hideLobby() {
  lobbyOverlay.classList.add('hidden');
  lobbyMenu.classList.add('hidden');
  hostPanel.classList.add('hidden');
  joinPanel.classList.add('hidden');
}

const introOverlay = document.getElementById('introOverlay');

function showIntro() {
  introOverlay.classList.remove('hidden');
}

function hideIntro() {
  introOverlay.classList.add('hidden');
}

function showLobbyMenu() {
  lobbyOverlay.classList.remove('hidden');
  lobbyMenu.classList.remove('hidden');
  hostPanel.classList.add('hidden');
  joinPanel.classList.add('hidden');
}

function showHostPanel() {
  lobbyOverlay.classList.remove('hidden');
  lobbyMenu.classList.add('hidden');
  hostPanel.classList.remove('hidden');
  joinPanel.classList.add('hidden');
}

function showJoinPanel() {
  lobbyOverlay.classList.remove('hidden');
  lobbyMenu.classList.add('hidden');
  hostPanel.classList.add('hidden');
  joinPanel.classList.remove('hidden');
  joinInput.value = '';
  joinError.textContent = '';
  setTimeout(() => joinInput.focus(), 100);
}

/* ═══════════════════════ */
/*    GAME LOGIC           */
/* ═══════════════════════ */

function checkWin() {
  for (const combo of WINNING_COMBOS) {
    const [a, b, c] = combo;
    if (state.board[a] && state.board[a] === state.board[b] && state.board[a] === state.board[c]) {
      return combo;
    }
  }
  return null;
}

function isDraw() {
  return state.board.every(cell => cell !== null);
}

function placeMarkVisual(index, player) {
  const cell = document.querySelector(`.cell[data-index="${index}"]`);
  if (!cell) return;
  cell.textContent = player;
  cell.classList.add(player === 'X' ? 'x-mark' : 'o-mark', 'pop', 'taken');
  cell.setAttribute('aria-label', `${player} at cell ${index + 1}`);
  setTimeout(() => cell.classList.remove('pop'), 350);
}

function endGame(winner, winningCombo) {
  state.gameActive = false;

  if (winner === 'draw') {
    showMessage("It's a Draw!", 'draw');
    soundDraw();
    boardEl.classList.add('shake');
    setTimeout(() => boardEl.classList.remove('shake'), 500);
    return;
  }

  state.scores[winner]++;
  updateScores();

  winningCombo.forEach(idx => {
    document.querySelector(`.cell[data-index="${idx}"]`).classList.add('winning');
  });

  scoreXEl.className = 'score' + (winner === 'X' ? ' x-winner' : '');
  scoreOEl.className = 'score' + (winner === 'X' ? '' : ' o-winner');

  showMessage(`Player ${winner} Wins!`, 'win');
  soundWin();
  burstOnWin(winningCombo, winner);

  setTimeout(() => {
    scoreXEl.className = 'score';
    scoreOEl.className = 'score';
  }, 1500);
}

function handleCellClick(e) {
  const cell = e.target.closest('.cell');
  if (!cell) return;

  const index = +cell.dataset.index;
  if (!state.gameActive || state.board[index] !== null || cell.classList.contains('taken')) {
    return;
  }

  ensureAudio();

  // In network mode, only allow clicking when it's my turn and I'm the current player
  if (netGame.mode !== 'local') {
    if (!netGame.opponentConnected) {
      showMessage('Waiting for opponent...');
      setTimeout(clearMessage, 1500);
      return;
    }
    if (state.currentPlayer !== netGame.mySymbol) {
      showMessage('Not your turn!');
      setTimeout(clearMessage, 1500);
      return;
    }
  }

  // Place mark locally
  state.board[index] = state.currentPlayer;
  placeMarkVisual(index, state.currentPlayer);
  soundClick(state.currentPlayer);

  // In network mode, send to server
  if (netGame.mode !== 'local') {
    send({ type: 'move', index, player: state.currentPlayer });
  }

  const winningCombo = checkWin();
  if (winningCombo) {
    endGame(state.currentPlayer, winningCombo);
    return;
  }

  if (isDraw()) {
    endGame('draw');
    return;
  }

  // Switch turn
  state.currentPlayer = state.currentPlayer === 'X' ? 'O' : 'X';
  updateTurn();
}

function resetBoard(keepScores = false) {
  state.board.fill(null);
  state.currentPlayer = 'X';
  state.gameActive = true;

  cells.forEach(cell => {
    cell.textContent = '';
    cell.className = 'cell';
    cell.removeAttribute('aria-label');
  });

  boardEl.classList.remove('shake');
  clearMessage();
  updateTurn();

  if (!keepScores) {
    state.scores.X = 0;
    state.scores.O = 0;
    updateScores();
  }
}

/* ═══════════════════════ */
/*    WEBSOCKET CLIENT     */
/* ═══════════════════════ */

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function connectWebSocket() {
  if (ws) {
    try { ws.close(); } catch {}
  }

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('[ws] connected');
    setBadge('Connected', 'connected');
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    handleWsMessage(msg);
  };

  ws.onclose = () => {
    console.log('[ws] disconnected');
    setBadge('Disconnected', 'disconnected');
    setChatVisible(false);
    ws = null;
  };

  ws.onerror = (err) => {
    console.error('[ws] error', err);
    setBadge('Connection Error', 'disconnected');
  };
}

function handleWsMessage(msg) {
  try {
  switch (msg.type) {
    case 'hosted': {
      netGame.roomCode = msg.roomCode;
      netGame.mySymbol = msg.yourSymbol;
      hostRoomCode.textContent = msg.roomCode;
      hostStatus.innerHTML = `Waiting for opponent...<br><span style="font-size:0.6em;color:#7ca3ff">Share code: ${msg.roomCode}</span>`;
      setBadge('Hosting – Waiting', 'waiting');
      break;
    }

    case 'joined': {
      netGame.roomCode = msg.roomCode;
      netGame.mySymbol = msg.yourSymbol;
      netGame.opponentConnected = true;
      hideLobby();
      resetBoard(false);
      updateTurn();
      setBadge('Guest – ' + netGame.mySymbol, 'connected');
      setChatVisible(true);
      chatMessages.innerHTML = '';
      appendChat('Game started! You are O.', 'system');
      try { soundConnect(); } catch (e) { console.warn('[audio]', e); }
      showMessage('Game Started!');
      setTimeout(clearMessage, 2000);
      break;
    }

    case 'playerJoined': {
      netGame.opponentConnected = true;
      hideLobby();
      resetBoard(false);
      updateTurn();
      setBadge('Host – X', 'connected');
      setChatVisible(true);
      chatMessages.innerHTML = '';
      appendChat('Game started! You are X.', 'system');
      try { soundConnect(); } catch (e) { console.warn('[audio]', e); }
      showMessage('Game Started!');
      setTimeout(clearMessage, 2000);
      break;
    }

    case 'opponentMove': {
      // Opponent placed a mark — update local state and visuals
      if (state.board[msg.index] !== null) return; // safety
      state.board[msg.index] = msg.player;
      placeMarkVisual(msg.index, msg.player);
      soundClick(msg.player);

      const combo = checkWin();
      if (combo) {
        endGame(msg.player, combo);
        return;
      }
      if (isDraw()) {
        endGame('draw');
        return;
      }
      state.currentPlayer = state.currentPlayer === 'X' ? 'O' : 'X';
      updateTurn();
      break;
    }

    case 'opponentRestart': {
      resetBoard(true);
      showMessage('Opponent restarted the round!');
      setTimeout(clearMessage, 2000);
      break;
    }

    case 'opponentNewGame': {
      resetBoard(false);
      showMessage('Opponent started a new game!');
      setTimeout(clearMessage, 2000);
      break;
    }

    case 'opponentDisconnected': {
      netGame.opponentConnected = false;
      setChatVisible(false);
      showMessage('Opponent disconnected!');
      setBadge(netGame.mode === 'host' ? 'Hosting – Waiting' : 'Guest – Waiting', 'waiting');
      soundError();
      break;
    }

    case 'chat': {
      handleChatEvent(msg);
      break;
    }

    case 'error': {
      console.error('[ws] server error:', msg.message);
      if (netGame.mode === 'guest' && joinPanel && !joinPanel.classList.contains('hidden')) {
        joinError.textContent = msg.message;
        soundError();
      } else {
        showMessage(msg.message);
        setTimeout(clearMessage, 3000);
      }
      break;
    }

    default:
      console.log('[ws] unknown message:', msg);
  }
  } catch (err) {
    console.error('[ws] handleWsMessage error:', err);
  }
}

/* ═══════════════════════ */
/*    LOBBY HANDLERS       */
/* ═══════════════════════ */

document.getElementById('btnLocal').addEventListener('click', () => {
  netGame = { mode: 'local', roomCode: null, mySymbol: null, opponentConnected: false };
  setChatVisible(false);
  chatMessages.innerHTML = '';
  hideLobby();
  setBadge('Local', '');
  resetBoard(false);
});

document.getElementById('btnStart').addEventListener('click', () => {
  ensureAudio();
  hideIntro();
  showLobbyMenu();
});

document.getElementById('btnHostHost').addEventListener('click', () => {
  ensureAudio();
  netGame = { mode: 'host', roomCode: null, mySymbol: null, opponentConnected: false };
  connectWebSocket();
  setTimeout(() => {
    send({ type: 'host' });
  }, 150);
  showHostPanel();
  hostRoomCode.textContent = '------';
  hostStatus.textContent = 'Creating room...';
});

document.getElementById('btnJoinShow').addEventListener('click', () => {
  netGame = { mode: 'guest', roomCode: null, mySymbol: null, opponentConnected: false };
  connectWebSocket();
  showJoinPanel();
});

document.getElementById('btnHostCancel').addEventListener('click', () => {
  if (ws) { ws.close(); ws = null; }
  setChatVisible(false);
  chatMessages.innerHTML = '';
  showLobbyMenu();
  setBadge('Local', '');
});

document.getElementById('btnJoinBack').addEventListener('click', () => {
  if (ws) { ws.close(); ws = null; }
  setChatVisible(false);
  chatMessages.innerHTML = '';
  showLobbyMenu();
  setBadge('Local', '');
});

document.getElementById('btnJoinGo').addEventListener('click', () => {
  const code = joinInput.value.trim();
  if (!/^[0-9]{6}$/.test(code)) {
    joinError.textContent = 'Enter a valid 6-digit code.';
    soundError();
    return;
  }
  joinError.textContent = '';
  send({ type: 'join', roomCode: code });
});

// Allow Enter key to join
joinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('btnJoinGo').click();
  }
});

/* ═══════════════════════ */
/*    GAME CONTROLS        */
/* ═══════════════════════ */

boardEl.addEventListener('click', handleCellClick);

restartBtn.addEventListener('click', () => {
  ensureAudio();
  playTone(330, 'square', 0.1, 0.05);
  resetBoard(true);
  if (netGame.mode !== 'local') {
    send({ type: 'restart' });
  }
});

newGameBtn.addEventListener('click', () => {
  ensureAudio();
  playTone(330, 'square', 0.1, 0.05);
  resetBoard(false);
  if (netGame.mode !== 'local') {
    send({ type: 'newgame' });
  }
});

/* ═══════════════════════ */
/*    CHAT SYSTEM          */
/* ═══════════════════════ */

const chatPanel = document.getElementById('chatPanel');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatToggleBtn = document.getElementById('chatToggleBtn');
const chatCloseBtn = document.getElementById('chatCloseBtn');
const chatSendBtn = document.getElementById('chatSendBtn');

function setChatVisible(visible) {
  chatToggleBtn.style.display = visible ? 'inline-block' : 'none';
  if (!visible) closeChat();
}

setChatVisible(false);

function openChat() {
  chatPanel.classList.remove('hidden');
  chatInput.focus();
}

function closeChat() {
  chatPanel.classList.add('hidden');
}

function appendChat(msg, cls = '') {
  const div = document.createElement('div');
  div.className = 'chat-msg ' + cls;
  div.innerHTML = msg;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  if (netGame.mode === 'local') {
    appendChat('<span class="chat-author">ME:</span>' + text, 'host');
  } else {
    send({ type: 'chat', text });
    const label = netGame.mySymbol === 'X' ? 'X' : 'O';
    appendChat('<span class="chat-author">' + label + ':</span>' + text, netGame.mode);
  }
  chatInput.value = '';
}

function handleChatEvent(msg) {
  const cls = msg.from === 'host' ? 'host' : 'guest';
  const label = msg.from === 'host' ? 'X' : 'O';
  appendChat('<span class="chat-author">' + label + ':</span>' + msg.text, cls);
  playTone(600, 'square', 0.08, 0.04);
  // Briefly reopen or flash chat if closed
  if (chatPanel.classList.contains('hidden')) {
    chatToggleBtn.style.borderColor = '#ffd700';
    chatToggleBtn.style.boxShadow = '0 0 15px rgba(255, 215, 0, 0.4)';
    setTimeout(() => {
      chatToggleBtn.style.borderColor = '';
      chatToggleBtn.style.boxShadow = '';
    }, 1200);
  }
}

// Only show chat button outside local game when connected
chatToggleBtn.style.display = 'none';

chatToggleBtn.addEventListener('click', openChat);
chatCloseBtn.addEventListener('click', closeChat);
chatSendBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
  if (e.key === 'Escape') closeChat();
});

// Global Escape closes chat if open
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!chatPanel.classList.contains('hidden')) {
      e.stopPropagation();
      closeChat();
    }
  }
});

/* ═══════════════════════ */
/*    RETURN TO LOBBY      */
/* ═══════════════════════ */

// Press Escape to return to lobby (or L)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !lobbyOverlay.classList.contains('hidden')) {
    return;
  }
  if (!chatPanel.classList.contains('hidden')) return;
  if (e.key === 'l' || e.key === 'L') {
    if (lobbyOverlay.classList.contains('hidden')) {
      if (ws) { ws.close(); ws = null; }
      showLobbyMenu();
      resetBoard(false);
    }
  }
});

/* ═══════════════════════ */
/*    INIT                 */
/* ═══════════════════════ */

ensureNetGame();
showIntro();
updateTurn();

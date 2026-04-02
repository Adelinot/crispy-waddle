const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const COLORS = ['red', 'yellow', 'green', 'blue'];
const COLOR_HEX = { red: '#e74c3c', yellow: '#f1c40f', green: '#2ecc71', blue: '#3498db' };

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
function makeCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function createDeck() {
  const deck = [];
  for (const color of COLORS) {
    deck.push({ id: uid(), type: 'number', color, value: 0 });
    for (let n = 1; n <= 9; n++) {
      deck.push({ id: uid(), type: 'number', color, value: n });
      deck.push({ id: uid(), type: 'number', color, value: n });
    }
    ['skip', 'reverse', 'draw2'].forEach(type => {
      deck.push({ id: uid(), type, color });
      deck.push({ id: uid(), type, color });
    });
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ id: uid(), type: 'wild' });
    deck.push({ id: uid(), type: 'wild4' });
  }
  return shuffle(deck);
}
function getTop(room) {
  return room.discard[room.discard.length - 1] || null;
}
function connectedCount(room) {
  return room.players.filter(p => p.connected).length;
}
function firstConnectedIndex(room) {
  const idx = room.players.findIndex(p => p.connected);
  return idx >= 0 ? idx : 0;
}
function stepToNextConnected(room, fromIndex) {
  const n = room.players.length;
  if (n === 0) return -1;
  let i = fromIndex;
  for (let tries = 0; tries < n; tries++) {
    i = (i + room.direction + n) % n;
    if (room.players[i].connected) return i;
  }
  return fromIndex;
}
function advance(room, fromIndex, steps = 1) {
  let idx = fromIndex;
  for (let i = 0; i < steps; i++) idx = stepToNextConnected(room, idx);
  return idx;
}
function resetTurnFlags(room, player) {
  if (!player) return;
  player.hasDrawn = false;
  player.lastDrawnCardId = null;
}
function drawOne(room) {
  if (room.deck.length === 0) {
    const top = room.discard.pop();
    room.deck = shuffle(room.discard);
    room.discard = top ? [top] : [];
  }
  return room.deck.pop() || null;
}
function cardLabel(card) {
  if (!card) return '';
  if (card.type === 'number') return String(card.value);
  if (card.type === 'skip') return 'SKIP';
  if (card.type === 'reverse') return 'REV';
  if (card.type === 'draw2') return '+2';
  if (card.type === 'wild') return 'WILD';
  if (card.type === 'wild4') return '+4';
  return card.type.toUpperCase();
}
function isPlayableOnTop(card, room) {
  const top = getTop(room);
  if (!top) return true;
  if (room.drawPenalty > 0) {
    if (!room.stackingEnabled) return false;
    if (room.drawPenalty % 4 === 0 && card.type === 'wild4') return true;
    if (room.drawPenalty % 2 === 0 && card.type === 'draw2') return true;
    return false;
  }
  if (card.type === 'wild' || card.type === 'wild4') return true;
  if (card.color && card.color === room.currentColor) return true;
  if (card.type === 'number' && top.type === 'number' && card.value === top.value) return true;
  if (card.type !== 'number' && top.type === card.type) return true;
  return false;
}
function canStack(card, room) {
  if (room.drawPenalty === 0) return false;
  if (!room.stackingEnabled) return false;
  if (room.drawPenalty % 4 === 0 && card.type === 'wild4') return true;
  if (room.drawPenalty % 2 === 0 && card.type === 'draw2') return true;
  return false;
}
function sanitizeForPlayer(room, player) {
  const top = getTop(room);
  return {
    code: room.code,
    started: room.started,
    hostId: room.hostId,
    currentPlayerId: room.players[room.currentIndex]?.id || null,
    currentPlayerName: room.players[room.currentIndex]?.name || null,
    direction: room.direction,
    currentColor: room.currentColor,
    drawPenalty: room.drawPenalty,
    stackingEnabled: room.stackingEnabled,
    deckCount: room.deck.length,
    topCard: top,
    winner: room.winner,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      count: p.hand.length,
      connected: p.connected,
      isHost: p.id === room.hostId,
      calledUno: !!p.calledUno,
    })),
    yourId: player?.id || null,
    yourHand: player ? player.hand : [],
    yourHasDrawn: !!player?.hasDrawn,
    yourLastDrawnCardId: player?.lastDrawnCardId || null,
    canStart: !room.started && player?.id === room.hostId && room.players.length >= 2,
    canRestart: room.started && player?.id === room.hostId,
    isYourTurn: room.started && room.players[room.currentIndex]?.id === player?.id,
  };
}
function emitRoom(room) {
  for (const p of room.players) {
    if (p.connected && p.socketId) io.to(p.socketId).emit('state', sanitizeForPlayer(room, p));
  }
}
function createRoom(hostSocket, name, token, stackingEnabled) {
  let code;
  do { code = makeCode(); } while (rooms.has(code));
  const room = {
    code,
    hostId: null,
    started: false,
    winner: null,
    direction: 1,
    currentIndex: 0,
    currentColor: null,
    drawPenalty: 0,
    stackingEnabled: stackingEnabled !== false,
    deck: [],
    discard: [],
    players: [],
  };
  const player = {
    id: uid(),
    token: token || uid(),
    socketId: hostSocket.id,
    name: name || 'Player',
    connected: true,
    hand: [],
    hasDrawn: false,
    lastDrawnCardId: null,
    calledUno: false,
  };
  room.players.push(player);
  room.hostId = player.id;
  rooms.set(code, room);
  hostSocket.join(code);
  return { room, player };
}
function startGame(room) {
  room.started = true;
  room.winner = null;
  room.direction = 1;
  room.drawPenalty = 0;
  room.deck = createDeck();
  room.discard = [];
  room.players.forEach(p => {
    p.hand = [];
    p.calledUno = false;
    p.hasDrawn = false;
    p.lastDrawnCardId = null;
  });
  for (let r = 0; r < 7; r++) {
    for (const p of room.players) {
      const c = drawOne(room);
      if (c) p.hand.push(c);
    }
  }
  let top = drawOne(room);
  while (top && (top.type === 'wild' || top.type === 'wild4')) {
    room.deck.unshift(top);
    shuffle(room.deck);
    top = drawOne(room);
  }
  if (!top) top = { id: uid(), type: 'number', color: COLORS[0], value: 0 };
  room.discard.push(top);
  room.currentColor = top.color || COLORS[0];
  room.currentIndex = firstConnectedIndex(room);
  room.players.forEach(p => resetTurnFlags(room, p));
}
function onGameAction(room, player, cb) {
  if (!room || !player || !room.started) return cb?.('Game has not started.');
  if (room.players[room.currentIndex]?.id !== player.id) return cb?.('Not your turn.');
}

io.on('connection', socket => {
  socket.on('joinRoom', ({ name, roomCode, token, create, stackingEnabled }, cb) => {
    try {
      name = String(name || 'Player').slice(0, 20);
      token = token || null;
      let room, player;
      if (create || !roomCode) {
        ({ room, player } = createRoom(socket, name, token, stackingEnabled));
      } else {
        roomCode = String(roomCode).toUpperCase().trim();
        room = rooms.get(roomCode);
        if (!room) return cb?.({ ok: false, error: 'Room not found.' });
        let existing = room.players.find(p => p.token === token);
        if (existing) {
          existing.socketId = socket.id;
          existing.connected = true;
          existing.name = name;
          player = existing;
        } else {
          if (room.started) return cb?.({ ok: false, error: 'Game already started.' });
          if (room.players.length >= 6) return cb?.({ ok: false, error: 'Room is full (max 6 players).' });
          player = {
            id: uid(),
            token: token || uid(),
            socketId: socket.id,
            name,
            connected: true,
            hand: [],
            hasDrawn: false,
            lastDrawnCardId: null,
            calledUno: false,
          };
          room.players.push(player);
        }
        socket.join(room.code);
      }
      socket.data.roomCode = room.code;
      socket.data.token = player.token;
      socket.data.playerId = player.id;
      if (room.hostId == null) room.hostId = room.players[0]?.id || null;
      emitRoom(room);
      cb?.({ ok: true, roomCode: room.code, token: player.token, playerId: player.id, isHost: player.id === room.hostId, started: room.started });
    } catch (e) {
      cb?.({ ok: false, error: 'Join failed.' });
    }
  });

  socket.on('startGame', (_, cb) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb?.({ ok: false, error: 'Room not found.' });
    const player = room.players.find(p => p.id === socket.data.playerId);
    if (!player || player.id !== room.hostId) return cb?.({ ok: false, error: 'Only host can start.' });
    if (room.players.length < 2) return cb?.({ ok: false, error: 'Need at least 2 players.' });
    if (room.players.length > 6) return cb?.({ ok: false, error: 'Max 6 players.' });
    if (room.started) return cb?.({ ok: false, error: 'Game already started.' });
    startGame(room);
    emitRoom(room);
    cb?.({ ok: true });
  });

  socket.on('restartGame', (_, cb) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb?.({ ok: false, error: 'Room not found.' });
    const player = room.players.find(p => p.id === socket.data.playerId);
    if (!player || player.id !== room.hostId) return cb?.({ ok: false, error: 'Only host can restart.' });
    startGame(room);
    emitRoom(room);
    cb?.({ ok: true });
  });

  socket.on('playCard', ({ cardId, chosenColor }, cb) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find(p => p.id === socket.data.playerId);
    if (!room || !player) return cb?.({ ok: false, error: 'Room not found.' });
    if (!room.started) return cb?.({ ok: false, error: 'Game not started.' });
    if (room.players[room.currentIndex]?.id !== player.id) return cb?.({ ok: false, error: 'Not your turn.' });
    const idx = player.hand.findIndex(c => c.id === cardId);
    if (idx < 0) return cb?.({ ok: false, error: 'Card not in hand.' });
    const card = player.hand[idx];
    if (player.hasDrawn && player.lastDrawnCardId !== card.id) return cb?.({ ok: false, error: 'After drawing, you can only play the drawn card.' });
    if (!(isPlayableOnTop(card, room) || canStack(card, room))) return cb?.({ ok: false, error: 'Illegal move.' });

    player.hand.splice(idx, 1);
    room.discard.push(card);
    player.calledUno = false;

    if (card.type === 'wild' || card.type === 'wild4') {
      const color = COLORS.includes(chosenColor) ? chosenColor : COLORS[Math.floor(Math.random() * COLORS.length)];
      room.currentColor = color;
    } else {
      room.currentColor = card.color;
    }

    let steps = 1;
    if (card.type === 'skip') steps += 1;
    if (card.type === 'draw2') {
      room.drawPenalty += 2;
      steps += 1;
    }
    if (card.type === 'wild4') {
      room.drawPenalty += 4;
      steps += 1;
    }
    if (card.type === 'reverse') {
      const active = connectedCount(room);
      if (active === 2) {
        steps += 1;
      } else {
        room.direction *= -1;
      }
    }

    if (player.hand.length === 1) player.calledUno = false;
    if (player.hand.length === 0) {
      room.started = false;
      room.winner = player.name;
    }

    resetTurnFlags(room, player);

    if (room.started) {
      room.currentIndex = advance(room, room.currentIndex, steps);
      const next = room.players[room.currentIndex];
      resetTurnFlags(room, next);
    }

    emitRoom(room);
    cb?.({ ok: true });
  });

  socket.on('drawCard', (_, cb) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find(p => p.id === socket.data.playerId);
    if (!room || !player) return cb?.({ ok: false, error: 'Room not found.' });
    if (!room.started) return cb?.({ ok: false, error: 'Game not started.' });
    if (room.players[room.currentIndex]?.id !== player.id) return cb?.({ ok: false, error: 'Not your turn.' });

    if (room.drawPenalty > 0) {
      const count = room.drawPenalty;
      for (let i = 0; i < count; i++) {
        const c = drawOne(room);
        if (c) player.hand.push(c);
      }
      room.drawPenalty = 0;
      resetTurnFlags(room, player);
      room.currentIndex = advance(room, room.currentIndex, 1);
      resetTurnFlags(room, room.players[room.currentIndex]);
      emitRoom(room);
      return cb?.({ ok: true, penalty: true, drawn: count });
    }

    if (player.hasDrawn) return cb?.({ ok: false, error: 'Already drew this turn.' });
    const c = drawOne(room);
    if (!c) return cb?.({ ok: false, error: 'Deck empty.' });
    player.hand.push(c);
    player.hasDrawn = true;
    player.lastDrawnCardId = c.id;
    emitRoom(room);
    cb?.({ ok: true, card: c, playable: isPlayableOnTop(c, room) || canStack(c, room) });
  });

  socket.on('endTurn', (_, cb) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find(p => p.id === socket.data.playerId);
    if (!room || !player) return cb?.({ ok: false, error: 'Room not found.' });
    if (!room.started) return cb?.({ ok: false, error: 'Game not started.' });
    if (room.players[room.currentIndex]?.id !== player.id) return cb?.({ ok: false, error: 'Not your turn.' });
    if (!player.hasDrawn) return cb?.({ ok: false, error: 'Draw first or play a card.' });
    resetTurnFlags(room, player);
    room.currentIndex = advance(room, room.currentIndex, 1);
    resetTurnFlags(room, room.players[room.currentIndex]);
    emitRoom(room);
    cb?.({ ok: true });
  });

  socket.on('callUno', (_, cb) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find(p => p.id === socket.data.playerId);
    if (!room || !player) return cb?.({ ok: false, error: 'Room not found.' });
    if (player.hand.length === 1) {
      player.calledUno = true;
      emitRoom(room);
      cb?.({ ok: true });
    } else {
      cb?.({ ok: false, error: 'UNO only matters with 1 card left.' });
    }
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.data.playerId);
    if (!player) return;
    player.connected = false;
    player.socketId = null;
    if (room.started && room.players[room.currentIndex]?.id === player.id) {
      room.currentIndex = advance(room, room.currentIndex, 1);
      resetTurnFlags(room, room.players[room.currentIndex]);
    }
    emitRoom(room);
  });
});

setInterval(() => {
  for (const [code, room] of rooms.entries()) {
    const active = room.players.some(p => p.connected);
    if (!active) rooms.delete(code);
  }
}, 1000 * 60 * 10);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`UNO server running on http://localhost:${PORT}`);
});

require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const httpServer = createServer(app);

// Configuration du port (Render définit automatiquement process.env.PORT)
const PORT = process.env.PORT || 10000;

// Configuration CORS : On accepte l'URL du front ou localhost par défaut
const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

app.use(cors({
  origin: allowedOrigin,
  credentials: true
}));

// Configuration Socket.io
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigin,
    credentials: true,
    methods: ["GET", "POST"]
  }
});

// Stockage des rooms et joueurs
const gameRooms = new Map();
const userSockets = new Map();

io.on('connection', (socket) => {
  console.log(`✅ Client connecté: ${socket.id}`);

  socket.on('join-game', ({ gameUuid, userId, username }) => {
    console.log(`🎮 ${username} rejoint la partie ${gameUuid}`);
    socket.join(gameUuid);
    userSockets.set(userId, socket.id);
    socket.userId = userId;
    socket.gameUuid = gameUuid;

    if (!gameRooms.has(gameUuid)) {
      gameRooms.set(gameUuid, { players: [socket.id], userIds: [userId] });
    } else {
      const room = gameRooms.get(gameUuid);
      if (!room.players.includes(socket.id)) {
        room.players.push(socket.id);
        room.userIds.push(userId);
      }
    }

    io.to(gameUuid).emit('player-joined', {
      userId,
      username,
      playersCount: gameRooms.get(gameUuid).players.length
    });
  });

  socket.on('play-move', ({ gameUuid, position, symbol, userId }) => {
    socket.to(gameUuid).emit('move-played', {
      position,
      symbol,
      userId,
      timestamp: Date.now()
    });
  });

  socket.on('game-update', ({ gameUuid, gameState }) => {
    io.to(gameUuid).emit('game-updated', gameState);
  });

  socket.on('game-ended', ({ gameUuid, winner, isDraw }) => {
    io.to(gameUuid).emit('game-finished', { winner, isDraw, timestamp: Date.now() });
  });

  socket.on('request-game-state', ({ gameUuid }) => {
    socket.to(gameUuid).emit('share-game-state');
  });

  socket.on('leave-game', ({ gameUuid, userId }) => {
    socket.leave(gameUuid);
    if (gameRooms.has(gameUuid)) {
      const room = gameRooms.get(gameUuid);
      room.players = room.players.filter(id => id !== socket.id);
      room.userIds = room.userIds.filter(id => id !== userId);
      if (room.players.length === 0) gameRooms.delete(gameUuid);
    }
    io.to(gameUuid).emit('player-left', { userId });
  });

  socket.on('disconnect', () => {
    if (socket.gameUuid && socket.userId) {
      const { gameUuid, userId } = socket;
      if (gameRooms.has(gameUuid)) {
        const room = gameRooms.get(gameUuid);
        room.players = room.players.filter(id => id !== socket.id);
        room.userIds = room.userIds.filter(id => id !== userId);
        if (room.players.length === 0) {
          gameRooms.delete(gameUuid);
        } else {
          io.to(gameUuid).emit('player-left', { userId });
        }
      }
      userSockets.delete(userId);
    }
    console.log(`❌ Client déconnecté: ${socket.id}`);
  });
});

// Routes de monitoring
app.get('/', (req, res) => {
  res.json({ status: 'online', games: gameRooms.size, users: userSockets.size });
});

app.get('/health', (req, res) => res.status(200).send('OK'));

httpServer.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
});
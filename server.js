require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const httpServer = createServer(app);

// Configuration CORS
app.use(cors({
  origin: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  credentials: true
}));

// Configuration Socket.io avec CORS
const io = new Server(httpServer, {
  cors: {
    origin: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    credentials: true,
    methods: ["GET", "POST"]
  }
});

// Stocker les rooms actives et les joueurs connectés
const gameRooms = new Map(); // gameUuid -> { players: [socketId1, socketId2], game: {...} }
const userSockets = new Map(); // userId -> socketId

// Middleware Socket.io
io.on('connection', (socket) => {
  console.log(`✅ Nouveau client connecté: ${socket.id}`);

  // Événement: Un joueur rejoint une partie
  socket.on('join-game', ({ gameUuid, userId, username }) => {
    console.log(`🎮 ${username} (${userId}) rejoint la partie ${gameUuid}`);

    // Rejoindre la room
    socket.join(gameUuid);

    // Stocker la relation userId -> socketId
    userSockets.set(userId, socket.id);
    socket.userId = userId;
    socket.gameUuid = gameUuid;

    // Initialiser ou mettre à jour la room
    if (!gameRooms.has(gameUuid)) {
      gameRooms.set(gameUuid, {
        players: [socket.id],
        userIds: [userId]
      });
    } else {
      const room = gameRooms.get(gameUuid);
      if (!room.players.includes(socket.id)) {
        room.players.push(socket.id);
        room.userIds.push(userId);
      }
    }

    // Notifier tous les joueurs de la room
    io.to(gameUuid).emit('player-joined', {
      userId,
      username,
      playersCount: gameRooms.get(gameUuid).players.length
    });

    console.log(`📊 Joueurs dans ${gameUuid}:`, gameRooms.get(gameUuid).players.length);
  });

  // Événement: Un joueur joue un coup
  socket.on('play-move', ({ gameUuid, position, symbol, userId }) => {
    console.log(`🎯 Coup joué dans ${gameUuid}: position ${position} par user ${userId} (${symbol})`);

    // Diffuser le coup à tous les AUTRES joueurs de la partie (pas à l'émetteur)
    socket.to(gameUuid).emit('move-played', {
      position,
      symbol,
      userId,
      timestamp: Date.now()
    });
  });

  // Événement: Mise à jour de l'état de la partie
  socket.on('game-update', ({ gameUuid, gameState }) => {
    console.log(`🔄 Mise à jour de la partie ${gameUuid}`);

    // Diffuser la mise à jour à tous les joueurs
    io.to(gameUuid).emit('game-updated', gameState);
  });

  // Événement: Partie terminée
  socket.on('game-ended', ({ gameUuid, winner, isDraw }) => {
    console.log(`🏁 Partie ${gameUuid} terminée`);

    // Notifier tous les joueurs
    io.to(gameUuid).emit('game-finished', {
      winner,
      isDraw,
      timestamp: Date.now()
    });
  });

  // Événement: Demander le refresh de la partie
  socket.on('request-game-state', ({ gameUuid }) => {
    console.log(`🔍 Demande de l'état de la partie ${gameUuid}`);

    // Demander aux autres clients de partager l'état
    socket.to(gameUuid).emit('share-game-state');
  });

  // Événement: Un joueur quitte
  socket.on('leave-game', ({ gameUuid, userId }) => {
    console.log(`👋 ${userId} quitte la partie ${gameUuid}`);

    socket.leave(gameUuid);

    // Mettre à jour la room
    if (gameRooms.has(gameUuid)) {
      const room = gameRooms.get(gameUuid);
      room.players = room.players.filter(id => id !== socket.id);
      room.userIds = room.userIds.filter(id => id !== userId);

      if (room.players.length === 0) {
        gameRooms.delete(gameUuid);
        console.log(`🗑️  Room ${gameUuid} supprimée (aucun joueur)`);
      }
    }

    // Notifier les autres joueurs
    io.to(gameUuid).emit('player-left', { userId });
  });

  // Déconnexion
  socket.on('disconnect', () => {
    console.log(`❌ Client déconnecté: ${socket.id}`);

    // Nettoyer les rooms
    if (socket.gameUuid && socket.userId) {
      const gameUuid = socket.gameUuid;
      const userId = socket.userId;

      if (gameRooms.has(gameUuid)) {
        const room = gameRooms.get(gameUuid);
        room.players = room.players.filter(id => id !== socket.id);
        room.userIds = room.userIds.filter(id => id !== userId);

        if (room.players.length === 0) {
          gameRooms.delete(gameUuid);
        } else {
          // Notifier les autres joueurs
          io.to(gameUuid).emit('player-left', { userId });
        }
      }

      userSockets.delete(userId);
    }
  });
});

// Route de test
app.get('/', (req, res) => {
  res.json({ 
    message: 'Serveur WebSocket Tic Tac Toe',
    activeGames: gameRooms.size,
    connectedUsers: userSockets.size
  });
});

// Route pour obtenir les stats
app.get('/stats', (req, res) => {
  const games = Array.from(gameRooms.entries()).map(([uuid, data]) => ({
    uuid,
    playersCount: data.players.length
  }));

  res.json({
    activeGames: gameRooms.size,
    connectedUsers: userSockets.size,
    games
  });
});

// Démarrer le serveur
const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log(`\n🚀 Serveur WebSocket démarré sur le port ${PORT}`);
  console.log(`📡 En attente de connexions...`);
  console.log(`🌐 URL: http://localhost:${PORT}\n`);
});


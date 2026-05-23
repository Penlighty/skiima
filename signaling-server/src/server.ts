import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';

const app = express();
const port = process.env.PORT || 3000;

// Expose a REST health-check endpoint for load-balancers or deployment verification probes
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'skiima-signaling-broker',
    timestamp: new Date().toISOString(),
  });
});

const httpServer = createServer(app);

// Initialize Socket.io with permissive CORS for dynamic P2P browser/mobile connections
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

io.on('connection', (socket: Socket) => {
  console.log(`[Signaling] Client connected: ${socket.id}`);

  /**
   * Event: join-room
   * Dispatched by peers when establishing or connecting to a shared 6-digit key
   */
  socket.on('join-room', (payload: { roomCode: string; peerId: string }) => {
    const { roomCode, peerId } = payload;
    
    if (!roomCode || !peerId) {
      console.warn(`[Signaling] Invalid join payload received from ${socket.id}`);
      return;
    }

    socket.join(roomCode);
    console.log(`[Signaling] Peer ${peerId} (Socket: ${socket.id}) joined room: ${roomCode}`);

    // Notify other existing peers in the room to begin negotiating SDP
    socket.to(roomCode).emit('peer-joined', { peerId });
  });

  /**
   * Event: sdp-offer
   * Forward session description offers from senders to prospective receivers in the room
   */
  socket.on('sdp-offer', (payload: { roomCode: string; sdp: any }) => {
    const { roomCode, sdp } = payload;
    
    if (!roomCode || !sdp) return;

    console.log(`[Signaling] Relaying SDP Offer from ${socket.id} to room: ${roomCode}`);
    socket.to(roomCode).emit('receive-offer', { sdp });
  });

  /**
   * Event: sdp-answer
   * Forward session description answers from receivers back to the senders
   */
  socket.on('sdp-answer', (payload: { roomCode: string; sdp: any }) => {
    const { roomCode, sdp } = payload;
    
    if (!roomCode || !sdp) return;

    console.log(`[Signaling] Relaying SDP Answer from ${socket.id} to room: ${roomCode}`);
    socket.to(roomCode).emit('receive-answer', { sdp });
  });

  /**
   * Event: ice-candidate
   * Relay WebRTC network candidates between peers for hole-punching traversal
   */
  socket.on('ice-candidate', (payload: { roomCode: string; candidate: any }) => {
    const { roomCode, candidate } = payload;
    
    if (!roomCode || !candidate) return;

    console.log(`[Signaling] Relaying ICE candidate from ${socket.id} to room: ${roomCode}`);
    socket.to(roomCode).emit('relay-ice', { candidate });
  });

  /**
   * Event: disconnect
   * Clean up stateless connections in-memory automatically
   */
  socket.on('disconnect', () => {
    console.log(`[Signaling] Client disconnected: ${socket.id}`);
  });
});

httpServer.listen(port, () => {
  console.log(`====================================================`);
  console.log(`⚡ Skiima Signaling Broker is active on port: ${port}`);
  console.log(`====================================================`);
});

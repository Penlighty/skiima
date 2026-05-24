import { db } from './firebase';
import { doc, setDoc, deleteDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import type { FileMetadata } from './P2PEngine';

export interface PeerProfile {
  peerId: string;
  peerName: string;
}

export interface PresenceDoc {
  peerId: string;
  peerName: string;
  lastSeen: string;
  status: 'online' | 'offline';
}

export interface TransferRequest {
  senderId: string;
  senderName: string;
  fileMetadata: FileMetadata;
  code: string;
  status: 'pending' | 'accepted' | 'declined';
  timestamp: string;
}

const ADJECTIVES = [
  'Quantum', 'Nebula', 'Solar', 'Cosmic', 'Ocean', 'Cyber',
  'Alpha', 'Nova', 'Velocity', 'Astro', 'Shadow', 'Titan',
  'Magnetic', 'Vapor', 'Echo', 'Neon', 'Spectral', 'Hyper'
];

const NOUNS = [
  'Falcon', 'Dolphin', 'Lynx', 'Phoenix', 'Aurora', 'Vortex',
  'Orbit', 'Glider', 'Beacon', 'Echo', 'Stardust', 'Comet',
  'Ranger', 'Wave', 'Seeker', 'Pulse', 'Mirage', 'Saber'
];

/**
 * Generates a random aesthetic friendly peer name
 */
function generateRandomName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(100 + Math.random() * 900); // 3 digit number for uniqueness
  return `${adj} ${noun} ${num}`;
}

export const presence = {
  // === PROFILE MANAGEMENT ===

  getOrInitializePeerProfile(): PeerProfile {
    let peerId = localStorage.getItem('skiima_peer_id');
    let peerName = localStorage.getItem('skiima_peer_name');

    if (!peerId) {
      peerId = `peer_${Math.random().toString(36).substring(2, 10)}`;
      localStorage.setItem('skiima_peer_id', peerId);
    }
    
    if (!peerName) {
      peerName = generateRandomName();
      localStorage.setItem('skiima_peer_name', peerName);
    }

    return { peerId, peerName };
  },

  updatePeerName(newName: string): void {
    const trimmed = newName.trim();
    if (trimmed) {
      localStorage.setItem('skiima_peer_name', trimmed);
    }
  },

  // === FIRESTORE PRESENCE HEARTBEAT ===

  /**
   * Publishes status once, returns cleanup unsubscribe function
   */
  async publishPresence(peerId: string, peerName: string, status: 'online' | 'offline'): Promise<void> {
    if (!peerId) return;
    const presenceRef = doc(db, 'rooms', `presence_${peerId}`);
    try {
      if (status === 'online') {
        await setDoc(presenceRef, {
          peerId,
          peerName,
          lastSeen: new Date().toISOString(),
          status: 'online'
        });
      } else {
        // Soft-offline or delete doc
        await deleteDoc(presenceRef);
      }
    } catch (e) {
      console.warn('Failed to update Firestore presence heartbeat:', e);
    }
  },

  /**
   * Subscribes to other peer's presence state real-time
   */
  subscribeToPeerPresence(peerId: string, onUpdate: (data: PresenceDoc | null) => void): () => void {
    const presenceRef = doc(db, 'rooms', `presence_${peerId}`);
    return onSnapshot(presenceRef, (snapshot: any) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as PresenceDoc;
        onUpdate(data);
      } else {
        onUpdate(null);
      }
    }, (err: any) => {
      console.warn(`Error watching presence for peer ${peerId}:`, err);
      onUpdate(null);
    });
  },

  // === MAGIC DIRECT TRANSFER REQUESTS ===

  /**
   * Listens for inbound connection requests targeting self
   */
  listenToInboundRequests(myPeerId: string, onIncoming: (req: TransferRequest | null) => void): () => void {
    const requestRef = doc(db, 'rooms', `request_${myPeerId}`);
    return onSnapshot(requestRef, (snapshot: any) => {
      if (snapshot.exists()) {
        const req = snapshot.data() as TransferRequest;
        onIncoming(req);
      } else {
        onIncoming(null);
      }
    }, (err: any) => {
      console.warn('Error listening for inbound transfer requests:', err);
    });
  },

  /**
   * Creates a connection request targeting peer B, returns listener for status changes
   */
  async createOutboundRequest(
    targetPeerId: string,
    myPeerId: string,
    myPeerName: string,
    fileMetadata: FileMetadata,
    code: string,
    onStatusChange: (status: 'pending' | 'accepted' | 'declined') => void
  ): Promise<() => void> {
    const requestRef = doc(db, 'rooms', `request_${targetPeerId}`);
    
    // 1. Write request details
    await setDoc(requestRef, {
      senderId: myPeerId,
      senderName: myPeerName,
      fileMetadata,
      code,
      status: 'pending',
      timestamp: new Date().toISOString()
    });

    // 2. Listen to request changes
    const unsubscribe = onSnapshot(requestRef, (snapshot: any) => {
      if (snapshot.exists()) {
        const req = snapshot.data() as TransferRequest;
        onStatusChange(req.status);
      }
    });

    return async () => {
      unsubscribe();
      // Clean up the request document
      try {
        await deleteDoc(requestRef);
      } catch (e) {
        console.warn('Failed to clean request doc:', e);
      }
    };
  },

  /**
   * Responders accept or decline incoming requests
   */
  async acceptRequest(myPeerId: string): Promise<void> {
    const requestRef = doc(db, 'rooms', `request_${myPeerId}`);
    try {
      await updateDoc(requestRef, { status: 'accepted' });
    } catch (e) {
      console.error('Failed to accept request document:', e);
    }
  },

  async declineRequest(myPeerId: string): Promise<void> {
    const requestRef = doc(db, 'rooms', `request_${myPeerId}`);
    try {
      await updateDoc(requestRef, { status: 'declined' });
      // Delete after brief delay to let sender notice the status change
      setTimeout(() => {
        deleteDoc(requestRef).catch(() => {});
      }, 2000);
    } catch (e) {
      console.error('Failed to decline request document:', e);
    }
  },

  async cancelRequest(targetPeerId: string): Promise<void> {
    const requestRef = doc(db, 'rooms', `request_${targetPeerId}`);
    try {
      await deleteDoc(requestRef);
    } catch (e) {
      console.error('Failed to delete request document:', e);
    }
  }
};

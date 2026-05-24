import { db } from './firebase';
import {
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
  addDoc,
  getDoc,
  deleteDoc
} from 'firebase/firestore';
import { historyDb } from './historyDb';
import { chunkCache } from './chunkCache';

export interface FileMetadata {
  name: string;
  size: number;
  type: string;
}

export interface TransferStats {
  progress: number; // percentage (0 to 100)
  speed: number;    // bytes per second
  bytesTransferred: number;
  timeRemaining: number; // seconds
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected-p2p' | 'connected-turn';

const CHUNK_SIZE = 64 * 1024; // 64KB chunks (optimal for modern WebRTC MTU size)
const BLOCK_SIZE = 1024 * 1024; // 1MB block read size to saturate disk IO
const BUFFER_THRESHOLD = 512 * 1024; // 512KB buffer threshold for backpressure

/**
 * Asynchronously fetches ICE servers.
 * Dynamically queries our secure Vercel API for Cloudflare Calls TURN servers in production.
 * Gracefully falls back to static configurations (Google STUN + Metered.ca) for local development or API outages.
 */
async function fetchIceServers(): Promise<RTCIceServer[]> {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ];

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 seconds timeout

    const res = await fetch('/api/turn', { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data && data.iceServers && Array.isArray(data.iceServers)) {
        console.log('[ICE] Successfully retrieved dynamic Cloudflare Calls TURN servers.');
        servers.push(...data.iceServers);
        return servers;
      }
    } else {
      console.warn(`[ICE] Cloudflare API responded with status ${res.status}. Falling back to static servers.`);
    }
  } catch (err) {
    console.warn('[ICE] Failed to fetch dynamic Cloudflare TURN servers, falling back to static config:', err);
  }

  // Fallback: static configuration (Metered.ca or Google STUN)
  const username = import.meta.env.VITE_METERED_USERNAME;
  const credential = import.meta.env.VITE_METERED_CREDENTIAL;

  if (username && credential) {
    // 1. Hostname-based TURN configuration (Standard path)
    servers.push({
      urls: [
        'stun:global.relay.metered.ca:80',
        'turn:global.relay.metered.ca:80?transport=udp',
        'turn:global.relay.metered.ca:443?transport=tcp',
        'turns:global.relay.metered.ca:443?transport=tcp'
      ],
      username: username,
      credential: credential
    });

    // 2. Raw IP-based TURN fallback (Bypasses local ISP or Wi-Fi DNS-level filtering for .ca domains!)
    servers.push({
      urls: [
        'stun:172.233.120.119:80',
        'turn:172.233.120.119:80?transport=udp',
        'turn:172.233.120.119:443?transport=tcp',
        'turns:172.233.120.119:443?transport=tcp'
      ],
      username: username,
      credential: credential
    });
  } else {
    // Fallback STUN in case credentials are not defined
    servers.push({ urls: 'stun:stun.relay.metered.ca:80' });
  }

  return servers;
}

export class P2PEngine {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  public roomCode: string | null = null;

  // Firestore listeners unsubscribe handles
  private unsubscribeRoom: (() => void) | null = null;
  private unsubscribeCandidates: (() => void) | null = null;

  // Real-time paired peer info
  public pairedPeerId: string = 'unknown';
  public pairedPeerName: string = 'Anonymous Peer';

  // Active file transfer state
  public isPaused = false;
  public isStopped = false;
  private offset = 0;
  private currentFile: File | null = null;
  private readNextChunkFn: (() => void) | null = null;
  private wakeLock: any = null;

  private async acquireWakeLock(): Promise<void> {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await (navigator as any).wakeLock.request('screen');
        console.log('[WakeLock] Screen Wake Lock acquired.');
      }
    } catch (err: any) {
      console.warn(`[WakeLock] Error acquiring screen wake lock: ${err.name}, ${err.message}`);
    }
  }

  private releaseWakeLock(): void {
    if (this.wakeLock) {
      try {
        this.wakeLock.release();
        console.log('[WakeLock] Screen Wake Lock released.');
      } catch (err: any) {
        console.warn(`[WakeLock] Error releasing screen wake lock: ${err.message}`);
      }
      this.wakeLock = null;
    }
  }

  // Callbacks for UI updates
  public onStatusChange?: (status: ConnectionStatus) => void;
  public onPeerIdReady?: (id: string) => void;
  public onMetadataReceived?: (metadata: FileMetadata) => void;
  public onProgress?: (stats: TransferStats) => void;
  public onTransferComplete?: (downloadUrl?: string) => void;
  public onError?: (error: string) => void;
  public onPeerHandshake?: (peerId: string, peerName: string) => void;

  // Pause / Resume / Stop Callbacks
  public onTransferPaused?: () => void;
  public onTransferResumed?: () => void;
  public onTransferStopped?: (reason: string) => void;

  constructor() {}

  /**
   * Initializes the native WebRTC peer connection (Sender Role)
   * @param customId The generated 6-digit room code
   */
  public initialize(customId?: string): void {
    this.cleanup();
    this.updateStatus('connecting');

    if (!customId) {
      if (this.onError) this.onError('Room code is required.');
      this.updateStatus('disconnected');
      return;
    }

    const roomCode = customId;
    this.roomCode = roomCode;

    // Create the WebRTC Session Offer asynchronously
    (async () => {
      try {
        const iceServers = await fetchIceServers();
        const peerOptions: RTCConfiguration = {
          iceServers: iceServers,
          iceTransportPolicy: 'all'
        };

        const pc = new RTCPeerConnection(peerOptions);
        this.pc = pc;

        // Create the WebRTC DataChannel
        const dc = pc.createDataChannel('skiima-channel', { ordered: true });
        this.setupDataChannel(dc);

        // Write ICE Candidates to Firestore rooms/{roomCode}/senderCandidates
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            const candidateRef = collection(db, 'rooms', roomCode, 'senderCandidates');
            addDoc(candidateRef, event.candidate.toJSON()).catch((err: any) => {
              console.error('Failed to write local sender ICE candidate:', err);
            });
          }
        };

        // Listen for connection state changes (Sender)
        pc.onconnectionstatechange = () => {
          console.log('[WebRTC] Sender connection state:', pc.connectionState);
          if (
            pc.connectionState === 'failed' || 
            pc.connectionState === 'disconnected' || 
            pc.connectionState === 'closed'
          ) {
            console.warn('[WebRTC] Sender connection failed or lost. Transitioning status to disconnected...');
            this.updateStatus('disconnected');
          }
          // NOTE: 'connected' status is set from dc.onopen to guarantee DataChannel is ready
        };

        pc.onicecandidateerror = (ev: RTCPeerConnectionIceErrorEvent) => {
          console.warn('[ICE] Candidate error:', ev.errorCode, ev.errorText, ev.url);
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Write offer SDP to Firestore
        const roomDocRef = doc(db, 'rooms', roomCode);
        await setDoc(roomDocRef, {
          offer: {
            sdp: offer.sdp,
            type: offer.type
          },
          createdAt: new Date().toISOString()
        });

        if (this.onPeerIdReady) {
          this.onPeerIdReady(roomCode);
        }

        this.unsubscribeRoom = onSnapshot(roomDocRef, (snapshot: any) => {
          const data = snapshot.data();
          if (data && data.answer && !pc.currentRemoteDescription) {
            const answer = new RTCSessionDescription(data.answer);
            pc.setRemoteDescription(answer)
              .then(() => {
                console.log('[WebRTC] Set remote Answer SDP successfully');
                // Now listen to remote receiver's ICE candidates
                this.listenToRemoteCandidates(roomCode, 'receiverCandidates');
              })
              .catch((err: any) => {
                console.error('Failed to set remote description:', err);
              });
          }
        });

      } catch (err: any) {
        console.error('[WebRTC] Initialization or negotiation failed:', err);
        if (this.onError) this.onError(err.message || 'Failed to negotiate WebRTC offer.');
        this.updateStatus('disconnected');
      }
    })();
  }

  /**
   * Connects as a receiver to the sender's room code
   * @param senderPeerId The short 6-digit code generated by the sender
   */
  public connectToPeer(senderPeerId: string): void {
    this.cleanup();
    this.updateStatus('connecting');

    const roomCode = senderPeerId;
    this.roomCode = roomCode;

    // Retrieve Offer SDP from Firestore and generate Answer SDP asynchronously
    (async () => {
      try {
        const iceServers = await fetchIceServers();
        const peerOptions: RTCConfiguration = {
          iceServers: iceServers,
          iceTransportPolicy: 'all'
        };

        const pc = new RTCPeerConnection(peerOptions);
        this.pc = pc;

        // Handle receiving WebRTC DataChannel
        pc.ondatachannel = (event) => {
          console.log('[WebRTC] DataChannel received from sender');
          this.setupDataChannel(event.channel);
        };

        // Write ICE Candidates to Firestore rooms/{roomCode}/receiverCandidates
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            const candidateRef = collection(db, 'rooms', roomCode, 'receiverCandidates');
            addDoc(candidateRef, event.candidate.toJSON()).catch((err: any) => {
              console.error('Failed to write local receiver ICE candidate:', err);
            });
          }
        };

        // Listen for connection state changes (Receiver)
        pc.onconnectionstatechange = () => {
          console.log('[WebRTC] Receiver connection state:', pc.connectionState);
          if (
            pc.connectionState === 'failed' || 
            pc.connectionState === 'disconnected' || 
            pc.connectionState === 'closed'
          ) {
            console.warn('[WebRTC] Receiver connection failed or lost. Transitioning status to disconnected...');
            this.updateStatus('disconnected');
          }
          // NOTE: 'connected' status is set from dc.onopen to guarantee DataChannel is ready
        };

        pc.onicecandidateerror = (ev: RTCPeerConnectionIceErrorEvent) => {
          console.warn('[ICE] Candidate error:', ev.errorCode, ev.errorText, ev.url);
        };

        const roomDocRef = doc(db, 'rooms', roomCode);
        const roomSnapshot = await getDoc(roomDocRef);

        if (!roomSnapshot.exists()) {
          throw new Error('Connection room code not found. Please double check.');
        }

        const data = roomSnapshot.data();
        if (!data || !data.offer) {
          throw new Error('Room is active, but the offer description is missing.');
        }

        const offer = new RTCSessionDescription(data.offer);
        await pc.setRemoteDescription(offer);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        // Update room with Answer SDP
        await updateDoc(roomDocRef, {
          answer: {
            sdp: answer.sdp,
            type: answer.type
          }
        });

        // Listen to remote sender's ICE candidates
        this.listenToRemoteCandidates(roomCode, 'senderCandidates');

      } catch (err: any) {
        console.error('[WebRTC] Receiver connection negotiation failed:', err);
        if (this.onError) this.onError(err.message || 'Failed to complete handshake.');
        this.updateStatus('disconnected');
      }
    })();
  }

  /**
   * Sets up real-time sync for remote ICE candidates
   */
  private listenToRemoteCandidates(roomCode: string, collectionName: 'senderCandidates' | 'receiverCandidates'): void {
    const candidateRef = collection(db, 'rooms', roomCode, collectionName);

    if (this.unsubscribeCandidates) {
      this.unsubscribeCandidates();
    }

    this.unsubscribeCandidates = onSnapshot(candidateRef, (snapshot: any) => {
      snapshot.docChanges().forEach((change: any) => {
        if (change.type === 'added') {
          const candidateData = change.doc.data();
          if (this.pc) {
            const candidate = new RTCIceCandidate(candidateData as RTCIceCandidateInit);
            this.pc.addIceCandidate(candidate).catch((err: any) => {
              console.warn('[WebRTC] Failed to add remote ICE candidate:', err);
            });
          }
        }
      });
    });
  }

  /**
   * Sends a file to the connected peer over the RTCDataChannel
   * @param file The file object from input or dropzone
   */
  public async sendFile(file: File): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('No active peer connection');
    }

    this.isPaused = false;
    this.isStopped = false;
    this.currentFile = file;
    this.offset = 0;
    this.acquireWakeLock();

    const metadata: FileMetadata = {
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
    };

    console.log('[WebRTC] Initiating transfer handshake, sending metadata...');
    // 1. Send file metadata as JSON string. The streaming loop will start
    // once the receiver replies with 'request-offset'.
    this.dataChannel.send(JSON.stringify({ type: 'metadata', data: metadata }));
  }

  /**
   * Starts high-speed block-buffered file streaming from a specific byte offset
   */
  public startChunkStreaming(startOffset: number): void {
    const file = this.currentFile;
    if (!file || !this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.warn('[WebRTC] Cannot start chunk streaming: state invalid.');
      return;
    }

    this.offset = startOffset;
    this.isPaused = false;
    this.isStopped = false;
    this.acquireWakeLock();

    const fileReader = new FileReader();
    const totalSize = file.size;
    
    let startTime = Date.now();
    let lastStatsTime = Date.now();
    let bytesSentInSession = 0;

    const readNextBlock = () => {
      if (this.isPaused || this.isStopped) return;
      const slice = file.slice(this.offset, Math.min(this.offset + BLOCK_SIZE, totalSize));
      fileReader.readAsArrayBuffer(slice);
    };

    this.readNextChunkFn = readNextBlock;

    fileReader.onload = async (e) => {
      if (this.isStopped || this.isPaused) return;

      if (e.target?.result instanceof ArrayBuffer) {
        const blockBuffer = e.target.result;
        let blockOffset = 0;

        while (blockOffset < blockBuffer.byteLength && !this.isStopped && !this.isPaused) {
          const chunkLength = Math.min(CHUNK_SIZE, blockBuffer.byteLength - blockOffset);
          const chunk = blockBuffer.slice(blockOffset, blockOffset + chunkLength);

          // Apply backpressure using RTCDataChannel's bufferedAmount
          if (this.dataChannel && this.dataChannel.bufferedAmount > BUFFER_THRESHOLD) {
            await this.waitBufferLow(this.dataChannel);
          }

          if (this.isStopped || this.isPaused) return;

          // Send the raw binary chunk directly
          if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(chunk);

            this.offset += chunk.byteLength;
            blockOffset += chunk.byteLength;
            bytesSentInSession += chunk.byteLength;

            // Real-time speed metrics calculation
            const now = Date.now();
            if (now - lastStatsTime >= 200 || this.offset === totalSize) {
              const timePassed = (now - startTime) / 1000 || 0.001;
              const currentSpeed = bytesSentInSession / timePassed; // bytes/sec
              const remainingBytes = totalSize - this.offset;
              const timeRemaining = remainingBytes / (currentSpeed || 1);

              if (this.onProgress) {
                this.onProgress({
                  progress: Math.min((this.offset / totalSize) * 100, 100),
                  speed: currentSpeed,
                  bytesTransferred: this.offset,
                  timeRemaining: Math.max(0, Math.round(timeRemaining)),
                });
              }
              lastStatsTime = now;
            }
          } else {
            console.warn('[WebRTC] DataChannel closed during block streaming loop.');
            return;
          }
        }

        if (this.offset < totalSize) {
          if (!this.isPaused && !this.isStopped) {
            readNextBlock();
          }
        } else {
          // Signal completed transfer as JSON string
          if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(JSON.stringify({ type: 'done' }));
          }
          this.releaseWakeLock();
          console.log('[WebRTC] Sender finished block streaming. Waiting for receiver done-ack...');
        }
      }
    };

    fileReader.onerror = () => {
      if (this.onError) {
        this.onError('Error reading file block.');
      }
    };

    // Initiate first block read
    readNextBlock();
  }

  /**
   * Pauses the active file transfer
   */
  public pauseTransfer(): void {
    if (this.isPaused || this.isStopped) return;
    this.isPaused = true;
    this.releaseWakeLock();
    console.log('[WebRTC] Sender paused transfer');
    try {
      this.dataChannel?.send(JSON.stringify({ type: 'pause' }));
    } catch (e) {
      console.warn('Failed to send pause control:', e);
    }
    if (this.onTransferPaused) {
      this.onTransferPaused();
    }
  }

  /**
   * Resumes the active file transfer
   */
  public resumeTransfer(): void {
    if (!this.isPaused || this.isStopped) return;
    this.isPaused = false;
    this.acquireWakeLock();
    console.log('[WebRTC] Sender resumed transfer');
    try {
      this.dataChannel?.send(JSON.stringify({ type: 'resume' }));
    } catch (e) {
      console.warn('Failed to send resume control:', e);
    }
    if (this.onTransferResumed) {
      this.onTransferResumed();
    }
    if (this.readNextChunkFn) {
      this.readNextChunkFn();
    }
  }

  /**
   * Stops the active file transfer completely
   */
  public stopTransfer(): void {
    this.isStopped = true;
    this.isPaused = false;
    this.releaseWakeLock();
    console.log('[WebRTC] Sender stopped transfer');
    try {
      this.dataChannel?.send(JSON.stringify({ type: 'stop' }));
    } catch (e) {
      console.warn('Failed to send stop control:', e);
    }
    if (this.onTransferStopped) {
      this.onTransferStopped('Transfer was cancelled.');
    }
    this.cleanup();
  }

  /**
   * Helper to wait until the WebRTC buffer is low enough to prevent browser memory blowout
   */
  private waitBufferLow(dataChannel: RTCDataChannel): Promise<void> {
    return new Promise((resolve) => {
      if (dataChannel.bufferedAmount < BUFFER_THRESHOLD) {
        resolve();
        return;
      }

      const checkBuffer = () => {
        if (dataChannel.bufferedAmount < BUFFER_THRESHOLD) {
          resolve();
        } else {
          setTimeout(checkBuffer, 10);
        }
      };
      
      const onLow = () => {
        dataChannel.removeEventListener('bufferedamountlow', onLow);
        resolve();
      };
      
      dataChannel.addEventListener('bufferedamountlow', onLow);
      setTimeout(checkBuffer, 100); // Robust fallback timeout
    });
  }

  /**
   * Configures native RTCDataChannel listeners
   */
  private setupDataChannel(dc: RTCDataChannel): void {
    this.dataChannel = dc;
    dc.binaryType = 'arraybuffer';

    try {
      dc.bufferedAmountLowThreshold = 65536; // 64KB threshold
    } catch (e) {
      console.warn('Failed to set bufferedAmountLowThreshold:', e);
    }

    dc.onopen = () => {
      console.log('[WebRTC] RTCDataChannel opened successfully');

      if (this.pc) {
        this.detectIceCandidateType(this.pc);
      }

      // Clean up the signaling Firestore room now that we are directly connected
      if (this.roomCode) {
        this.cleanupRoomDoc(this.roomCode);
      }

      // Send bi-directional handshake to exchange peer details
      const myPeerId = localStorage.getItem('skiima_peer_id') || 'unknown';
      const myPeerName = localStorage.getItem('skiima_peer_name') || 'Anonymous Peer';
      try {
        dc.send(JSON.stringify({ type: 'handshake', peerId: myPeerId, peerName: myPeerName }));
      } catch (err) {
        console.warn('Failed to send local peer handshake:', err);
      }
    };

    const logFailedTransfer = () => {
      if (receivedMetadata && bytesReceived > 0 && bytesReceived < receivedMetadata.size) {
        historyDb.addShareHistoryItem({
          fileName: receivedMetadata.name,
          fileSize: receivedMetadata.size,
          peerRole: 'receiver',
          peerId: this.pairedPeerId,
          peerName: this.pairedPeerName,
          status: 'failed'
        });
      } else if (this.currentFile && this.offset > 0 && this.offset < this.currentFile.size) {
        historyDb.addShareHistoryItem({
          fileName: this.currentFile.name,
          fileSize: this.currentFile.size,
          peerRole: 'sender',
          peerId: this.pairedPeerId,
          peerName: this.pairedPeerName,
          status: 'failed'
        });
      }
    };

    dc.onclose = () => {
      console.log('[WebRTC] RTCDataChannel closed');
      logFailedTransfer();
      this.updateStatus('disconnected');
      // Don't call full cleanup() here — let the connection state handler manage it
    };

    dc.onerror = (err) => {
      console.error('[WebRTC] RTCDataChannel error:', err);
      logFailedTransfer();
      if (this.onError) {
        this.onError('P2P connection was lost or closed.');
      }
      this.updateStatus('disconnected');
    };

    let receivedMetadata: FileMetadata | null = null;
    let receivedChunks: ArrayBuffer[] = [];
    let bytesReceived = 0;
    let startTime = Date.now();
    let lastStatsTime = Date.now();

    dc.onmessage = (event) => {
      const payload = event.data;
      if (!payload) return;

      // Handle binary file chunks
      if (payload instanceof ArrayBuffer) {
        if (receivedMetadata) {
          receivedChunks.push(payload);
          bytesReceived += payload.byteLength;

          // Asynchronously cache chunk in local IndexedDB
          const fileKey = `${receivedMetadata.name}_${receivedMetadata.size}`;
          const chunkIndex = Math.floor((bytesReceived - payload.byteLength) / CHUNK_SIZE);
          chunkCache.putChunk(fileKey, chunkIndex, payload).catch((e) => {
            console.warn('Failed to cache chunk in IndexedDB:', e);
          });

          const now = Date.now();
          if (now - lastStatsTime >= 200 || bytesReceived === receivedMetadata.size) {
            const timePassed = (now - startTime) / 1000 || 0.001;
            const currentSpeed = bytesReceived / timePassed;
            const remainingBytes = receivedMetadata.size - bytesReceived;
            const timeRemaining = remainingBytes / (currentSpeed || 1);

            if (this.onProgress) {
              this.onProgress({
                progress: Math.min((bytesReceived / receivedMetadata.size) * 100, 100),
                speed: currentSpeed,
                bytesTransferred: bytesReceived,
                timeRemaining: Math.max(0, Math.round(timeRemaining)),
              });
            }
            lastStatsTime = now;
          }
        }
        return;
      }

      // Handle string control payloads (serialized JSON)
      if (typeof payload === 'string') {
        try {
          const control = JSON.parse(payload);
          if (control && control.type) {
            switch (control.type) {
              case 'handshake':
                this.pairedPeerId = control.peerId;
                this.pairedPeerName = control.peerName;
                if (this.onPeerHandshake) {
                  this.onPeerHandshake(control.peerId, control.peerName);
                }
                break;

              case 'metadata':
                {
                  const metadata = control.data as FileMetadata;
                  receivedMetadata = metadata;
                  this.acquireWakeLock();
                  (async () => {
                    const fileKey = `${metadata.name}_${metadata.size}`;
                    const history = historyDb.getShareHistory();
                    const failedItem = history.find(
                      (item) =>
                        item.status === 'failed' &&
                        item.fileName === metadata.name &&
                        item.fileSize === metadata.size &&
                        item.peerRole === 'receiver'
                    );

                    if (failedItem) {
                      try {
                        const chunkCount = Math.ceil(metadata.size / CHUNK_SIZE);
                        const loadedChunks = await chunkCache.getChunks(fileKey, chunkCount);
                        receivedChunks = loadedChunks;
                        bytesReceived = loadedChunks.reduce((acc, c) => acc + c.byteLength, 0);
                        console.log(`[WebRTC Resume] Loaded ${loadedChunks.length} chunks. Resuming from offset ${bytesReceived}`);
                      } catch (e) {
                        console.warn('Failed to restore chunks from cache:', e);
                        receivedChunks = [];
                        bytesReceived = 0;
                      }
                    } else {
                      await chunkCache.clearChunks(fileKey);
                      receivedChunks = [];
                      bytesReceived = 0;
                    }

                    startTime = Date.now();
                    lastStatsTime = Date.now();
                    
                    if (this.onMetadataReceived) {
                      this.onMetadataReceived(metadata);
                    }
                    
                    // Request starting offset from sender
                    dc.send(JSON.stringify({ type: 'request-offset', offset: bytesReceived }));
                  })();
                }
                break;

              case 'request-offset':
                // Sender-side offset agreement
                console.log(`[WebRTC] Receiver requested offset: ${control.offset}. Starting stream...`);
                this.startChunkStreaming(control.offset);
                break;

              case 'pause':
                console.log('[WebRTC] Receiver got pause notification');
                this.releaseWakeLock();
                if (this.onTransferPaused) this.onTransferPaused();
                break;

              case 'resume':
                console.log('[WebRTC] Receiver got resume notification');
                this.acquireWakeLock();
                if (this.onTransferResumed) this.onTransferResumed();
                break;

              case 'stop':
                console.log('[WebRTC] Receiver got stop notification');
                this.releaseWakeLock();
                if (this.onTransferStopped) this.onTransferStopped('Sender cancelled the transfer.');
                this.cleanup();
                break;

              case 'disconnect':
                console.log('[WebRTC] Peer disconnected manually');
                this.releaseWakeLock();
                if (this.onError) {
                  this.onError('The other user has manually disconnected.');
                }
                this.cleanup();
                break;

              case 'done':
                if (receivedMetadata && receivedChunks.length > 0) {
                  this.releaseWakeLock();
                  
                  // Verify that the fully received byte size matches metadata exactly
                  if (bytesReceived === receivedMetadata.size) {
                    const fileKey = `${receivedMetadata.name}_${receivedMetadata.size}`;
                    chunkCache.clearChunks(fileKey).catch(console.warn);

                    // Reassemble the incoming file chunks into a single Blob
                    const fileBlob = new Blob(receivedChunks, { type: receivedMetadata.type });
                    const downloadUrl = URL.createObjectURL(fileBlob);

                    // Acknowledge the receipt and successful file construction to the sender
                    if (dc.readyState === 'open') {
                      dc.send(JSON.stringify({ type: 'done-ack' }));
                    }

                    if (this.onTransferComplete) {
                      this.onTransferComplete(downloadUrl);
                    }
                  } else {
                    console.error(`[WebRTC] Expected ${receivedMetadata.size} bytes, but received ${bytesReceived} bytes.`);
                    if (this.onError) {
                      this.onError('File transfer was incomplete or corrupted.');
                    }
                  }
                  
                  // Clean up buffer
                  receivedChunks = [];
                }
                break;

              case 'done-ack':
                console.log('[WebRTC] Sender received done-ack verification from receiver.');
                if (this.onTransferComplete) {
                  this.onTransferComplete();
                }
                break;
            }
          }
        } catch (e) {
          console.error('[WebRTC] Failed to parse control payload:', e);
        }
      }
    };
  }

  /**
   * Deletes the Firestore signaling room document
   */
  private async cleanupRoomDoc(roomCode: string): Promise<void> {
    try {
      const roomDocRef = doc(db, 'rooms', roomCode);
      await deleteDoc(roomDocRef);
      console.log('[Signaling] Stateless Firestore room deleted successfully:', roomCode);
    } catch (e) {
      console.warn('[Signaling] Room cleanup doc skipped:', e);
    }
  }

  /**
   * Analyzes RTCPeerConnection to check if direct P2P or TURN relay is used
   */
  private async detectIceCandidateType(pc: RTCPeerConnection): Promise<void> {
    let retries = 12; // Wait up to 3 seconds for connection stats to populate
    let isRelay = false;
    let activePair: any = null;
    let statsMap = new Map<string, RTCStats>();

    console.log('[WebRTC] Detecting connection candidate type...');

    while (retries > 0 && !activePair) {
      try {
        const stats = await pc.getStats();
        statsMap = new Map<string, RTCStats>(stats as unknown as Map<string, RTCStats>);

        // 1. Try finding by 'selected' or 'nominated' properties on candidate-pair
        stats.forEach((report) => {
          if (report.type === 'candidate-pair') {
            const pair = report as any;
            if (pair.selected === true || pair.nominated === true) {
              activePair = pair;
            }
          }
        });

        // 2. Fallback to Transport-based selected pair ID (standard spec)
        if (!activePair) {
          let activeCandidatePairId = '';
          stats.forEach((report) => {
            if (report.type === 'transport' && (report as any).selectedCandidatePairId) {
              activeCandidatePairId = (report as any).selectedCandidatePairId;
            }
          });
          if (activeCandidatePairId) {
            activePair = statsMap.get(activeCandidatePairId);
          }
        }

        // 3. Fallback scan succeeded pairs
        if (!activePair) {
          let succeededPairs: any[] = [];
          stats.forEach((report) => {
            if (report.type === 'candidate-pair' && (report as any).state === 'succeeded') {
              succeededPairs.push(report);
            }
          });
          if (succeededPairs.length > 0) {
            const directPair = succeededPairs.find((pair) => {
              const localCandidate = pair.localCandidateId ? statsMap.get(pair.localCandidateId) as any : null;
              const remoteCandidate = pair.remoteCandidateId ? statsMap.get(pair.remoteCandidateId) as any : null;
              const isLocalRelay = localCandidate && localCandidate.candidateType === 'relay';
              const isRemoteRelay = remoteCandidate && remoteCandidate.candidateType === 'relay';
              return !isLocalRelay && !isRemoteRelay;
            });
            activePair = directPair || succeededPairs[0];
          }
        }

        // Validate that we can actually extract candidate types from stats Map
        if (activePair) {
          const localCandidate = activePair.localCandidateId ? statsMap.get(activePair.localCandidateId) as any : null;
          const remoteCandidate = activePair.remoteCandidateId ? statsMap.get(activePair.remoteCandidateId) as any : null;
          if (!localCandidate || !remoteCandidate) {
            // Stats are not fully ready yet, discard and retry
            activePair = null;
          }
        }
      } catch (e) {
        console.warn('Error reading WebRTC stats during candidate detection:', e);
      }

      if (!activePair) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        retries--;
      }
    }

    if (activePair) {
      const localCandidate = activePair.localCandidateId ? statsMap.get(activePair.localCandidateId) as any : null;
      const remoteCandidate = activePair.remoteCandidateId ? statsMap.get(activePair.remoteCandidateId) as any : null;

      console.log('[WebRTC] Active Candidate Pair Local:', localCandidate?.candidateType, 'Remote:', remoteCandidate?.candidateType);

      if (
        (localCandidate && localCandidate.candidateType === 'relay') ||
        (remoteCandidate && remoteCandidate.candidateType === 'relay')
      ) {
        isRelay = true;
      }
    } else {
      // Default to direct P2P if active pair stats aren't loaded yet to prevent false blockers
      console.log('[WebRTC] No active candidate pair found in stats after timeout, defaulting to P2P.');
      isRelay = false;
    }

    console.log('[WebRTC Connection Type]', isRelay ? 'TURN RELAY' : 'DIRECT P2P');
    this.updateStatus(isRelay ? 'connected-turn' : 'connected-p2p');
  }

  /**
   * Disconnects and cleans up all active peer allocations
   */
  public cleanup(manual = false): void {
    this.releaseWakeLock();
    if (manual && this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        this.dataChannel.send(JSON.stringify({ type: 'disconnect' }));
        console.log('[WebRTC] Sent manual disconnect notification to peer');
      } catch (e) {
        console.warn('Failed to send manual disconnect notification:', e);
      }
    }
    if (this.unsubscribeRoom) {
      this.unsubscribeRoom();
      this.unsubscribeRoom = null;
    }
    if (this.unsubscribeCandidates) {
      this.unsubscribeCandidates();
      this.unsubscribeCandidates = null;
    }
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.roomCode = null;
    this.updateStatus('disconnected');
  }

  private updateStatus(status: ConnectionStatus): void {
    if (this.onStatusChange) {
      this.onStatusChange(status);
    }
  }
}

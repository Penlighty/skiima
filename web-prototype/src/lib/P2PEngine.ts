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

const CHUNK_SIZE = 16 * 1024; // 16KB chunks (optimal for WebRTC MTU size)
const BUFFER_THRESHOLD = 256 * 1024; // 256KB buffer threshold to prevent memory overflows

/**
 * Builds the ICE server list at runtime.
 * Uses Metered.ca production TURN servers when credentials are provided via env vars.
 * Server URLs are taken directly from Metered's "Show ICE Servers Array" output.
 */
function buildIceServers(): RTCIceServer[] {
  const meteredUser = import.meta.env.VITE_METERED_USERNAME;
  const meteredCred = import.meta.env.VITE_METERED_CREDENTIAL;

  if (meteredUser && meteredCred) {
    // Exact config from Metered.ca "Show ICE Servers Array"
    return [
      { urls: 'stun:stun.relay.metered.ca:80' },
      {
        urls: 'turn:global.relay.metered.ca:80',
        username: meteredUser,
        credential: meteredCred,
      },
      {
        urls: 'turn:global.relay.metered.ca:80?transport=tcp',
        username: meteredUser,
        credential: meteredCred,
      },
      {
        urls: 'turn:global.relay.metered.ca:443',
        username: meteredUser,
        credential: meteredCred,
      },
      {
        urls: 'turns:global.relay.metered.ca:443?transport=tcp',
        username: meteredUser,
        credential: meteredCred,
      },
    ];
  }

  // Fallback: openrelay demo (free but unreliable — only TCP 443 entries kept)
  console.warn('[ICE] No Metered credentials found. Using openrelay fallback. ' +
    'Set VITE_METERED_USERNAME + VITE_METERED_CREDENTIAL in Vercel for reliable TURN.');
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: [
        'turns:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ];
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

  // Callbacks for UI updates
  public onStatusChange?: (status: ConnectionStatus) => void;
  public onPeerIdReady?: (id: string) => void;
  public onMetadataReceived?: (metadata: FileMetadata) => void;
  public onProgress?: (stats: TransferStats) => void;
  public onTransferComplete?: (downloadUrl?: string) => void;
  public onError?: (error: string) => void;
  public onPeerHandshake?: (peerId: string, peerName: string) => void;

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

    const peerOptions: RTCConfiguration = {
      iceServers: buildIceServers(),
      iceTransportPolicy: 'all'
    };

    try {
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
        if (pc.connectionState === 'failed') {
          console.warn('[WebRTC] Sender connection failed, attempting ICE restart...');
          pc.restartIce();
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
          this.updateStatus('disconnected');
        }
        // NOTE: 'connected' status is set from dc.onopen to guarantee DataChannel is ready
      };

      pc.onicecandidateerror = (ev: RTCPeerConnectionIceErrorEvent) => {
        console.warn('[ICE] Candidate error:', ev.errorCode, ev.errorText, ev.url);
      };

      // Create the WebRTC Session Offer
      (async () => {
        try {
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
          console.error('[WebRTC] Error during negotiation initialization:', err);
          if (this.onError) this.onError(err.message || 'Failed to negotiate WebRTC offer.');
          this.updateStatus('disconnected');
        }
      })();

    } catch (e: any) {
      console.error('[WebRTC] Initialization failed:', e);
      if (this.onError) {
        this.onError(e.message || 'Failed to instantiate RTCPeerConnection.');
      }
      this.updateStatus('disconnected');
    }
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

    const peerOptions: RTCConfiguration = {
      iceServers: buildIceServers(),
      iceTransportPolicy: 'all'
    };

    try {
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
        if (pc.connectionState === 'failed') {
          console.warn('[WebRTC] Receiver connection failed, attempting ICE restart...');
          pc.restartIce();
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
          this.updateStatus('disconnected');
        }
        // NOTE: 'connected' status is set from dc.onopen to guarantee DataChannel is ready
      };

      pc.onicecandidateerror = (ev: RTCPeerConnectionIceErrorEvent) => {
        console.warn('[ICE] Candidate error:', ev.errorCode, ev.errorText, ev.url);
      };

      // Retrieve Offer SDP from Firestore and generate Answer SDP
      (async () => {
        try {
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

    } catch (e: any) {
      console.error('[WebRTC] Receiver initialization failed:', e);
      if (this.onError) {
        this.onError(e.message || 'Failed to instantiate RTCPeerConnection.');
      }
      this.updateStatus('disconnected');
    }
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

    const metadata: FileMetadata = {
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
    };

    // 1. Send file metadata as JSON string
    this.dataChannel.send(JSON.stringify({ type: 'metadata', data: metadata }));

    // 2. Start chunked file transmission
    const fileReader = new FileReader();
    let offset = 0;
    const totalSize = file.size;
    let chunkIndex = 0;
    
    let startTime = Date.now();
    let lastStatsTime = Date.now();

    const readNextChunk = () => {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      fileReader.readAsArrayBuffer(slice);
    };

    fileReader.onload = async (e) => {
      if (e.target?.result instanceof ArrayBuffer) {
        const buffer = e.target.result;

        // Apply backpressure using RTCDataChannel's bufferedAmount
        if (this.dataChannel && this.dataChannel.bufferedAmount > BUFFER_THRESHOLD) {
          await this.waitBufferLow(this.dataChannel);
        }

        // Send the raw binary chunk directly
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
          this.dataChannel.send(buffer);

          offset += buffer.byteLength;
          chunkIndex++;

          // Real-time speed metrics calculation
          const now = Date.now();
          if (now - lastStatsTime >= 200 || offset === totalSize) {
            const timePassed = (now - startTime) / 1000;
            const currentSpeed = offset / timePassed; // bytes/sec
            const remainingBytes = totalSize - offset;
            const timeRemaining = remainingBytes / (currentSpeed || 1);

            if (this.onProgress) {
              this.onProgress({
                progress: Math.min((offset / totalSize) * 100, 100),
                speed: currentSpeed,
                bytesTransferred: offset,
                timeRemaining: Math.max(0, Math.round(timeRemaining)),
              });
            }
            lastStatsTime = now;
          }

          if (offset < totalSize) {
            readNextChunk();
          } else {
            // Signal completed transfer as JSON string
            this.dataChannel.send(JSON.stringify({ type: 'done' }));
            if (this.onTransferComplete) {
              this.onTransferComplete();
            }
          }
        }
      }
    };

    fileReader.onerror = () => {
      if (this.onError) {
        this.onError('Error reading file chunk.');
      }
    };

    // Initiate first chunk read
    readNextChunk();
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

    dc.onclose = () => {
      console.log('[WebRTC] RTCDataChannel closed');
      this.updateStatus('disconnected');
      // Don't call full cleanup() here — let the connection state handler manage it
    };

    dc.onerror = (err) => {
      console.error('[WebRTC] RTCDataChannel error:', err);
      if (this.onError) {
        this.onError('P2P connection experienced an engine failure.');
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

          const now = Date.now();
          if (now - lastStatsTime >= 200 || bytesReceived === receivedMetadata.size) {
            const timePassed = (now - startTime) / 1000;
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
                receivedMetadata = control.data as FileMetadata;
                receivedChunks = [];
                bytesReceived = 0;
                startTime = Date.now();
                lastStatsTime = Date.now();
                if (this.onMetadataReceived) {
                  this.onMetadataReceived(receivedMetadata);
                }
                break;

              case 'done':
                if (receivedMetadata && receivedChunks.length > 0) {
                  // Reassemble the incoming file chunks into a single Blob
                  const fileBlob = new Blob(receivedChunks, { type: receivedMetadata.type });
                  const downloadUrl = URL.createObjectURL(fileBlob);
                  if (this.onTransferComplete) {
                    this.onTransferComplete(downloadUrl);
                  }
                  // Clean up buffer
                  receivedChunks = [];
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
  public cleanup(): void {
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

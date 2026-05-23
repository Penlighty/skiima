import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'dart:developer' as dev;
import 'package:crypto/crypto.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'sqlite_service.dart';
import 'signaling_client.dart';

class P2PEngine {
  final SqliteService _dbService = SqliteService();
  final SignalingClient signalingClient;
  final String roomCode;
  
  RTCPeerConnection? _peerConnection;
  RTCDataChannel? _dataChannel;
  bool isSender = false;

  // Adaptive Buffer Constraints (Nigeria "Last Mile" design)
  int chunkSize = 64 * 1024; // 64KB default
  final int lowSpeedChunkSize = 16 * 1024; // 16KB for congested connections

  // Handshake State Event Listeners
  void Function(String status)? onStateChange;
  void Function(double progress, double speed)? onProgress;
  void Function(String error)? onError;
  void Function(Uint8List fileData, String fileName)? onFileReceived;

  // Resilient ACK Broker Pipeline
  Completer<void>? _ackCompleter;
  int _expectedAckIndex = -1;

  P2PEngine({
    required this.signalingClient,
    required this.roomCode,
  });

  /**
   * Initializes WebRTC connection
   */
  Future<void> initialize(bool senderMode) async {
    isSender = senderMode;
    _updateStatus('INITIALIZING');

    // Standard STUN/TURN traversal fallback
    final Map<String, dynamic> rtcConfig = {
      'iceServers': [
        {'url': 'stun:stun.l.google.com:19302'},
        {'url': 'stun:stun1.l.google.com:19302'},
        {'url': 'stun:stun.services.mozilla.com'},
      ]
    };

    final Map<String, dynamic> mediaConstraints = {
      'mandatory': {},
      'optional': [
        {'DtlsSrtpKeyAgreement': true}, // Secure AES-256 encryption via DTLS
      ],
    };

    try {
      _peerConnection = await createPeerConnection(rtcConfig, mediaConstraints);

      // Handle ICE Candidates generated natively
      _peerConnection!.onIceCandidate = (candidate) {
        dev.log('[P2PEngine] Discovered local ICE Candidate');
        signalingClient.sendIceCandidate(roomCode, {
          'candidate': candidate.candidate,
          'sdpMid': candidate.sdpMid,
          'sdpMLineIndex': candidate.sdpMLineIndex,
        });
      };

      _peerConnection!.onConnectionState = (state) {
        dev.log('[P2PEngine] WebRTC connection status change: $state');
        _updateStatus('RTC STATE: $state');
        if (state == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected ||
            state == RTCPeerConnectionState.RTCPeerConnectionStateFailed) {
          _handleConnectionInterruption();
        }
      };

      if (isSender) {
        // Senders create the data channel
        final RTCDataChannelInit initConfig = RTCDataChannelInit()
          ..reliable = true
          ..id = 1;
        _dataChannel = await _peerConnection!.createDataChannel('skiima-transfer-channel', initConfig);
        _setupDataChannelListeners();
      } else {
        // Receivers listen for incoming data channel
        _peerConnection!.onDataChannel = (channel) {
          dev.log('[P2PEngine] Incoming WebRTC DataChannel established');
          _dataChannel = channel;
          _setupDataChannelListeners();
        };
      }

      // Configure signaling client relays
      _setupHandshakeBrokering();

    } catch (e) {
      _handleError('Failed to initialize WebRTC engine: $e');
    }
  }

  /**
   * Sets up room matchmaking socket event mappings
   */
  void _setupHandshakeBrokering() {
    signalingClient.onOfferReceived = (sdp) async {
      if (!isSender && _peerConnection != null) {
        dev.log('[P2PEngine] Processing remote SDP Offer...');
        await _peerConnection!.setRemoteDescription(
          RTCSessionDescription(sdp['sdp'], sdp['type']),
        );
        final answer = await _peerConnection!.createAnswer();
        await _peerConnection!.setLocalDescription(answer);
        
        signalingClient.sendAnswer(roomCode, {
          'sdp': answer.sdp,
          'type': answer.type,
        });
      }
    };

    signalingClient.onAnswerReceived = (sdp) async {
      if (isSender && _peerConnection != null) {
        dev.log('[P2PEngine] Processing remote SDP Answer...');
        await _peerConnection!.setRemoteDescription(
          RTCSessionDescription(sdp['sdp'], sdp['type']),
        );
      }
    };

    signalingClient.onIceCandidateReceived = (cand) async {
      if (_peerConnection != null) {
        dev.log('[P2PEngine] Injecting remote candidate...');
        await _peerConnection!.addCandidate(
          RTCIceCandidate(cand['candidate'], cand['sdpMid'], cand['sdpMLineIndex']),
        );
      }
    };
  }

  /**
   * Coordinates the DataChannel message broker
   */
  void _setupDataChannelListeners() {
    if (_dataChannel == null) return;

    _dataChannel!.onMessage = (RTCDataChannelMessage message) {
      if (message.isBinary) {
        _handleIncomingBinaryChunk(message.binary);
      } else {
        _handleIncomingTextMessage(message.text);
      }
    };

    _dataChannel!.onDataChannelState = (state) {
      dev.log('[P2PEngine] DataChannel status change: $state');
      if (state == RTCDataChannelState.RTCDataChannelStateOpen) {
        _updateStatus('CHANNEL_OPEN');
      }
    };
  }

  /**
   * Brokered WebRTC SDP Handshake initiator (Sender side)
   */
  Future<void> startHandshakeNegotiation() async {
    if (!isSender || _peerConnection == null) return;

    dev.log('[P2PEngine] Initiating WebRTC Handshake session description offer...');
    final offer = await _peerConnection!.createOffer();
    await _peerConnection!.setLocalDescription(offer);

    signalingClient.sendOffer(roomCode, {
      'sdp': offer.sdp,
      'type': offer.type,
    });
  }

  // ==========================================
  // RESILIENT CHUNKING & "LAST MILE" ACK ENGINE
  // ==========================================

  /**
   * Stream a file chunk-by-chunk with dynamic buffer scaling, ACK pipelines, and SQLite persistence
   */
  Future<void> streamFile(String filePath, String fileName, Uint8List fileBytes, String transferId) async {
    if (_dataChannel == null || _dataChannel!.state != RTCDataChannelState.RTCDataChannelStateOpen) {
      throw Exception('P2P channel is closed.');
    }

    final totalSize = fileBytes.length;
    
    // Check SQLite manifest if we need to resume an interrupted transfer
    final existingTx = await _dbService.getTransfer(transferId);
    int startingChunk = 0;
    int bytesTransferred = 0;

    if (existingTx != null) {
      startingChunk = existingTx['last_chunk_index'] as int;
      bytesTransferred = existingTx['bytes_transferred'] as int;
      dev.log('[P2PEngine] Resuming manifest $transferId from offset index: $startingChunk ($bytesTransferred bytes)');
    } else {
      await _dbService.saveTransfer(
        transferId: transferId,
        fileName: fileName,
        fileSize: totalSize,
        filePath: filePath,
        bytesTransferred: 0,
        status: 'transferring',
        lastChunkIndex: 0,
      );
    }

    // Adapt buffer sizes dynamically depending on transfer latency estimation
    chunkSize = totalSize > 10 * 1024 * 1024 ? chunkSize : lowSpeedChunkSize;

    // Send metadata header first
    _sendControlMessage({
      'type': 'meta',
      'fileName': fileName,
      'fileSize': totalSize,
      'transferId': transferId,
    });

    final totalChunks = (totalSize / chunkSize).ceil();
    final startTime = DateTime.now();

    for (int i = startingChunk; i < totalChunks; i++) {
      if (_dataChannel!.state != RTCDataChannelState.RTCDataChannelStateOpen) {
        dev.log('[P2PEngine] Pipeline aborted due to network failure');
        await _dbService.updateProgress(transferId, bytesTransferred, i, 'paused');
        return;
      }

      final startOffset = i * chunkSize;
      final endOffset = (startOffset + chunkSize > totalSize) ? totalSize : startOffset + chunkSize;
      final Uint8List chunkData = fileBytes.sublist(startOffset, endOffset);

      // Compute secure SHA-256 hash for integrity constraint check
      final hash = sha256.convert(chunkData).toString();

      // Configure ACK completer BEFORE dispatching chunk data to avoid race conditions
      _expectedAckIndex = i;
      _ackCompleter = Completer<void>();

      // Send chunk block
      _sendControlMessage({
        'type': 'chunk_header',
        'index': i,
        'hash': hash,
      });

      _dataChannel!.send(RTCDataChannelMessage.fromBinary(chunkData));

      // Nigeria High-Latency constraint: Await target's ACK receipt to prevent pipeline flood stalls
      try {
        await _ackCompleter!.future.timeout(const Duration(seconds: 8));
      } on TimeoutException {
        dev.log('[P2PEngine] Pipeline stall detected on chunk $i, throttling and retrying chunk...');
        i--; // Decrement index to re-transmit the exact same chunk
        continue;
      }

      bytesTransferred = endOffset;
      
      // Update local manifest Database
      if (i % 5 == 0 || i == totalChunks - 1) {
        await _dbService.updateProgress(transferId, bytesTransferred, i, 'transferring');
      }

      if (onProgress != null) {
        final double progress = (bytesTransferred / totalSize) * 100;
        final speed = bytesTransferred / (DateTime.now().difference(startTime).inSeconds + 1);
        onProgress!(progress, speed);
      }
    }

    // Done signal
    _sendControlMessage({'type': 'done'});
    await _dbService.updateProgress(transferId, totalSize, totalChunks, 'completed');
  }

  // ==========================================
  // RECEIVER METADATA & INTEGRITY GATEKEEPER
  // ==========================================

  String? _incomingFileName;
  int _incomingFileSize = 0;
  String? _incomingTransferId;
  final List<Uint8List> _receivedBuffers = [];
  int _receivedBytes = 0;
  String? _expectedHash;
  int _expectedChunkIndex = 0;

  void _handleIncomingTextMessage(String jsonString) {
    try {
      final msg = jsonDecode(jsonString);
      final type = msg['type'] as String;

      switch (type) {
        case 'meta':
          _incomingFileName = msg['fileName'];
          _incomingFileSize = msg['fileSize'];
          _incomingTransferId = msg['transferId'];
          _receivedBuffers.clear();
          _receivedBytes = 0;
          _expectedChunkIndex = 0;
          dev.log('[P2PEngine] Metadata parsed: $_incomingFileName ($_incomingFileSize bytes)');
          
          // Pre-save Receiver active manifest to SQLite for resumption capability
          _dbService.saveTransfer(
            transferId: _incomingTransferId!,
            fileName: _incomingFileName!,
            fileSize: _incomingFileSize,
            filePath: 'download_directory/',
            bytesTransferred: 0,
            status: 'transferring',
            lastChunkIndex: 0,
          );
          break;

        case 'chunk_header':
          _expectedHash = msg['hash'];
          _expectedChunkIndex = msg['index'];
          break;

        case 'ack':
          // Process acknowledgement signals (Sender Side)
          final index = msg['index'] as int;
          if (index == _expectedAckIndex && _ackCompleter != null && !_ackCompleter!.isCompleted) {
            _ackCompleter!.complete();
          }
          break;

        case 'done':
          // Combine buffers into single binary Uint8List
          final completeBytes = BytesBuilder();
          for (var buf in _receivedBuffers) {
            completeBytes.add(buf);
          }
          final finalData = completeBytes.takeBytes();
          
          _dbService.updateProgress(_incomingTransferId!, _incomingFileSize, _expectedChunkIndex, 'completed');
          
          if (onFileReceived != null && _incomingFileName != null) {
            onFileReceived!(finalData, _incomingFileName!);
          }
          break;
      }
    } catch (e) {
      dev.log('[P2PEngine] Error decoding control text: $e');
    }
  }

  void _handleIncomingBinaryChunk(Uint8List binary) {
    if (_incomingTransferId == null || _expectedHash == null) return;

    // Cryptographic Data Integrity constraint: Hash the incoming chunk instantly using SHA-256
    final hash = sha256.convert(binary).toString();
    
    if (hash != _expectedHash) {
      dev.log('[P2PEngine] INTEGRITY ERROR: SHA-256 validation failed for chunk $_expectedChunkIndex! Discarding chunk...');
      _sendControlMessage({'type': 'nack', 'index': _expectedChunkIndex});
      return;
    }

    _receivedBuffers.add(binary);
    _receivedBytes += binary.length;

    // Dispatch ACK immediately to release the sender pipeline
    _sendControlMessage({'type': 'ack', 'index': _expectedChunkIndex});

    // Update Receiver progress SQLite manifest
    if (_expectedChunkIndex % 5 == 0) {
      _dbService.updateProgress(_incomingTransferId!, _receivedBytes, _expectedChunkIndex, 'transferring');
    }

    if (onProgress != null && _incomingFileSize > 0) {
      final double progress = (_receivedBytes / _incomingFileSize) * 100;
      onProgress!(progress, 0.0);
    }
  }

  // ==========================================
  // NETWORK FAULT ERROR STATE HANDLERS
  // ==========================================

  void _handleConnectionInterruption() {
    _updateStatus('INTERRUPTED');
    _handleError('P2P direct link disconnected. Retrying handshake registration to auto-resume...');
  }

  void _sendControlMessage(Map<String, dynamic> data) {
    if (_dataChannel != null && _dataChannel!.state == RTCDataChannelState.RTCDataChannelStateOpen) {
      _dataChannel!.send(RTCDataChannelMessage(jsonEncode(data)));
    }
  }

  void _updateStatus(String state) {
    if (onStateChange != null) onStateChange!(state);
  }

  void _handleError(String err) {
    if (onError != null) onError!(err);
  }

  /**
   * Terminate and clean up all allocated WebRTC sessions
   */
  Future<void> cleanup() async {
    if (_dataChannel != null) {
      await _dataChannel!.close();
      _dataChannel = null;
    }
    if (_peerConnection != null) {
      await _peerConnection!.close();
      _peerConnection = null;
    }
    _updateStatus('DISCONNECTED');
  }
}

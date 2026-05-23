import 'dart:developer' as dev;
import 'package:socket_io_client/socket_io_client.dart' as io;

class SignalingClient {
  io.Socket? _socket;
  final String serverUrl;

  // Handshake Event Callbacks
  void Function()? onConnected;
  void Function()? onDisconnected;
  void Function(String peerId)? onPeerJoined;
  void Function(Map<String, dynamic> sdp)? onOfferReceived;
  void Function(Map<String, dynamic> sdp)? onAnswerReceived;
  void Function(Map<String, dynamic> candidate)? onIceCandidateReceived;
  void Function(String error)? onError;

  SignalingClient({required this.serverUrl});

  /**
   * Establishes connection to the stateless signaling socket broker
   */
  void connect() {
    dev.log('[SignalingClient] Connecting to signaling broker: $serverUrl');
    
    try {
      _socket = io.io(
        serverUrl,
        io.OptionBuilder()
            .setTransports(['websocket']) // Force WebSocket only for raw performance
            .enableAutoConnect()
            .build(),
      );

      _socket!.onConnect((_) {
        dev.log('[SignalingClient] Socket connected successfully: ${_socket!.id}');
        if (onConnected != null) onConnected!();
      });

      _socket!.onDisconnect((_) {
        dev.log('[SignalingClient] Socket disconnected');
        if (onDisconnected != null) onDisconnected!();
      });

      _socket!.onConnectError((err) {
        dev.log('[SignalingClient] Connection error: $err');
        if (onError != null) onError!('Connection error: $err');
      });

      // ==========================================
      // WEBSOCKET HANDSHAKE PROTOCOL LISTENERS
      // ==========================================

      /**
       * Listener: peer-joined
       * Triggers when the target recipient registers in the room
       */
      _socket!.on('peer-joined', (data) {
        if (data != null && data['peerId'] != null) {
          final peerId = data['peerId'] as String;
          dev.log('[SignalingClient] Remote peer joined: $peerId');
          if (onPeerJoined != null) onPeerJoined!(peerId);
        }
      });

      /**
       * Listener: receive-offer
       * Relay sender's session description down to the receiver
       */
      _socket!.on('receive-offer', (data) {
        if (data != null && data['sdp'] != null) {
          dev.log('[SignalingClient] WebRTC SDP Offer received');
          final sdp = Map<String, dynamic>.from(data['sdp']);
          if (onOfferReceived != null) onOfferReceived!(sdp);
        }
      });

      /**
       * Listener: receive-answer
       * Relay receiver's session description back to the sender
       */
      _socket!.on('receive-answer', (data) {
        if (data != null && data['sdp'] != null) {
          dev.log('[SignalingClient] WebRTC SDP Answer received');
          final sdp = Map<String, dynamic>.from(data['sdp']);
          if (onAnswerReceived != null) onAnswerReceived!(sdp);
        }
      });

      /**
       * Listener: relay-ice
       * Relay hole-punching configurations between both devices
       */
      _socket!.on('relay-ice', (data) {
        if (data != null && data['candidate'] != null) {
          dev.log('[SignalingClient] Remote ICE Candidate candidate received');
          final candidate = Map<String, dynamic>.from(data['candidate']);
          if (onIceCandidateReceived != null) onIceCandidateReceived!(candidate);
        }
      });
      
    } catch (e) {
      dev.log('[SignalingClient] Failed to initialize socket connection: $e');
      if (onError != null) onError!('Initialization failed: $e');
    }
  }

  // ==========================================
  // PROTOCOL DISPATCH ACTIONS
  // ==========================================

  /**
   * Joins matching broker room
   * @param roomCode The easily shareable 6-digit room key
   * @param peerId Local Client UUID
   */
  void joinRoom(String roomCode, String peerId) {
    if (_socket == null || !_socket!.connected) return;
    dev.log('[SignalingClient] Registering room: $roomCode (Peer: $peerId)');
    _socket!.emit('join-room', {
      'roomCode': roomCode,
      'peerId': peerId,
    });
  }

  /**
   * Emits WebRTC Offer SDP
   */
  void sendOffer(String roomCode, Map<String, dynamic> sdp) {
    if (_socket == null || !_socket!.connected) return;
    dev.log('[SignalingClient] Dispatching WebRTC Offer SDP to room: $roomCode');
    _socket!.emit('sdp-offer', {
      'roomCode': roomCode,
      'sdp': sdp,
    });
  }

  /**
   * Emits WebRTC Answer SDP
   */
  void sendAnswer(String roomCode, Map<String, dynamic> sdp) {
    if (_socket == null || !_socket!.connected) return;
    dev.log('[SignalingClient] Dispatching WebRTC Answer SDP to room: $roomCode');
    _socket!.emit('sdp-answer', {
      'roomCode': roomCode,
      'sdp': sdp,
    });
  }

  /**
   * Emits network ICE Candidate
   */
  void sendIceCandidate(String roomCode, Map<String, dynamic> candidate) {
    if (_socket == null || !_socket!.connected) return;
    dev.log('[SignalingClient] Dispatching local ICE Candidate to room: $roomCode');
    _socket!.emit('ice-candidate', {
      'roomCode': roomCode,
      'candidate': candidate,
    });
  }

  /**
   * Terminate active socket broker connections
   */
  void disconnect() {
    if (_socket != null) {
      _socket!.disconnect();
      _socket = null;
      dev.log('[SignalingClient] Disconnected manually');
    }
  }
}

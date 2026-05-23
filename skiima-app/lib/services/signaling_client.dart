import 'dart:async';
import 'dart:developer' as dev;
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';

class SignalingClient {
  final String serverUrl; // Kept for constructor/interface compatibility

  // Handshake Event Callbacks
  void Function()? onConnected;
  void Function()? onDisconnected;
  void Function(String peerId)? onPeerJoined;
  void Function(Map<String, dynamic> sdp)? onOfferReceived;
  void Function(Map<String, dynamic> sdp)? onAnswerReceived;
  void Function(Map<String, dynamic> candidate)? onIceCandidateReceived;
  void Function(String error)? onError;

  StreamSubscription? _roomSub;
  StreamSubscription? _candidatesSub;
  bool _isSender = true;

  SignalingClient({required this.serverUrl});

  /**
   * Establishes connection to Firestore signaling broker
   */
  Future<void> connect() async {
    dev.log('[SignalingClient] Connecting to Firestore signaling broker...');
    try {
      // Lazy initialize Firebase if it has not been done yet in main
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp();
      }
      dev.log('[SignalingClient] Firestore signaling broker initialized successfully');
      if (onConnected != null) onConnected!();
    } catch (e) {
      dev.log('[SignalingClient] Failed to initialize Firebase: $e');
      if (onError != null) onError!('Firebase initialization failed: $e');
    }
  }

  /**
   * Joins matching broker room in Firestore
   * @param roomCode The easily shareable 6-digit room key
   * @param peerId Local Client UUID
   */
  void joinRoom(String roomCode, String peerId) async {
    dev.log('[SignalingClient] Registering room: $roomCode (Peer: $peerId)');
    final roomRef = FirebaseFirestore.instance.collection('rooms').doc(roomCode);

    try {
      // Cleanup any active connections first
      await _cleanupListeners();

      // Determine sender/receiver role based on whether an offer document exists
      final docSnap = await roomRef.get();
      bool localIsSender = true;
      if (docSnap.exists) {
        final data = docSnap.data();
        if (data != null && data.containsKey('offer')) {
          localIsSender = false;
        }
      }
      _isSender = localIsSender;
      dev.log('[SignalingClient] Determined role for room $roomCode: ${_isSender ? "SENDER" : "RECEIVER"}');

      // 1. Subscribe to changes in the room document (for SDP exchanges)
      _roomSub = roomRef.snapshots().listen((snapshot) {
        if (!snapshot.exists) return;
        final data = snapshot.data();
        if (data == null) return;

        // Receiver processes incoming SDP Offer
        if (!_isSender && data.containsKey('offer') && onOfferReceived != null) {
          final offerMap = Map<String, dynamic>.from(data['offer']);
          dev.log('[SignalingClient] WebRTC SDP Offer received via Firestore');
          onOfferReceived!(offerMap);
        }

        // Sender processes incoming SDP Answer
        if (_isSender && data.containsKey('answer') && onAnswerReceived != null) {
          final answerMap = Map<String, dynamic>.from(data['answer']);
          dev.log('[SignalingClient] WebRTC SDP Answer received via Firestore');
          onAnswerReceived!(answerMap);

          // Once answer is received, it means receiver joined! Trigger callback
          if (onPeerJoined != null) {
            onPeerJoined!('receiver');
          }
        }
      }, onError: (err) {
        dev.log('[SignalingClient] Firestore Room Error: $err');
        if (onError != null) onError!('Room sync error: $err');
      });

      // 2. Subscribe to remote ICE Candidates
      final oppositeCollection = _isSender ? 'receiverCandidates' : 'senderCandidates';
      _candidatesSub = roomRef.collection(oppositeCollection).snapshots().listen((snapshot) {
        for (var change in snapshot.docChanges) {
          if (change.type == DocumentChangeType.added) {
            final candidateData = change.doc.data();
            if (candidateData != null && onIceCandidateReceived != null) {
              dev.log('[SignalingClient] Remote ICE Candidate received via Firestore');
              onIceCandidateReceived!(Map<String, dynamic>.from(candidateData));
            }
          }
        }
      }, onError: (err) {
        dev.log('[SignalingClient] Firestore Candidates Sync Error: $err');
      });

    } catch (e) {
      dev.log('[SignalingClient] Failed to join room: $e');
      if (onError != null) onError!('Failed to join room: $e');
    }
  }

  /**
   * Emits WebRTC Offer SDP by writing to Firestore
   */
  void sendOffer(String roomCode, Map<String, dynamic> sdp) async {
    dev.log('[SignalingClient] Dispatching WebRTC Offer SDP to room doc: $roomCode');
    final roomRef = FirebaseFirestore.instance.collection('rooms').doc(roomCode);
    try {
      await roomRef.set({
        'offer': sdp,
        'createdAt': FieldValue.serverTimestamp(),
      });
    } catch (e) {
      dev.log('[SignalingClient] Error dispatching WebRTC offer: $e');
    }
  }

  /**
   * Emits WebRTC Answer SDP by updating Firestore room
   */
  void sendAnswer(String roomCode, Map<String, dynamic> sdp) async {
    dev.log('[SignalingClient] Dispatching WebRTC Answer SDP to room doc: $roomCode');
    final roomRef = FirebaseFirestore.instance.collection('rooms').doc(roomCode);
    try {
      await roomRef.update({
        'answer': sdp,
      });
    } catch (e) {
      dev.log('[SignalingClient] Error dispatching WebRTC answer: $e');
    }
  }

  /**
   * Emits network ICE Candidate by writing to corresponding subcollection
   */
  void sendIceCandidate(String roomCode, Map<String, dynamic> candidate) async {
    dev.log('[SignalingClient] Dispatching local ICE Candidate to Firestore: $roomCode');
    final roomRef = FirebaseFirestore.instance.collection('rooms').doc(roomCode);
    
    try {
      final subCollection = _isSender ? 'senderCandidates' : 'receiverCandidates';
      await roomRef.collection(subCollection).add(candidate);
    } catch (e) {
      dev.log('[SignalingClient] Error dispatching ICE candidate: $e');
    }
  }

  /**
   * Clean up active Firestore listeners
   */
  Future<void> _cleanupListeners() async {
    if (_roomSub != null) {
      await _roomSub!.cancel();
      _roomSub = null;
    }
    if (_candidatesSub != null) {
      await _candidatesSub!.cancel();
      _candidatesSub = null;
    }
  }

  /**
   * Terminate active signaling client
   */
  void disconnect() {
    _cleanupListeners().then((_) {
      dev.log('[SignalingClient] Disconnected manually');
      if (onDisconnected != null) onDisconnected!();
    });
  }
}

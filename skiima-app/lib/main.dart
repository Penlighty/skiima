import 'package:flutter/material';
import 'package:uuid/uuid.dart';
import 'services/sqlite_service.dart';
import 'services/signaling_client.dart';

void main() {
  runApp(const SkiimaApp());
}

class SkiimaApp extends StatelessWidget {
  const SkiimaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Skiima Share',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF8B5CF6),
          brightness: Brightness.dark,
          primary: const Color(0xFF8B5CF6),
          secondary: const Color(0xFF06B6D4),
          background: const Color(0xFF0B0C10),
          surface: const Color(0xFF12131C),
        ),
        fontFamily: 'Outfit',
      ),
      home: const DashboardScreen(),
    );
  }
}

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final SqliteService _dbService = SqliteService();
  late SignalingClient _signalingClient;
  
  final String _localPeerId = const Uuid().v4();
  String _signalingStatus = 'OFFLINE';
  String _roomCode = '';
  final TextEditingController _codeController = TextEditingController();

  List<Map<String, dynamic>> _contacts = [];
  List<Map<String, dynamic>> _activeTransfers = [];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    
    // Initialize our stateless Node.js signaling broker on localhost for initial debugging
    _signalingClient = SignalingClient(serverUrl: 'http://localhost:3000');
    _setupSignalingCallbacks();
    _signalingClient.connect();
    
    _refreshLocalData();
  }

  void _setupSignalingCallbacks() {
    _signalingClient.onConnected = () {
      setState(() {
        _signalingStatus = 'ONLINE (IDLE)';
      });
    };

    _signalingClient.onDisconnected = () {
      setState(() {
        _signalingStatus = 'OFFLINE';
      });
    };

    _signalingClient.onPeerJoined = (peerId) {
      setState(() {
        _signalingStatus = 'PEER JOINED ($peerId)';
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Contact peer connected: $peerId')),
      );
    };

    _signalingClient.onError = (err) {
      setState(() {
        _signalingStatus = 'ERROR';
      });
    };
  }

  Future<void> _refreshLocalData() async {
    final contactsList = await _dbService.getContacts();
    final transfersList = await _dbService.getActiveTransfers();
    setState(() {
      _contacts = contactsList;
      _activeTransfers = transfersList;
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    _codeController.dispose();
    _signalingClient.disconnect();
    super.dispose();
  }

  // ==========================================
  // HELPER USER ACTIONS
  // ==========================================

  void _generateRoomCode() {
    // Generate easily shareable 6-digit key
    final code = (100000 + (DateTime.now().millisecondsSinceEpoch % 900000)).toString();
    setState(() {
      _roomCode = code;
    });
    _signalingClient.joinRoom(code, _localPeerId);
  }

  void _connectToSender() {
    final enteredCode = _codeController.text.trim();
    if (enteredCode.length == 6) {
      _signalingClient.joinRoom(enteredCode, _localPeerId);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Handshaking with code: $enteredCode...')),
      );
    }
  }

  void _addNewContact() async {
    final peerIdController = TextEditingController();
    final nameController = TextEditingController();

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add Contact Peer'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: nameController,
              decoration: const InputDecoration(labelText: 'Contact Name'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: peerIdController,
              decoration: const InputDecoration(labelText: 'Peer ID (UUID)'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () async {
              if (nameController.text.isNotEmpty && peerIdController.text.isNotEmpty) {
                await _dbService.saveContact(peerIdController.text, nameController.text);
                _refreshLocalData();
                Navigator.pop(context);
              }
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Row(
          children: [
            Icon(Icons.flash_on, color: Color(0xFF8B5CF6)),
            SizedBox(width: 8),
            Text(
              'Skiima Share',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 24, letterSpacing: -0.5),
            ),
          ],
        ),
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 16),
            padding: const EdgeInsets.symmetric(horizontal: 12, py: 6),
            decoration: BoxDecoration(
              color: _signalingStatus.startsWith('ONLINE')
                  ? const Color(0xFF10B981).withOpacity(0.1)
                  : const Color(0xFFEF4444).withOpacity(0.1),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: _signalingStatus.startsWith('ONLINE')
                    ? const Color(0xFF10B981).withOpacity(0.3)
                    : const Color(0xFFEF4444).withOpacity(0.3),
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: _signalingStatus.startsWith('ONLINE')
                        ? const Color(0xFF10B981)
                        : const Color(0xFFEF4444),
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  _signalingStatus,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: _signalingStatus.startsWith('ONLINE')
                        ? const Color(0xFF10B981)
                        : const Color(0xFFEF4444),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Tab Bar
            TabBar(
              controller: _tabController,
              indicatorColor: Theme.of(context).colorScheme.primary,
              labelColor: Colors.white,
              unselectedLabelColor: Colors.grey,
              tabs: const [
                Tab(icon: Icon(Icons.send), text: 'Send File'),
                Tab(icon: Icon(Icons.download), text: 'Receive File'),
              ],
            ),
            const SizedBox(height: 16),
            
            // Tab View Panel
            Expanded(
              flex: 4,
              child: TabBarView(
                controller: _tabController,
                children: [
                  // --- SEND TAB PANEL ---
                  Card(
                    color: Theme.of(context).colorScheme.surface,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    child: Padding(
                      padding: const EdgeInsets.all(20.0),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.cloud_upload_outlined, size: 64, color: Color(0xFF8B5CF6)),
                          const SizedBox(height: 12),
                          const Text(
                            'True direct browser-to-browser streaming',
                            textAlign: TextAlign.center,
                            style: TextStyle(fontSize: 14, color: Colors.grey),
                          ),
                          const SizedBox(height: 24),
                          if (_roomCode.isEmpty)
                            ElevatedButton.icon(
                              onPressed: _generateRoomCode,
                              icon: const Icon(Icons.key),
                              label: const Text('Generate 6-Digit Share Key'),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: Theme.of(context).colorScheme.primary,
                                foregroundColor: Colors.white,
                                minimumSize: const Size(double.infinity, 50),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                              ),
                            )
                          else
                            Column(
                              children: [
                                const Text('Waiting for receiver. Share code:'),
                                const SizedBox(height: 8),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                                  decoration: BoxDecoration(
                                    color: Colors.black.withOpacity(0.3),
                                    borderRadius: BorderRadius.circular(12),
                                    border: Border.all(color: Colors.white10),
                                  ),
                                  child: Text(
                                    _roomCode,
                                    style: const TextStyle(
                                      fontSize: 32,
                                      fontWeight: FontWeight.bold,
                                      letterSpacing: 4,
                                      color: Color(0xFF8B5CF6),
                                    ),
                                  ),
                                ),
                              ],
                            )
                        ],
                      ),
                    ),
                  ),

                  // --- RECEIVE TAB PANEL ---
                  Card(
                    color: Theme.of(context).colorScheme.surface,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    child: Padding(
                      padding: const EdgeInsets.all(20.0),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.downloading, size: 64, color: Color(0xFF06B6D4)),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _codeController,
                            keyboardType: TextInputType.number,
                            maxLength: 6,
                            textAlign: TextAlign.center,
                            style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: 4),
                            decoration: InputDecoration(
                              hintText: 'e.g. 528939',
                              counterText: '',
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                            ),
                          ),
                          const SizedBox(height: 16),
                          ElevatedButton.icon(
                            onPressed: _connectToSender,
                            icon: const Icon(Icons.flash_on),
                            label: const Text('Connect & Begin Handshake'),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Theme.of(context).colorScheme.secondary,
                              foregroundColor: Colors.white,
                              minimumSize: const Size(double.infinity, 50),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                            ),
                          )
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),

            // --- LOCAL ACTIVE TRANSFERS MANIFEST VIEW (SQLite integrated) ---
            const Text(
              'Active & Paused Transfers Manifest',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
            ),
            const SizedBox(height: 8),
            Expanded(
              flex: 3,
              child: _activeTransfers.isEmpty
                  ? Center(
                      child: Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: Theme.of(context).colorScheme.surface,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: const Text('No active manifests in theSQLite resume queue.', style: TextStyle(color: Colors.grey, fontSize: 12)),
                      ),
                    )
                  : ListView.builder(
                      itemCount: _activeTransfers.length,
                      itemBuilder: (context, index) {
                        final tx = _activeTransfers[index];
                        return Card(
                          margin: const EdgeInsets.only(bottom: 8),
                          color: Theme.of(context).colorScheme.surface,
                          child: ListTile(
                            leading: const Icon(Icons.file_present, color: Color(0xFF8B5CF6)),
                            title: Text(tx['file_name']),
                            subtitle: Text('Progress: ${tx['bytes_transferred']} / ${tx['file_size']} bytes (Offset index: ${tx['last_chunk_index']})'),
                            trailing: IconButton(
                              icon: const Icon(Icons.play_arrow, color: Color(0xFF10B981)),
                              onPressed: () {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(content: Text('Auto-resuming from index ${tx['last_chunk_index']}...')),
                                );
                              },
                            ),
                          ),
                        );
                      },
                    ),
            ),
            const SizedBox(height: 16),

            // --- CONTACTS / PEERS LOCAL DIRECTORY (SQLite integrated) ---
            Row(
              mainAxisAlignment: MainAxisAlignment.between,
              children: [
                const Text(
                  'Local Peer Directory',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
                TextButton.icon(
                  onPressed: _addNewContact,
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text('Add Peer', style: TextStyle(fontSize: 12)),
                ),
              ],
            ),
            Expanded(
              flex: 3,
              child: _contacts.isEmpty
                  ? Center(
                      child: Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: Theme.of(context).colorScheme.surface,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: const Text('Contact directory is empty.', style: TextStyle(color: Colors.grey, fontSize: 12)),
                      ),
                    )
                  : ListView.builder(
                      itemCount: _contacts.length,
                      itemBuilder: (context, index) {
                        final c = _contacts[index];
                        return Card(
                          margin: const EdgeInsets.only(bottom: 8),
                          color: Theme.of(context).colorScheme.surface,
                          child: ListTile(
                            leading: CircleAvatar(
                              backgroundColor: Theme.of(context).colorScheme.primary.withOpacity(0.2),
                              child: Text(c['name'][0].toUpperCase(), style: const TextStyle(color: Colors.white)),
                            ),
                            title: Text(c['name']),
                            subtitle: Text('Peer ID: ${c['peer_id']}', overflow: TextOverflow.ellipsis),
                            trailing: IconButton(
                              icon: const Icon(Icons.delete_outline, color: Colors.redAccent),
                              onPressed: () async {
                                await _dbService.deleteContact(c['peer_id']);
                                _refreshLocalData();
                              },
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
extension on EdgeInsets {
  EdgeInsets get py => symmetric(vertical: vertical);
}
extension on EdgeInsetsGeometry {
  EdgeInsetsGeometry get py => this;
}

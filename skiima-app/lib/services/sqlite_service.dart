import 'dart:async';
import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';

class SqliteService {
  static final SqliteService _instance = SqliteService._internal();
  static Database? _database;

  factory SqliteService() {
    return _instance;
  }

  SqliteService._internal();

  /**
   * Retrieves the opened SQLite database connection singleton
   */
  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDatabase();
    return _database!;
  }

  /**
   * Initializes SQLite database in the platform-specific directory
   */
  Future<Database> _initDatabase() async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, 'skiima_share.db');

    return await openDatabase(
      path,
      version: 1,
      onCreate: _onCreate,
    );
  }

  /**
   * Creates the database tables on initial launch
   */
  FutureOr<void> _onCreate(Database db, int version) async {
    // 1. Contacts Directory Table
    await db.execute('''
      CREATE TABLE contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        peer_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        added_at TEXT NOT NULL
      )
    ''');

    // 2. Transfer Manifest & Queue Table (for Resumption state offsets)
    await db.execute('''
      CREATE TABLE transfers (
        transfer_id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        bytes_transferred INTEGER NOT NULL,
        status TEXT NOT NULL,
        last_chunk_index INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      )
    ''');
  }

  // ==========================================
  // CONTACTS MANAGEMENT CRUD
  // ==========================================

  /**
   * Saves or updates a contact locally
   */
  Future<int> saveContact(String peerId, String name) async {
    final db = await database;
    return await db.insert(
      'contacts',
      {
        'peer_id': peerId,
        'name': name,
        'added_at': DateTime.now().toIso8601String(),
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  /**
   * Retrieves the complete contact directory list
   */
  Future<List<Map<String, dynamic>>> getContacts() async {
    final db = await database;
    return await db.query('contacts', orderBy: 'name ASC');
  }

  /**
   * Deletes a contact from the local directory
   */
  Future<int> deleteContact(String peerId) async {
    final db = await database;
    return await db.delete(
      'contacts',
      where: 'peer_id = ?',
      whereArgs: [peerId],
    );
  }

  // ==========================================
  // TRANSFER QUEUE & PAUSE/RESUME PERSISTENCE
  // ==========================================

  /**
   * Creates or updates a transfer record manifest
   */
  Future<int> saveTransfer({
    required String transferId,
    required String fileName,
    required int fileSize,
    required String filePath,
    required int bytesTransferred,
    required String status,
    required int lastChunkIndex,
  }) async {
    final db = await database;
    return await db.insert(
      'transfers',
      {
        'transfer_id': transferId,
        'file_name': fileName,
        'file_size': fileSize,
        'file_path': filePath,
        'bytes_transferred': bytesTransferred,
        'status': status,
        'last_chunk_index': lastChunkIndex,
        'updated_at': DateTime.now().toIso8601String(),
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  /**
   * Updates only the byte progress and chunk index of an active transfer
   */
  Future<int> updateProgress(String transferId, int bytesTransferred, int lastChunkIndex, String status) async {
    final db = await database;
    return await db.update(
      'transfers',
      {
        'bytes_transferred': bytesTransferred,
        'last_chunk_index': lastChunkIndex,
        'status': status,
        'updated_at': DateTime.now().toIso8601String(),
      },
      where: 'transfer_id = ?',
      whereArgs: [transferId],
    );
  }

  /**
   * Retrieves an active transfer by its unique ID
   */
  Future<Map<String, dynamic>?> getTransfer(String transferId) async {
    final db = await database;
    final results = await db.query(
      'transfers',
      where: 'transfer_id = ?',
      whereArgs: [transferId],
      limit: 1,
    );
    if (results.isNotEmpty) {
      return results.first;
    }
    return null;
  }

  /**
   * Retrieves all active/paused transfers in the manifest
   */
  Future<List<Map<String, dynamic>>> getActiveTransfers() async {
    final db = await database;
    return await db.query(
      'transfers',
      where: 'status IN (?, ?, ?)',
      whereArgs: ['pending', 'transferring', 'paused'],
      orderBy: 'updated_at DESC',
    );
  }
}

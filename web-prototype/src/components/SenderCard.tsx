import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, File, Copy, Check, Zap, RotateCcw, AlertTriangle, Radio } from 'lucide-react';
import { P2PEngine } from '../lib/P2PEngine';
import type { TransferStats, ConnectionStatus } from '../lib/P2PEngine';
import { historyDb } from '../lib/historyDb';
import { ChunkVisualizer } from './ChunkVisualizer';

interface SenderCardProps {
  engine: P2PEngine;
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (status: ConnectionStatus) => void;
  initialFile?: File | null;
  onClearInitialFile?: () => void;
}

export const SenderCard: React.FC<SenderCardProps> = ({
  engine,
  connectionStatus,
  setConnectionStatus,
  initialFile,
  onClearInitialFile,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [roomCode, setRoomCode] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [stats, setStats] = useState<TransferStats | null>(null);
  const [isTransferring, setIsTransferring] = useState<boolean>(false);
  const [transferDone, setTransferDone] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [showChunks, setShowChunks] = useState<boolean>(false);

  const handleConnectFirst = () => {
    setErrorMsg('');
    setTransferDone(false);
    setStats(null);
    const generatedCode = Math.floor(100000 + Math.random() * 900000).toString();
    engine.initialize(generatedCode);
  };
  const [isDragActive, setIsDragActive] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hook up engine events
  useEffect(() => {
    engine.onPeerIdReady = (id) => {
      setRoomCode(id);
    };

    engine.onProgress = (progressStats) => {
      setStats(progressStats);
      setIsTransferring(true);
    };

    engine.onTransferComplete = () => {
      setTransferDone(true);
      setIsTransferring(false);
      setStats((prev) => prev ? { ...prev, progress: 100 } : null);
      if (file) {
        historyDb.addShareHistoryItem({
          fileName: file.name,
          fileSize: file.size,
          peerRole: 'sender',
          peerId: engine.pairedPeerId,
          peerName: engine.pairedPeerName,
          status: 'success'
        });
      }
    };

    engine.onError = (err) => {
      setErrorMsg(err);
      setIsTransferring(false);
      if (file) {
        historyDb.addShareHistoryItem({
          fileName: file.name,
          fileSize: file.size,
          peerRole: 'sender',
          peerId: engine.pairedPeerId,
          peerName: engine.pairedPeerName,
          status: 'failed'
        });
      }
    };

    engine.onStatusChange = (status) => {
      setConnectionStatus(status);
      if (status === 'connected-p2p' || status === 'connected-turn') {
        // Automatically start file streaming once receiver connects
        if (file && !isTransferring && !transferDone) {
          setIsTransferring(true);
          engine.sendFile(file).catch((e) => {
            setErrorMsg(e.message || 'File transfer initialization failed.');
            setIsTransferring(false);
          });
        }
      }
    };

    return () => {
      // Don't fully cleanup engine on card change to allow keep-alive
    };
  }, [engine, file, isTransferring, transferDone]);

  // Load existing room code if the P2PEngine is already pre-initialized
  useEffect(() => {
    if (engine.roomCode) {
      setRoomCode(engine.roomCode);
    }
  }, [engine.roomCode]);

  // Load quick-send initial file on mount/change
  useEffect(() => {
    if (initialFile) {
      setFile(initialFile);
      setErrorMsg('');
      setTransferDone(false);
      setStats(null);
      if (onClearInitialFile) {
        onClearInitialFile();
      }
    }
  }, [initialFile, onClearInitialFile]);

  // Resilient trigger to ensure file transfer starts when BOTH file is loaded
  // AND WebRTC connection becomes fully connected.
  useEffect(() => {
    if (
      (connectionStatus === 'connected-p2p' || connectionStatus === 'connected-turn') &&
      file &&
      !isTransferring &&
      !transferDone
    ) {
      setIsTransferring(true);
      engine.sendFile(file).catch((e) => {
        setErrorMsg(e.message || 'File transfer initialization failed.');
        setIsTransferring(false);
      });
    }
  }, [connectionStatus, file, isTransferring, transferDone, engine]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragActive(true);
    } else if (e.type === 'dragleave') {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setupFileAndCode(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setupFileAndCode(e.target.files[0]);
    }
  };

  const setupFileAndCode = (selectedFile: File) => {
    setFile(selectedFile);
    setErrorMsg('');
    setTransferDone(false);
    setStats(null);

    // Generate a simple, easily shareable 6-digit code
    const generatedCode = Math.floor(100000 + Math.random() * 900000).toString();
    engine.initialize(generatedCode);
  };

  const handleCopyCode = async () => {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Clipboard write failed:', err);
    }
  };

  const handleReset = () => {
    engine.cleanup();
    setFile(null);
    setRoomCode('');
    setStats(null);
    setIsTransferring(false);
    setTransferDone(false);
    setErrorMsg('');
    setConnectionStatus('disconnected');
  };

  // Human-readable formatting helper
  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const formatSpeed = (bytesPerSecond: number) => {
    return `${formatBytes(bytesPerSecond)}/s`;
  };

  return (
    <div className="glass-panel" style={{ padding: '2rem', minHeight: '400px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Zap size={24} style={{ color: 'var(--accent-purple)' }} /> Send File
        </h2>
        {connectionStatus !== 'disconnected' && (
          <span className={`status-badge ${connectionStatus}`}>
            <Radio size={14} /> {connectionStatus.replace('-', ' ').toUpperCase()}
          </span>
        )}
      </div>

      {/* 1. Initial State (No file, No room code) */}
      {!file && !roomCode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', flexGrow: 1, justifyContent: 'center' }}>
          <div
            className={`dropzone ${isDragActive ? 'active' : ''}`}
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            <div className="dropzone-icon">
              <UploadCloud size={40} />
            </div>
            <div>
              <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                Drag & Drop your file here
              </p>
              <p style={{ fontSize: '0.875rem' }}>or click to browse local files</p>
            </div>
          </div>
          
          <button
            type="button"
            onClick={handleConnectFirst}
            className="btn-primary"
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--border-muted)',
              fontSize: '0.9rem',
              padding: '0.75rem',
              width: '100%',
              boxShadow: 'none',
              borderRadius: '12px'
            }}
          >
            Connect Device First (without file)
          </button>
        </div>
      )}

      {/* 2. Pre-connection or Connected slate (No file, Room code exists) */}
      {!file && roomCode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', flexGrow: 1, justifyContent: 'center' }}>
          {(connectionStatus === 'disconnected' || connectionStatus === 'connecting') ? (
            // Waiting for recipient
            <div style={{ textAlign: 'center', margin: '1rem 0' }}>
              <p style={{ marginBottom: '0.5rem', fontSize: '0.95rem' }}>
                Waiting for recipient to connect. Share this key:
              </p>
              <div className="code-box">
                <span className="code-text">{roomCode}</span>
                <button onClick={handleCopyCode} className="btn-icon-copy">
                  {copied ? <Check size={20} style={{ color: 'var(--accent-green)' }} /> : <Copy size={20} />}
                </button>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '1.5rem' }}>
                Or select a file now to be ready for streaming:
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn-primary"
                style={{ border: '1px solid var(--border-muted)', marginTop: '0.5rem', padding: '0.5rem 1.5rem', borderRadius: '12px' }}
              >
                Choose File
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
            </div>
          ) : (
            // Connected but no file loaded yet
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div
                className={`dropzone ${isDragActive ? 'active' : ''}`}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{ borderColor: 'var(--accent-green)', background: 'rgba(16, 185, 129, 0.02)' }}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
                <div className="dropzone-icon" style={{ color: 'var(--accent-green)' }}>
                  <UploadCloud size={40} />
                </div>
                <div>
                  <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                    Direct P2P Link Established!
                  </p>
                  <p style={{ fontSize: '0.875rem' }}>Drop or select a file to stream instantly.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. Active Transfer or Complete state (File loaded) */}
      {file && (
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
          {/* File Card Info */}
          <div className="file-card">
            <div className="file-card-icon">
              <File size={24} />
            </div>
            <div className="file-info">
              <div className="file-name" title={file.name}>{file.name}</div>
              <div className="file-size">{formatBytes(file.size)}</div>
            </div>
            {!isTransferring && !transferDone && (
              <button onClick={handleReset} className="btn-icon-copy" title="Select another file">
                <RotateCcw size={16} />
              </button>
            )}
          </div>

          {/* Code Sharing Area (Standard loop) */}
          {!isTransferring && !transferDone && !errorMsg && (
            <div style={{ textAlign: 'center', margin: '1rem 0' }}>
              <p style={{ marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                Waiting for recipient. Share this 6-digit key:
              </p>
              {roomCode ? (
                <div className="code-box">
                  <span className="code-text">{roomCode}</span>
                  <button onClick={handleCopyCode} className="btn-icon-copy">
                    {copied ? <Check size={20} style={{ color: 'var(--accent-green)' }} /> : <Copy size={20} />}
                  </button>
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', padding: '1rem' }}>
                  Generating room code...
                </div>
              )}
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              borderRadius: '12px',
              padding: '1rem',
              color: 'var(--accent-red)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              margin: '1rem 0'
            }}>
              <AlertTriangle size={20} />
              <p style={{ color: '#fca5a5', fontSize: '0.85rem' }}>{errorMsg}</p>
            </div>
          )}

          {/* TURN Connection advisory warning */}
          {connectionStatus === 'connected-turn' && !transferDone && (
            <div style={{
              background: 'rgba(245, 158, 11, 0.05)',
              border: '1px solid rgba(245, 158, 11, 0.15)',
              borderRadius: '16px',
              padding: '1rem',
              marginBottom: '1rem',
              color: '#f59e0b',
              fontSize: '0.8rem',
              lineHeight: '1.4',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}>
                <AlertTriangle size={16} /> Relayed (TURN) Connection Fallback
              </div>
              <p style={{ color: '#fbbf24', margin: 0, fontSize: '0.78rem' }}>
                Peers are blocked by strict cellular data NATs or VPN firewalls. Traffic is relayed via global servers (consuming relay quota). For maximum speeds and zero quota usage, connect both devices to local Wi-Fi or turn off corporate VPNs.
              </p>
            </div>
          )}

          {/* Transfer stats & progress */}
          {(isTransferring || stats) && !transferDone && (
            <div className="progress-container">
              <div className="progress-header">
                <span>Sending File...</span>
                <span>{stats ? Math.round(stats.progress) : 0}%</span>
              </div>
              <div className="progress-track">
                <div
                  className="progress-bar purple"
                  style={{ width: `${stats ? stats.progress : 0}%` }}
                ></div>
              </div>

              {stats && (
                <div className="stats-grid">
                  <div className="stat-item">
                    <span className="stat-label">Transfer Speed</span>
                    <span className="stat-value">{formatSpeed(stats.speed)}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Time Remaining</span>
                    <span className="stat-value">{stats.timeRemaining}s</span>
                  </div>
                </div>
              )}

              {/* Show Stream Chunks Toggle Button */}
              <button
                type="button"
                onClick={() => setShowChunks(!showChunks)}
                className="btn-primary"
                style={{
                  marginTop: '1rem',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--border-muted)',
                  fontSize: '0.8rem',
                  padding: '0.45rem 1rem',
                  width: '100%',
                  boxShadow: 'none',
                  borderRadius: '12px'
                }}
              >
                {showChunks ? 'Hide Stream Chunks' : 'Show Stream Chunks'}
              </button>

              {showChunks && stats && (
                <ChunkVisualizer progress={stats.progress} isTransferring={isTransferring} />
              )}
            </div>
          )}

          {/* Done State */}
          {transferDone && (
            <div style={{ textAlign: 'center', margin: '2rem 0 1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{
                background: 'rgba(16, 185, 129, 0.1)',
                color: 'var(--accent-green)',
                padding: '1rem',
                borderRadius: '50%',
                display: 'inline-flex',
                boxShadow: '0 0 20px rgba(16, 185, 129, 0.2)'
              }}>
                <Check size={36} />
              </div>
              <div>
                <p style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '1.1rem' }}>
                  Transfer Completed!
                </p>
                <p style={{ fontSize: '0.85rem' }}>Your file was streamed successfully via direct P2P.</p>
              </div>
              <button
                onClick={handleReset}
                className="btn-primary"
                style={{ marginTop: '1rem', width: 'auto', paddingLeft: '2rem', paddingRight: '2rem' }}
              >
                <RotateCcw size={16} /> Send Another File
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

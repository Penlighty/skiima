import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, File, Copy, Check, Zap, RotateCcw, AlertTriangle, Radio, X, Pause, Play, Square, MessageCircle } from 'lucide-react';
import { P2PEngine } from '../lib/P2PEngine';
import type { TransferStats, ConnectionStatus } from '../lib/P2PEngine';
import { historyDb } from '../lib/historyDb';
import type { HistoryItem } from '../lib/historyDb';
import { ChunkVisualizer } from './ChunkVisualizer';

interface SenderCardProps {
  engine: P2PEngine;
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (status: ConnectionStatus) => void;
  initialFile?: File | null;
  onClearInitialFile?: () => void;
  onBack?: () => void;
  resumeHistoryItem?: HistoryItem | null;
  onClearResumeHistoryItem?: () => void;
}

export const SenderCard: React.FC<SenderCardProps> = ({
  engine,
  connectionStatus,
  setConnectionStatus,
  initialFile,
  onClearInitialFile,
  onBack,
  resumeHistoryItem,
  onClearResumeHistoryItem
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [roomCode, setRoomCode] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [stats, setStats] = useState<TransferStats | null>(null);
  const [isTransferring, setIsTransferring] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [showStopConfirm, setShowStopConfirm] = useState<boolean>(false);
  const [transferDone, setTransferDone] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [showChunks, setShowChunks] = useState<boolean>(false);
  const [isDragActive, setIsDragActive] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleConnectFirst = () => {
    setErrorMsg('');
    setTransferDone(false);
    setStats(null);
    const generatedCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Save active transfer session for resilience
    localStorage.setItem('skiima_active_transfer_session', JSON.stringify({
      role: 'sender',
      roomCode: generatedCode,
      fileMetadata: { name: '', size: 0, type: '' }
    }));

    engine.initialize(generatedCode);
  };

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
      setIsPaused(false);
      setStats((prev) => prev ? { ...prev, progress: 100 } : null);
      
      // Clear active transfer session upon success
      localStorage.removeItem('skiima_active_transfer_session');

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
      setIsPaused(false);
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
      if (status === 'connected-p2p') {
        if (file && !isTransferring && !transferDone) {
          setIsTransferring(true);
          engine.sendFile(file).catch((e) => {
            setErrorMsg(e.message || 'File transfer initialization failed.');
            setIsTransferring(false);
          });
        }
      }
    };

    engine.onTransferPaused = () => {
      setIsPaused(true);
    };

    engine.onTransferResumed = () => {
      setIsPaused(false);
    };

    engine.onTransferStopped = (reason) => {
      setIsTransferring(false);
      setIsPaused(false);
      setStats(null); // Clear transfer stats to hide the progress card
      setErrorMsg(`Transfer stopped: ${reason}`);
      
      // Clear active transfer session upon explicit stop
      localStorage.removeItem('skiima_active_transfer_session');
    };

    return () => {};
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
      (connectionStatus === 'connected-p2p') &&
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

  // Save/update session on file loaded (after connecting first)
  useEffect(() => {
    if (file && roomCode) {
      localStorage.setItem('skiima_active_transfer_session', JSON.stringify({
        role: 'sender',
        roomCode: roomCode,
        fileMetadata: {
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream'
        }
      }));
    }
  }, [file, roomCode]);

  // Auto-reconnect on accidental disconnection
  useEffect(() => {
    if (
      roomCode && 
      !transferDone && 
      !showStopConfirm && 
      !engine.isStopped && 
      connectionStatus === 'disconnected'
    ) {
      console.log('[Resilience] Accidental sender disconnection detected. Auto-reconnecting in 2s...');
      const timer = setTimeout(() => {
        engine.initialize(roomCode);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [connectionStatus, transferDone, showStopConfirm, roomCode, engine]);

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
      const selectedFile = e.dataTransfer.files[0];
      if (resumeHistoryItem) {
        if (selectedFile.name !== resumeHistoryItem.fileName || selectedFile.size !== resumeHistoryItem.fileSize) {
          setErrorMsg(`Invalid file. Please select the original file: "${resumeHistoryItem.fileName}" (${formatBytes(resumeHistoryItem.fileSize)})`);
          return;
        }
      }
      setupFileAndCode(selectedFile);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (resumeHistoryItem) {
        if (selectedFile.name !== resumeHistoryItem.fileName || selectedFile.size !== resumeHistoryItem.fileSize) {
          setErrorMsg(`Invalid file. Please select the original file: "${resumeHistoryItem.fileName}" (${formatBytes(resumeHistoryItem.fileSize)})`);
          return;
        }
      }
      setupFileAndCode(selectedFile);
    }
  };

  const setupFileAndCode = (selectedFile: File) => {
    setFile(selectedFile);
    setErrorMsg('');
    setTransferDone(false);
    setStats(null);

    // Reuse existing room code, recovered code, or generate a new one
    const recoveredCode = localStorage.getItem('skiima_recovered_room_code');
    const codeToUse = roomCode || recoveredCode || Math.floor(100000 + Math.random() * 900000).toString();
    localStorage.removeItem('skiima_recovered_room_code');

    // Save active transfer session for resilience
    localStorage.setItem('skiima_active_transfer_session', JSON.stringify({
      role: 'sender',
      roomCode: codeToUse,
      fileMetadata: {
        name: selectedFile.name,
        size: selectedFile.size,
        type: selectedFile.type || 'application/octet-stream'
      }
    }));

    // Only initialize connection if not already connected/connecting
    if (connectionStatus === 'disconnected') {
      engine.initialize(codeToUse);
    }
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
    setIsPaused(false);
    setShowStopConfirm(false);
    
    // Clear active session upon reset
    localStorage.removeItem('skiima_active_transfer_session');
    
    if (onClearResumeHistoryItem) {
      onClearResumeHistoryItem();
    }
  };

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

  const formatTimeRemaining = (seconds: number): string => {
    if (seconds === Infinity || isNaN(seconds) || seconds < 0) return 'Calculating...';
    if (seconds === 0) return '0s';
    
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    const parts: string[] = [];
    if (hrs > 0) parts.push(`${hrs}h`);
    if (mins > 0) parts.push(`${mins}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
    
    return parts.join(' ');
  };

  return (
    <div className="glass-panel" style={{ padding: '2rem', minHeight: '400px', display: 'flex', flexDirection: 'column' }}>
      {/* Dynamic Slate Header with Back Button */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        marginBottom: '1.5rem', 
        borderBottom: '1px solid var(--border-muted)', 
        paddingBottom: '1rem' 
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {onBack && (
            <button 
              onClick={onBack} 
              style={{ 
                background: 'none', 
                border: 'none', 
                color: 'var(--text-secondary)', 
                cursor: 'pointer', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                padding: '0.4rem',
                borderRadius: '50%',
                transition: 'var(--transition-fast)'
              }}
              className="btn-icon-copy"
            >
              <X size={18} />
            </button>
          )}
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, fontSize: '1.25rem' }}>
            <Zap size={20} style={{ color: 'var(--accent-purple)' }} /> Send File
          </h2>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {connectionStatus !== 'disconnected' && (
            <span className={`status-badge ${connectionStatus}`}>
              <Radio size={12} /> {connectionStatus.replace('-', ' ').toUpperCase()}
            </span>
          )}
          {file && (
            <button 
              onClick={handleReset} 
              style={{ 
                background: 'none', 
                border: 'none', 
                color: 'var(--text-muted)', 
                cursor: 'pointer', 
                display: 'flex',
                padding: '0.4rem',
                borderRadius: '50%'
              }}
              className="btn-icon-copy"
              title="Reset Connection"
            >
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 1. Initial State (No file, No room code) */}
      {!file && !roomCode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', flexGrow: 1, justifyContent: 'center' }}>
          {resumeHistoryItem ? (
            <div
              className={`dropzone ${isDragActive ? 'active' : ''}`}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{ borderColor: 'var(--accent-purple)', background: 'rgba(129, 118, 242, 0.02)' }}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              <div className="dropzone-icon" style={{ color: 'var(--accent-purple)' }}>
                <UploadCloud size={40} />
              </div>
              <div>
                <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                  Resuming: "{resumeHistoryItem.fileName}"
                </p>
                <p style={{ fontSize: '0.875rem' }}>
                  Please select or drop the original file to resume transferring from where it left off ({formatBytes(resumeHistoryItem.fileSize)}).
                </p>
              </div>
            </div>
          ) : (
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
          )}
          
          {errorMsg && (
            <div style={{
              background: '#fef2f2',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              borderRadius: '12px',
              padding: '0.85rem',
              color: 'var(--accent-red)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <AlertTriangle size={18} />
              <p style={{ color: '#991b1b', fontSize: '0.85rem', fontWeight: 500 }}>{errorMsg}</p>
            </div>
          )}
          
          {!resumeHistoryItem && (
            <button
              type="button"
              onClick={handleConnectFirst}
              className="btn-primary"
              style={{
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                padding: '0.75rem',
                width: '100%',
                boxShadow: 'none',
                borderRadius: '12px'
              }}
            >
              Connect Device First (without file)
            </button>
          )}
        </div>
      )}

      {/* 2. Pre-connection or Connected slate (No file, Room code exists) */}
      {!file && roomCode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', flexGrow: 1, justifyContent: 'center' }}>
          {(connectionStatus === 'disconnected' || connectionStatus === 'connecting') ? (
            <div style={{ textAlign: 'center', margin: '1rem 0' }}>
              <p style={{ marginBottom: '0.5rem', fontSize: '0.95rem' }}>
                Waiting for recipient to connect. Share this key:
              </p>
              <div className="code-box" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', alignItems: 'center' }}>
                <span className="code-text" style={{ flexGrow: 0, paddingRight: '0.5rem' }}>{roomCode}</span>
                <button onClick={handleCopyCode} className="btn-icon-copy" title="Copy Code" style={{ flexShrink: 0 }}>
                  {copied ? <Check size={20} style={{ color: 'var(--accent-green)' }} /> : <Copy size={20} />}
                </button>
                <a
                  href={`https://api.whatsapp.com/send?text=${encodeURIComponent(
                    `Hey! Connect with me on Skiima Share using this code: *${roomCode}*. Or click this direct link to connect instantly: ${window.location.origin}?room=${roomCode}`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-icon-copy"
                  title="Share via WhatsApp"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', flexShrink: 0 }}
                >
                  <MessageCircle size={20} />
                </a>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '1.5rem' }}>
                Or select a file now to be ready for streaming:
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn-cyan"
                style={{ marginTop: '0.5rem', padding: '0.55rem 1.5rem', borderRadius: '12px', width: 'auto', display: 'inline-flex', alignSelf: 'center' }}
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
          ) : connectionStatus === 'connected-turn' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{
                background: 'rgba(239, 68, 68, 0.05)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: '16px',
                padding: '1.25rem',
                color: 'var(--accent-red)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                textAlign: 'left'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700 }}>
                  <AlertTriangle size={18} /> File Sharing Blocked: Non-P2P Connection
                </div>
                <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.85rem', lineHeight: '1.4' }}>
                  Skiima blocked this transfer because it's using a relayed connection (TURN). Direct P2P connection is required for absolute privacy and high-speed sharing.
                </p>
                <details className="troubleshoot-dropdown">
                  <summary>How to Fix & Unblock Direct P2P</summary>
                  <div style={{ padding: '0.75rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <p style={{ margin: 0, lineHeight: '1.4' }}>
                      Direct browser-to-browser (P2P) transfers require an unblocked UDP route. Devices do not need to be on the same local network, but symmetric NATs, cellular hot-spots, guest-isolated Wi-Fi, or corporate VPNs can restrict direct routing.
                    </p>
                    <strong style={{ color: 'var(--text-primary)' }}>Resolution Steps:</strong>
                    <ul style={{ margin: '0 0 0 1.25rem', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      <li>Disable commercial or corporate VPNs on both devices.</li>
                      <li>If using cellular 3G/4G/5G mobile hotspots, try switching to standard Wi-Fi.</li>
                      <li>Ensure the router's AP Isolation (guest Wi-Fi isolation) is disabled.</li>
                      <li>Try connecting via different networks to establish a direct path.</li>
                    </ul>
                  </div>
                </details>
              </div>
              <button
                onClick={handleReset}
                className="btn-primary"
                style={{ marginTop: '0.5rem' }}
              >
                Reset and Try Again
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div
                className={`dropzone ${isDragActive ? 'active' : ''}`}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{ borderColor: 'var(--accent-green)', background: 'rgba(16, 185, 129, 0.01)' }}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
                <div className="dropzone-icon" style={{ color: 'var(--accent-green)', background: 'rgba(16, 185, 129, 0.08)' }}>
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

          {!isTransferring && !transferDone && !errorMsg && connectionStatus !== 'connected-turn' && (
            <div style={{ textAlign: 'center', margin: '1rem 0' }}>
              <p style={{ marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                Waiting for recipient. Share this 6-digit key:
              </p>
              {roomCode ? (
                <div className="code-box" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', alignItems: 'center' }}>
                  <span className="code-text" style={{ flexGrow: 0, paddingRight: '0.5rem' }}>{roomCode}</span>
                  <button onClick={handleCopyCode} className="btn-icon-copy" title="Copy Code" style={{ flexShrink: 0 }}>
                    {copied ? <Check size={20} style={{ color: 'var(--accent-green)' }} /> : <Copy size={20} />}
                  </button>
                  <a
                    href={`https://api.whatsapp.com/send?text=${encodeURIComponent(
                      `Hey! Connect with me on Skiima Share using this code: *${roomCode}*. Or click this direct link to connect instantly: ${window.location.origin}?room=${roomCode}`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-icon-copy"
                    title="Share via WhatsApp"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', flexShrink: 0 }}
                  >
                    <MessageCircle size={20} />
                  </a>
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', padding: '1rem' }}>
                  Generating room code...
                </div>
              )}
            </div>
          )}

          {errorMsg && (
            <div style={{
              background: '#fef2f2',
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
              <p style={{ color: '#991b1b', fontSize: '0.85rem', fontWeight: 500 }}>{errorMsg}</p>
            </div>
          )}

          {/* TURN Connection blocker */}
          {connectionStatus === 'connected-turn' && !transferDone && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.05)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              borderRadius: '16px',
              padding: '1.25rem',
              marginBottom: '1rem',
              color: 'var(--accent-red)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              textAlign: 'left'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700 }}>
                <AlertTriangle size={18} /> File Sharing Blocked: Non-P2P Connection
              </div>
              <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.85rem', lineHeight: '1.4' }}>
                Skiima blocked this transfer because it's using a relayed connection (TURN). Direct P2P connection is required for absolute privacy and high-speed sharing.
              </p>
              <details className="troubleshoot-dropdown" style={{ marginBottom: '0.5rem' }}>
                <summary>How to Fix & Unblock Direct P2P</summary>
                <div style={{ padding: '0.75rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <p style={{ margin: 0, lineHeight: '1.4' }}>
                    Direct browser-to-browser (P2P) transfers require an unblocked UDP route. Devices do not need to be on the same local network, but symmetric NATs, cellular hot-spots, guest-isolated Wi-Fi, or corporate VPNs can restrict direct routing.
                  </p>
                  <strong style={{ color: 'var(--text-primary)' }}>Resolution Steps:</strong>
                  <ul style={{ margin: '0 0 0 1.25rem', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <li>Disable commercial or corporate VPNs on both devices.</li>
                    <li>If using cellular 3G/4G/5G mobile hotspots, try switching to standard Wi-Fi.</li>
                    <li>Ensure the router's AP Isolation (guest Wi-Fi isolation) is disabled.</li>
                    <li>Try connecting via different networks to establish a direct path.</li>
                  </ul>
                </div>
              </details>
              <button
                onClick={handleReset}
                className="btn-primary"
                style={{ width: '100%' }}
              >
                Reset and Try Again
              </button>
            </div>
          )}

          {(isTransferring || stats) && !transferDone && (
            <div className="progress-container">
              <div className="progress-header">
                <span>{isPaused ? 'Transfer Paused' : 'Sending File...'}</span>
                <span>{stats ? Math.round(stats.progress) : 0}%</span>
              </div>
              <div className="progress-track">
                <div
                  className={`progress-bar purple ${isPaused ? 'paused' : ''}`}
                  style={{ width: `${stats ? stats.progress : 0}%` }}
                ></div>
              </div>

              {stats && (
                <div className="stats-grid">
                  <div className="stat-item">
                    <span className="stat-label">Transfer Speed</span>
                    <span className="stat-value">{isPaused ? '0 Bytes/s' : formatSpeed(stats.speed)}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Time Remaining</span>
                    <span className="stat-value">{isPaused ? '—' : formatTimeRemaining(stats.timeRemaining)}</span>
                  </div>
                </div>
              )}

              {/* Pause / Resume / Stop Actions */}
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', width: '100%' }}>
                {isPaused ? (
                  <button
                    type="button"
                    onClick={() => engine.resumeTransfer()}
                    className="btn-cyan"
                    style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', padding: '0.65rem 0.5rem', fontSize: '0.9rem', borderRadius: '12px' }}
                  >
                    <Play size={16} /> Resume
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => engine.pauseTransfer()}
                    className="btn-primary"
                    style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', padding: '0.65rem 0.5rem', fontSize: '0.9rem', borderRadius: '12px', background: '#f8fafc', border: '1px solid #cbd5e1', color: 'var(--text-primary)', boxShadow: 'none' }}
                  >
                    <Pause size={16} /> Pause
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    engine.pauseTransfer();
                    setShowStopConfirm(true);
                  }}
                  className="btn-primary"
                  style={{
                    flexGrow: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.4rem',
                    padding: '0.65rem 0.5rem',
                    fontSize: '0.9rem',
                    borderRadius: '12px',
                    background: 'rgba(239, 68, 68, 0.08)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    color: 'var(--accent-red)',
                    boxShadow: 'none'
                  }}
                >
                  <Square size={14} /> Stop
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowChunks(!showChunks)}
                className="btn-primary"
                style={{
                  marginTop: '1rem',
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  color: 'var(--text-secondary)',
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
                <ChunkVisualizer progress={stats.progress} isTransferring={isTransferring && !isPaused} />
              )}
            </div>
          )}

          {transferDone && (
            <div style={{ textAlign: 'center', margin: '2rem 0 1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{
                background: 'rgba(16, 185, 129, 0.1)',
                color: 'var(--accent-green)',
                padding: '1rem',
                borderRadius: '50%',
                display: 'inline-flex',
                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.15)'
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

      {/* Custom absolute confirmation modal for Stop action */}
      {showStopConfirm && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(8px)',
          borderRadius: '24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          zIndex: 100,
          textAlign: 'center'
        }}>
          <div style={{
            background: 'var(--bg-dark)',
            border: '1px solid var(--border-input)',
            borderRadius: '20px',
            padding: '1.75rem 1.25rem',
            maxWidth: '300px',
            boxShadow: 'var(--shadow-premium)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem'
          }}>
            <div style={{
              background: 'rgba(239, 68, 68, 0.1)',
              color: 'var(--accent-red)',
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              alignSelf: 'center'
            }}>
              <AlertTriangle size={22} />
            </div>
            
            <div>
              <h4 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 0.4rem 0' }}>
                Stop Transfer?
              </h4>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.4' }}>
                Are you sure you want to stop the transfer? You can pause instead to keep your progress.
              </p>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button
                onClick={() => {
                  setShowStopConfirm(false);
                }}
                className="btn-cyan"
                style={{ width: '100%', padding: '0.55rem', fontSize: '0.85rem', borderRadius: '10px' }}
              >
                Pause Instead
              </button>
              
              <button
                onClick={() => {
                  setShowStopConfirm(false);
                  engine.stopTransfer();
                }}
                className="btn-primary"
                style={{
                  width: '100%',
                  padding: '0.55rem',
                  fontSize: '0.85rem',
                  borderRadius: '10px',
                  background: 'none',
                  border: '1px solid var(--accent-red)',
                  color: 'var(--accent-red)',
                  boxShadow: 'none'
                }}
              >
                Stop (Destructive)
              </button>
              
              <button
                onClick={() => {
                  setShowStopConfirm(false);
                  engine.resumeTransfer();
                }}
                className="btn-primary"
                style={{
                  width: '100%',
                  padding: '0.55rem',
                  fontSize: '0.85rem',
                  borderRadius: '10px',
                  background: 'none',
                  border: '1px solid var(--border-input)',
                  color: 'var(--text-secondary)',
                  boxShadow: 'none'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

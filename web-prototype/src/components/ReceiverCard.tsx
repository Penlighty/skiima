import React, { useState, useEffect } from 'react';
import { DownloadCloud, File, ArrowRight, RotateCcw, AlertTriangle, Radio, Download, Check, X } from 'lucide-react';
import { P2PEngine } from '../lib/P2PEngine';
import type { TransferStats, ConnectionStatus, FileMetadata } from '../lib/P2PEngine';
import { historyDb } from '../lib/historyDb';
import type { HistoryItem } from '../lib/historyDb';
import { ChunkVisualizer } from './ChunkVisualizer';

interface ReceiverCardProps {
  engine: P2PEngine;
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (status: ConnectionStatus) => void;
  onBack?: () => void;
  resumeHistoryItem?: HistoryItem | null;
  onClearResumeHistoryItem?: () => void;
  initialCode?: string;
  onClearInitialCode?: () => void;
}

export const ReceiverCard: React.FC<ReceiverCardProps> = ({
  engine,
  connectionStatus,
  setConnectionStatus,
  onBack,
  onClearResumeHistoryItem,
  initialCode,
  onClearInitialCode
}) => {
  const [code, setCode] = useState<string>('');
  const [fileMetadata, setFileMetadata] = useState<FileMetadata | null>(null);
  const [stats, setStats] = useState<TransferStats | null>(null);
  const [isTransferring, setIsTransferring] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [transferDone, setTransferDone] = useState<boolean>(false);
  const [downloadUrl, setDownloadUrl] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [showChunks, setShowChunks] = useState<boolean>(false);

  // Hook up engine events
  useEffect(() => {
    engine.onMetadataReceived = (metadata) => {
      setFileMetadata(metadata);
      setIsTransferring(true);
      setTransferDone(false); // Reset completed transfer state for sequential file streams
      setDownloadUrl(''); // Reset download URL
      setStats(null); // Reset stats for the next file
      setErrorMsg('');

      // Save receiver session with complete file metadata
      localStorage.setItem('skiima_active_transfer_session', JSON.stringify({
        role: 'receiver',
        roomCode: engine.roomCode || code,
        fileMetadata: {
          name: metadata.name,
          size: metadata.size,
          type: metadata.type
        }
      }));
    };

    engine.onProgress = (progressStats) => {
      setStats(progressStats);
    };

    engine.onTransferComplete = (url) => {
      if (url) {
        setDownloadUrl(url);
      }
      setTransferDone(true);
      setIsTransferring(false);
      setIsPaused(false);
      setStats((prev) => prev ? { ...prev, progress: 100 } : null);

      // Clear the active session upon successful completion
      localStorage.removeItem('skiima_active_transfer_session');

      if (fileMetadata) {
        historyDb.addShareHistoryItem({
          fileName: fileMetadata.name,
          fileSize: fileMetadata.size,
          peerRole: 'receiver',
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
      if (fileMetadata) {
        historyDb.addShareHistoryItem({
          fileName: fileMetadata.name,
          fileSize: fileMetadata.size,
          peerRole: 'receiver',
          peerId: engine.pairedPeerId,
          peerName: engine.pairedPeerName,
          status: 'failed'
        });
      }
    };

    engine.onStatusChange = (status) => {
      setConnectionStatus(status);
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
      setStats(null); // Clear transfer stats
      setFileMetadata(null); // Clear file metadata so it returns to entering code screen
      setErrorMsg(`Transfer stopped: ${reason}`);
      localStorage.removeItem('skiima_active_transfer_session');
    };

    return () => {};
  }, [engine, fileMetadata, code]);

  // A. Load initial receiver code if provided via direct link
  useEffect(() => {
    if (initialCode) {
      setCode(initialCode);
      // Save session first to prepare for recovery if interrupted
      localStorage.setItem('skiima_active_transfer_session', JSON.stringify({
        role: 'receiver',
        roomCode: initialCode,
        fileMetadata: { name: '', size: 0, type: '' }
      }));
      engine.connectToPeer(initialCode);
      if (onClearInitialCode) {
        onClearInitialCode();
      }
    }
  }, [initialCode, onClearInitialCode, engine]);

  // B. Auto-reconnect on accidental disconnection
  useEffect(() => {
    const activeCode = engine.roomCode;
    if (
      activeCode && 
      !transferDone && 
      connectionStatus === 'disconnected'
    ) {
      console.log('[Resilience] Accidental receiver disconnection detected. Auto-reconnecting in 2s...');
      const timer = setTimeout(() => {
        engine.connectToPeer(activeCode);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [connectionStatus, transferDone, engine]);

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setErrorMsg('Please enter a valid sharing code.');
      return;
    }

    if (trimmedCode.length !== 6 || isNaN(Number(trimmedCode))) {
      setErrorMsg('Sharing codes must be exactly 6 digits.');
      return;
    }

    // Save receiver active session in local storage for resilience
    localStorage.setItem('skiima_active_transfer_session', JSON.stringify({
      role: 'receiver',
      roomCode: trimmedCode,
      fileMetadata: { name: '', size: 0, type: '' }
    }));

    engine.connectToPeer(trimmedCode);
  };

  const handleReset = () => {
    engine.cleanup(true);
    setCode('');
    setFileMetadata(null);
    setStats(null);
    setIsTransferring(false);
    setIsPaused(false);
    setTransferDone(false);
    setDownloadUrl('');
    setErrorMsg('');
    setConnectionStatus('disconnected');
    
    localStorage.removeItem('skiima_active_transfer_session');
    
    if (onClearResumeHistoryItem) {
      onClearResumeHistoryItem();
    }
  };

  const handleDownload = () => {
    if (!downloadUrl || !fileMetadata) return;
    
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = fileMetadata.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
            <DownloadCloud size={20} style={{ color: 'var(--accent-cyan)' }} /> Receive File
          </h2>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {connectionStatus !== 'disconnected' && (
            <span className={`status-badge ${connectionStatus}`}>
              <Radio size={12} /> {connectionStatus.replace('-', ' ').toUpperCase()}
            </span>
          )}
          {fileMetadata && (
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

      {connectionStatus === 'connected-turn' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', flexGrow: 1, justifyContent: 'center' }}>
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
              Skiima blocked this transfer because it's using a relayed connection (TURN). Direct P2P connection is required for absolute privacy and zero-cost high-speed sharing.
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
      ) : !fileMetadata ? (
        <form onSubmit={handleConnect} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', flexGrow: 1, justifyContent: 'center' }}>
          <div>
            <p style={{ marginBottom: '0.75rem', fontSize: '0.95rem' }}>
              Enter the 6-digit connection code provided by the sender:
            </p>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="e.g. 198275"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="input-field"
              disabled={connectionStatus === 'connecting'}
              style={{ textAlign: 'center' }}
            />
          </div>

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

          {connectionStatus === 'connecting' ? (
            <button
              type="button"
              onClick={() => {
                engine.cleanup(true);
                localStorage.removeItem('skiima_active_transfer_session');
                setConnectionStatus('disconnected');
                setErrorMsg('');
              }}
              className="btn-primary"
            >
              Cancel & Enter New Code
            </button>
          ) : (
            <button
              type="submit"
              className="btn-cyan"
              disabled={code.length !== 6}
            >
              Connect & Fetch File <ArrowRight size={18} />
            </button>
          )}
        </form>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
          <div className="file-card" style={{ borderColor: 'rgba(6, 182, 212, 0.15)' }}>
            <div className="file-card-icon" style={{ background: 'rgba(129, 118, 242, 0.08)', color: 'var(--accent-cyan)' }}>
              <File size={24} />
            </div>
            <div className="file-info">
              <div className="file-name" title={fileMetadata.name}>{fileMetadata.name}</div>
              <div className="file-size">{formatBytes(fileMetadata.size)}</div>
            </div>
          </div>

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



          {(isTransferring || stats) && !transferDone && (
            <div className="progress-container">
              <div className="progress-header">
                <span>{isPaused ? 'Transfer Paused by Sender' : 'Receiving File...'}</span>
                <span>{stats ? Math.round(stats.progress) : 0}%</span>
              </div>
              <div className="progress-track">
                <div
                  className={`progress-bar cyan ${isPaused ? 'paused' : ''}`}
                  style={{ width: `${stats ? stats.progress : 0}%` }}
                ></div>
              </div>

              {stats && (
                <div className="stats-grid">
                  <div className="stat-item">
                    <span className="stat-label">Download Speed</span>
                    <span className="stat-value">{isPaused ? '0 Bytes/s' : formatSpeed(stats.speed)}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Time Remaining</span>
                    <span className="stat-value">{isPaused ? '—' : formatTimeRemaining(stats.timeRemaining)}</span>
                  </div>
                </div>
              )}

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
                  Ready to Save!
                </p>
                <p style={{ fontSize: '0.85rem' }}>File payload fully compiled from P2P stream chunks.</p>
              </div>

              <div style={{ display: 'flex', gap: '1rem', width: '100%', marginTop: '1.5rem' }}>
                <button
                  onClick={handleReset}
                  className="btn-primary"
                  style={{ background: '#f8fafc', border: '1px solid #cbd5e1', color: 'var(--text-primary)', boxShadow: 'none' }}
                >
                  <RotateCcw size={16} /> Reset
                </button>
                
                <button
                  onClick={handleDownload}
                  className="btn-cyan"
                  style={{ flexGrow: 2 }}
                >
                  <Download size={18} /> Save File
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

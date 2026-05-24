import React, { useState, useEffect } from 'react';
import { DownloadCloud, File, ArrowRight, RotateCcw, AlertTriangle, Radio, Download, Check, X } from 'lucide-react';
import { P2PEngine } from '../lib/P2PEngine';
import type { TransferStats, ConnectionStatus, FileMetadata } from '../lib/P2PEngine';
import { historyDb } from '../lib/historyDb';
import { ChunkVisualizer } from './ChunkVisualizer';

interface ReceiverCardProps {
  engine: P2PEngine;
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (status: ConnectionStatus) => void;
  onBack?: () => void;
}

export const ReceiverCard: React.FC<ReceiverCardProps> = ({
  engine,
  connectionStatus,
  setConnectionStatus,
  onBack
}) => {
  const [code, setCode] = useState<string>('');
  const [fileMetadata, setFileMetadata] = useState<FileMetadata | null>(null);
  const [stats, setStats] = useState<TransferStats | null>(null);
  const [isTransferring, setIsTransferring] = useState<boolean>(false);
  const [transferDone, setTransferDone] = useState<boolean>(false);
  const [downloadUrl, setDownloadUrl] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [showChunks, setShowChunks] = useState<boolean>(false);

  // Hook up engine events
  useEffect(() => {
    engine.onMetadataReceived = (metadata) => {
      setFileMetadata(metadata);
      setIsTransferring(true);
      setErrorMsg('');
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
      setStats((prev) => prev ? { ...prev, progress: 100 } : null);
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

    return () => {};
  }, [engine, fileMetadata]);

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

    engine.connectToPeer(trimmedCode);
  };

  const handleReset = () => {
    engine.cleanup();
    setCode('');
    setFileMetadata(null);
    setStats(null);
    setIsTransferring(false);
    setTransferDone(false);
    setDownloadUrl('');
    setErrorMsg('');
    setConnectionStatus('disconnected');
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

      {!fileMetadata ? (
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

          <button
            type="submit"
            className="btn-cyan"
            disabled={connectionStatus === 'connecting' || code.length !== 6}
          >
            {connectionStatus === 'connecting' ? 'Connecting to Sender...' : 'Connect & Fetch File'} <ArrowRight size={18} />
          </button>
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

          {/* TURN Connection blocker */}
          {connectionStatus === 'connected-turn' && !transferDone && (
            <div style={{
              background: '#fef2f2',
              border: '1px solid rgba(239, 68, 68, 0.25)',
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
              <p style={{ color: '#991b1b', margin: 0, fontSize: '0.85rem', lineHeight: '1.5' }}>
                Skiima detected that your connection is going through a global relay server (TURN) because direct P2P is blocked by carrier firewalls (CGNAT) or a VPN. **File sharing is blocked over relayed connections to prevent quota overages.**
              </p>
              <div style={{ background: '#ffffff', border: '1px solid #fee2e2', padding: '0.75rem', borderRadius: '10px', fontSize: '0.8rem', color: '#4a5568' }}>
                <strong style={{ color: '#1a202c' }}>How to enable P2P transfer:</strong>
                <ul style={{ margin: '0.35rem 0 0 1.25rem', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <li>Connect both devices to the <strong>same local Wi-Fi network</strong>.</li>
                  <li>Turn off cellular data hotspots.</li>
                  <li>Disable commercial/corporate VPNs on both ends.</li>
                </ul>
              </div>
            </div>
          )}

          {(isTransferring || stats) && !transferDone && (
            <div className="progress-container">
              <div className="progress-header">
                <span>Receiving File...</span>
                <span>{stats ? Math.round(stats.progress) : 0}%</span>
              </div>
              <div className="progress-track">
                <div
                  className="progress-bar cyan"
                  style={{ width: `${stats ? stats.progress : 0}%` }}
                ></div>
              </div>

              {stats && (
                <div className="stats-grid">
                  <div className="stat-item">
                    <span className="stat-label">Download Speed</span>
                    <span className="stat-value">{formatSpeed(stats.speed)}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Time Remaining</span>
                    <span className="stat-value">{stats.timeRemaining}s</span>
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
                <ChunkVisualizer progress={stats.progress} isTransferring={isTransferring} />
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

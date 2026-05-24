import React, { useState, useEffect } from 'react';
import { DownloadCloud, File, ArrowRight, RotateCcw, AlertTriangle, Radio, Download, Check } from 'lucide-react';
import { P2PEngine } from '../lib/P2PEngine';
import type { TransferStats, ConnectionStatus, FileMetadata } from '../lib/P2PEngine';
import { historyDb } from '../lib/historyDb';

interface ReceiverCardProps {
  engine: P2PEngine;
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (status: ConnectionStatus) => void;
}

export const ReceiverCard: React.FC<ReceiverCardProps> = ({
  engine,
  connectionStatus,
  setConnectionStatus,
}) => {
  const [code, setCode] = useState<string>('');
  const [fileMetadata, setFileMetadata] = useState<FileMetadata | null>(null);
  const [stats, setStats] = useState<TransferStats | null>(null);
  const [isTransferring, setIsTransferring] = useState<boolean>(false);
  const [transferDone, setTransferDone] = useState<boolean>(false);
  const [downloadUrl, setDownloadUrl] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

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

    return () => {
      // Keep engine persistent across frames
    };
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

    // Connect to sender peer
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
    
    // Programmatically trigger download of the aggregated local Blob
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = fileMetadata.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Formatting helpers
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
          <DownloadCloud size={24} style={{ color: 'var(--accent-cyan)' }} /> Receive File
        </h2>
        {connectionStatus !== 'disconnected' && (
          <span className={`status-badge ${connectionStatus}`}>
            <Radio size={14} /> {connectionStatus.replace('-', ' ').toUpperCase()}
          </span>
        )}
      </div>

      {!fileMetadata ? (
        // Code entry form
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
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              borderRadius: '12px',
              padding: '0.85rem',
              color: 'var(--accent-red)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <AlertTriangle size={18} />
              <p style={{ color: '#fca5a5', fontSize: '0.85rem' }}>{errorMsg}</p>
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
        // Active receiving details
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
          {/* File Card Info */}
          <div className="file-card" style={{ borderColor: 'rgba(6, 182, 212, 0.15)' }}>
            <div className="file-card-icon" style={{ background: 'rgba(6, 182, 212, 0.1)', color: 'var(--accent-cyan)' }}>
              <File size={24} />
            </div>
            <div className="file-info">
              <div className="file-name" title={fileMetadata.name}>{fileMetadata.name}</div>
              <div className="file-size">{formatBytes(fileMetadata.size)}</div>
            </div>
          </div>

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

          {/* Transfer stats & progress */}
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
            </div>
          )}

          {/* Complete & Download trigger */}
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
                  Ready to Save!
                </p>
                <p style={{ fontSize: '0.85rem' }}>File payload fully compiled from P2P stream chunks.</p>
              </div>

              <div style={{ display: 'flex', gap: '1rem', width: '100%', marginTop: '1.5rem' }}>
                <button
                  onClick={handleReset}
                  className="btn-primary"
                  style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border-muted)', color: 'var(--text-primary)', boxShadow: 'none' }}
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

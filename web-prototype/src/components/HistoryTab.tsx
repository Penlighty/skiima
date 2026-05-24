import React, { useState, useEffect } from 'react';
import { historyDb } from '../lib/historyDb';
import type { HistoryItem } from '../lib/historyDb';
import { File, Trash2, ArrowUpRight, ArrowDownLeft, CheckCircle, XCircle } from 'lucide-react';

export const HistoryTab: React.FC = () => {
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    setHistory(historyDb.getShareHistory());
  }, []);

  const handleClearHistory = () => {
    if (window.confirm('Are you sure you want to clear your file sharing history?')) {
      historyDb.clearShareHistory();
      setHistory([]);
    }
  };

  // Helper to format bytes
  const formatBytes = (bytes: number, decimals = 1) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  // Helper to format date
  const formatDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return 'Unknown';
    }
  };

  return (
    <div className="glass-panel" style={{ padding: '2rem', minHeight: '400px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          File Sharing History
        </h2>
        {history.length > 0 && (
          <button
            onClick={handleClearHistory}
            className="btn-primary"
            style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              color: 'var(--accent-red)',
              padding: '0.45rem 1rem',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              boxShadow: 'none'
            }}
          >
            <Trash2 size={15} /> Clear History
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div style={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
          textAlign: 'center',
          gap: '1rem',
          padding: '2rem 1rem'
        }}>
          <div style={{
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid var(--border-muted)',
            padding: '1.5rem',
            borderRadius: '50%',
            color: 'var(--text-secondary)'
          }}>
            <File size={36} />
          </div>
          <div>
            <h4 style={{ color: 'var(--text-primary)', fontWeight: 600, margin: '0 0 0.25rem 0' }}>No File Transfers Yet</h4>
            <p style={{ fontSize: '0.85rem', margin: 0 }}>Your successfully sent and received files will show up here.</p>
          </div>
        </div>
      ) : (
        <div style={{ flexGrow: 1, overflowX: 'auto', width: '100%' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {history.map((item) => {
              const isSender = item.peerRole === 'sender';
              return (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0.85rem 1rem',
                    background: 'rgba(255, 255, 255, 0.01)',
                    border: '1px solid var(--border-muted)',
                    borderRadius: '16px',
                    gap: '1rem',
                    justifyContent: 'space-between',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
                  }}
                >
                  {/* Info Block */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: 0, flexGrow: 1 }}>
                    <div style={{
                      background: isSender ? 'rgba(139, 92, 246, 0.1)' : 'rgba(6, 182, 212, 0.1)',
                      color: isSender ? 'var(--accent-purple)' : 'var(--accent-cyan)',
                      padding: '0.6rem',
                      borderRadius: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      <File size={20} />
                    </div>
                    
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 500,
                          fontSize: '0.9rem',
                          color: 'var(--text-primary)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '220px'
                        }}
                        title={item.fileName}
                      >
                        {item.fileName}
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                        <span>{formatBytes(item.fileSize)}</span>
                        <span>•</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                          {isSender ? (
                            <>
                              <ArrowUpRight size={12} style={{ color: 'var(--accent-purple)' }} />
                              to {item.peerName}
                            </>
                          ) : (
                            <>
                              <ArrowDownLeft size={12} style={{ color: 'var(--accent-cyan)' }} />
                              from {item.peerName}
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Badges and actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexShrink: 0 }}>
                    <div style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      <div>{formatDate(item.transferDate)}</div>
                      <div style={{
                        marginTop: '0.2rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        fontWeight: 600,
                        color: item.status === 'success' ? '#34d399' : '#f87171',
                        fontSize: '0.7rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}>
                        {item.status === 'success' ? (
                          <>
                            <CheckCircle size={10} /> Success
                          </>
                        ) : (
                          <>
                            <XCircle size={10} /> Failed
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

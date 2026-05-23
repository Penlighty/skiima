import { useState, useMemo, useEffect } from 'react';
import { Send, Download, Zap, Info, Shield, Globe } from 'lucide-react';
import { P2PEngine } from './lib/P2PEngine';
import type { ConnectionStatus } from './lib/P2PEngine';
import { SenderCard } from './components/SenderCard';
import { ReceiverCard } from './components/ReceiverCard';

function App() {
  const [activeTab, setActiveTab] = useState<'send' | 'receive'>('send');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');

  // Maintain a persistent P2PEngine singleton across tab views
  const engine = useMemo(() => new P2PEngine(), []);

  // Make sure we clean up Peer connections on unmount
  useEffect(() => {
    return () => {
      engine.cleanup();
    };
  }, [engine]);

  const handleTabChange = (tab: 'send' | 'receive') => {
    // If we change tabs while disconnected, cleanup any running peer instances
    if (connectionStatus === 'disconnected') {
      engine.cleanup();
    }
    setActiveTab(tab);
  };

  return (
    <>
      {/* Background neon glows */}
      <div className="pulse-bg"></div>
      <div className="pulse-bg cyan"></div>

      {/* Header */}
      <header style={{
        padding: '2.5rem 1.5rem 1.5rem',
        maxWidth: '700px',
        width: '100%',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          marginBottom: '0.75rem',
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid var(--border-muted)',
          padding: '0.5rem 1.25rem',
          borderRadius: '9999px',
          boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.05)'
        }}>
          <Zap size={18} style={{ color: 'var(--accent-purple)' }} />
          <span style={{ fontSize: '0.85rem', fontWeight: 600, letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
            100% SECURE DIRECT P2P TRANSFER
          </span>
        </div>

        <h1 style={{ fontSize: '3.2rem', marginBottom: '0.75rem' }}>Skiima Share</h1>
        <p style={{ maxWidth: '450px', fontSize: '1rem', color: 'var(--text-secondary)' }}>
          Transfer files of any size directly between browsers without uploading to any cloud servers.
        </p>
      </header>

      {/* Main Tab Controller & Panel */}
      <main style={{
        flexGrow: 1,
        maxWidth: '640px',
        width: '92%',
        margin: '0 auto 3rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.75rem'
      }}>
        
        {/* Navigation Tabs */}
        <div style={{
          display: 'flex',
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid var(--border-muted)',
          borderRadius: '9999px',
          padding: '0.35rem',
          gap: '0.35rem',
          boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.2)'
        }}>
          <button
            onClick={() => handleTabChange('send')}
            className={`nav-tab send ${activeTab === 'send' ? 'active' : ''}`}
            style={{ flexGrow: 1, justifyContent: 'center' }}
          >
            <Send size={18} /> Send File
          </button>
          
          <button
            onClick={() => handleTabChange('receive')}
            className={`nav-tab receive ${activeTab === 'receive' ? 'active' : ''}`}
            style={{ flexGrow: 1, justifyContent: 'center' }}
          >
            <Download size={18} /> Receive File
          </button>
        </div>

        {/* Dynamic Card Display */}
        {activeTab === 'send' ? (
          <SenderCard
            engine={engine}
            connectionStatus={connectionStatus}
            setConnectionStatus={setConnectionStatus}
          />
        ) : (
          <ReceiverCard
            engine={engine}
            connectionStatus={connectionStatus}
            setConnectionStatus={setConnectionStatus}
          />
        )}

        {/* Feature Highlights Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '1.25rem',
          marginTop: '0.5rem'
        }}>
          <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', gap: '0.875rem', alignItems: 'flex-start' }}>
            <div style={{ background: 'rgba(139, 92, 246, 0.1)', color: 'var(--accent-purple)', padding: '0.5rem', borderRadius: '10px' }}>
              <Shield size={20} />
            </div>
            <div>
              <h4 style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.25rem', color: 'var(--text-primary)' }}>End-to-End Privacy</h4>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Files go direct from your device to the receiver. No intermediary storage servers see your data.</p>
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', gap: '0.875rem', alignItems: 'flex-start' }}>
            <div style={{ background: 'rgba(6, 182, 212, 0.1)', color: 'var(--accent-cyan)', padding: '0.5rem', borderRadius: '10px' }}>
              <Info size={20} />
            </div>
            <div>
              <h4 style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.25rem', color: 'var(--text-primary)' }}>Zero File Limits</h4>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Stream gigabyte files securely. Speed is limited only by your direct network connection bandwidth.</p>
            </div>
          </div>
        </div>

      </main>

      {/* Footer */}
      <footer>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', marginBottom: '1rem' }}>
          <a href="https://github.com" target="_blank" rel="noreferrer" style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', fontSize: '0.85rem' }}>
            <Globe size={16} /> Web
          </a>
        </div>
        <p>© 2026 Skiima Share. Built with WebRTC, PeerJS & React.</p>
      </footer>
    </>
  );
}

export default App;

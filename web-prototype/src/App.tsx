import { useState, useMemo, useEffect } from 'react';
import { Send, Download, Zap, Info, Shield, Globe, Users, History, User, Edit2, Check, X, Radio, File, AlertTriangle } from 'lucide-react';
import { P2PEngine } from './lib/P2PEngine';
import type { ConnectionStatus } from './lib/P2PEngine';
import { SenderCard } from './components/SenderCard';
import { ReceiverCard } from './components/ReceiverCard';
import { ContactsTab } from './components/ContactsTab';
import { HistoryTab } from './components/HistoryTab';
import { presence } from './lib/presence';
import type { TransferRequest } from './lib/presence';
import { historyDb } from './lib/historyDb';

type TabType = 'send' | 'receive' | 'contacts' | 'history';

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('send');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');

  // Profile and presence states
  const [profile, setProfile] = useState<{ peerId: string; peerName: string } | null>(null);
  const [isEditingName, setIsEditingName] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>('');

  // Magic direct transfer states
  const [inboundRequest, setInboundRequest] = useState<TransferRequest | null>(null);
  const [outboundStatus, setOutboundStatus] = useState<'pending' | 'accepted' | 'declined' | null>(null);
  const [outboundMetadata, setOutboundMetadata] = useState<{ name: string; size: number } | null>(null);
  const [outboundTargetName, setOutboundTargetName] = useState<string>('');
  const [outboundCancelFn, setOutboundCancelFn] = useState<(() => void) | null>(null);

  // Maintain a persistent P2PEngine singleton across tab views
  const engine = useMemo(() => new P2PEngine(), []);

  // 1. Initialize Profile and Firestore Presence Heartbeat
  useEffect(() => {
    const prof = presence.getOrInitializePeerProfile();
    setProfile(prof);
    setNewName(prof.peerName);

    // Initial presence update
    presence.publishPresence(prof.peerId, prof.peerName, 'online');

    // Run heartbeat every 30 seconds to maintain presence
    const heartbeatInterval = setInterval(() => {
      presence.publishPresence(prof.peerId, localStorage.getItem('skiima_peer_name') || prof.peerName, 'online');
    }, 30000);

    // Set offline on tab close or navigate away
    const handleUnload = () => {
      presence.publishPresence(prof.peerId, '', 'offline');
    };
    window.addEventListener('beforeunload', handleUnload);

    // 2. Listen to Inbound Direct Transfer Requests
    const unsubscribeRequests = presence.listenToInboundRequests(prof.peerId, (req) => {
      if (req && req.status === 'pending') {
        setInboundRequest(req);
      } else {
        setInboundRequest(null);
      }
    });

    // 3. Connect P2P handshake events to populate contact registry
    engine.onPeerHandshake = (peerId, peerName) => {
      console.log(`[P2P Handshake] Connected with peer ${peerName} (${peerId})`);
      historyDb.addContact(peerId, peerName);
    };

    return () => {
      clearInterval(heartbeatInterval);
      window.removeEventListener('beforeunload', handleUnload);
      unsubscribeRequests();
      presence.publishPresence(prof.peerId, '', 'offline');
      engine.cleanup();
    };
  }, [engine]);

  const handleTabChange = (tab: TabType) => {
    // If we change tabs while disconnected, cleanup any running peer instances
    if (connectionStatus === 'disconnected') {
      engine.cleanup();
    }
    setActiveTab(tab);
  };

  const handleSaveName = () => {
    const trimmed = newName.trim();
    if (trimmed && profile) {
      presence.updatePeerName(trimmed);
      const updatedProfile = { ...profile, peerName: trimmed };
      setProfile(updatedProfile);
      setIsEditingName(false);
      // Immediately publish presence under new name
      presence.publishPresence(profile.peerId, trimmed, 'online');
    }
  };

  // === HANDLE INBOUND TRANSFER REQUEST ===

  const handleAcceptInbound = async () => {
    if (!inboundRequest || !profile) return;
    const req = inboundRequest;
    
    // 1. Mark request as accepted in Firestore
    await presence.acceptRequest(profile.peerId);
    
    // 2. Register contact in local storage
    historyDb.addContact(req.senderId, req.senderName);
    
    // 3. Close the modal
    setInboundRequest(null);

    // 4. Connect to Room instantly (skips code typing!)
    setActiveTab('receive');
    setTimeout(() => {
      engine.connectToPeer(req.code);
    }, 100);
  };

  const handleDeclineInbound = async () => {
    if (!inboundRequest || !profile) return;
    await presence.declineRequest(profile.peerId);
    setInboundRequest(null);
  };

  // === HANDLE OUTBOUND TRANSFER REQUEST ===

  const handleSelectFileForContact = async (targetPeerId: string, targetPeerName: string, file: File) => {
    if (!profile) return;

    // 1. Clean up active engine connections
    engine.cleanup();

    // 2. Generate random 6-digit room code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // 3. Initialize engine in Sender mode
    engine.initialize(code);

    // 4. Update UI states
    setOutboundStatus('pending');
    setOutboundTargetName(targetPeerName);
    setOutboundMetadata({ name: file.name, size: file.size });

    // 5. Publish request in Firestore
    const cancelFn = await presence.createOutboundRequest(
      targetPeerId,
      profile.peerId,
      profile.peerName,
      { name: file.name, size: file.size, type: file.type || 'application/octet-stream' },
      code,
      (status) => {
        setOutboundStatus(status);
        if (status === 'accepted') {
          // Receiver accepted! Engine will start streaming automatically
          // Close the sender request overlay and navigate to Send panel
          setTimeout(() => {
            setOutboundStatus(null);
            setOutboundCancelFn(null);
            setActiveTab('send');
          }, 800);
        }
      }
    );

    setOutboundCancelFn(() => cancelFn);
  };

  const handleCancelOutbound = async () => {
    if (outboundCancelFn) {
      outboundCancelFn();
      setOutboundCancelFn(null);
    }
    setOutboundStatus(null);
    setOutboundMetadata(null);
    engine.cleanup();
  };

  const formatBytes = (bytes: number, decimals = 1) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  return (
    <>
      {/* Background neon glows */}
      <div className="pulse-bg"></div>
      <div className="pulse-bg cyan"></div>

      {/* Profile Header Settings Bar */}
      {profile && (
        <div style={{
          maxWidth: '640px',
          width: '92%',
          margin: '1rem auto 0',
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0 0.5rem'
        }}>
          <div className="glass-panel" style={{
            padding: '0.5rem 1.15rem',
            borderRadius: '9999px',
            boxShadow: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            border: '1px solid var(--border-muted)',
            background: 'rgba(255, 255, 255, 0.01)'
          }}>
            <User size={14} style={{ color: 'var(--accent-cyan)' }} />
            {isEditingName ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  style={{
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid var(--border-muted)',
                    borderRadius: '8px',
                    color: 'var(--text-primary)',
                    padding: '0.2rem 0.6rem',
                    fontSize: '0.8rem',
                    width: '120px'
                  }}
                  maxLength={15}
                />
                <button onClick={handleSaveName} style={{ background: 'var(--accent-cyan)', border: 'none', color: '#000', padding: '0.25rem', borderRadius: '6px', cursor: 'pointer', display: 'flex' }}>
                  <Check size={12} />
                </button>
                <button onClick={() => { setIsEditingName(false); setNewName(profile.peerName); }} style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border-muted)', color: 'var(--text-secondary)', padding: '0.25rem', borderRadius: '6px', cursor: 'pointer', display: 'flex' }}>
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Device Name: <strong style={{ color: 'var(--accent-cyan)' }}>{profile.peerName}</strong>
                </span>
                <button onClick={() => setIsEditingName(true)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', padding: 0 }}>
                  <Edit2 size={12} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <header style={{
        padding: '1.5rem 1.5rem 1.25rem',
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
          boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.2)',
          overflowX: 'auto'
        }}>
          <button
            onClick={() => handleTabChange('send')}
            className={`nav-tab send ${activeTab === 'send' ? 'active' : ''}`}
            style={{ flexGrow: 1, justifyContent: 'center', whiteSpace: 'nowrap' }}
          >
            <Send size={16} /> Send
          </button>
          
          <button
            onClick={() => handleTabChange('receive')}
            className={`nav-tab receive ${activeTab === 'receive' ? 'active' : ''}`}
            style={{ flexGrow: 1, justifyContent: 'center', whiteSpace: 'nowrap' }}
          >
            <Download size={16} /> Receive
          </button>

          <button
            onClick={() => handleTabChange('contacts')}
            className={`nav-tab send ${activeTab === 'contacts' ? 'active' : ''}`}
            style={{ flexGrow: 1, justifyContent: 'center', whiteSpace: 'nowrap' }}
          >
            <Users size={16} /> Contacts
          </button>

          <button
            onClick={() => handleTabChange('history')}
            className={`nav-tab receive ${activeTab === 'history' ? 'active' : ''}`}
            style={{ flexGrow: 1, justifyContent: 'center', whiteSpace: 'nowrap' }}
          >
            <History size={16} /> History
          </button>
        </div>

        {/* Dynamic Panel Display */}
        {activeTab === 'send' && (
          <SenderCard
            engine={engine}
            connectionStatus={connectionStatus}
            setConnectionStatus={setConnectionStatus}
          />
        )}
        
        {activeTab === 'receive' && (
          <ReceiverCard
            engine={engine}
            connectionStatus={connectionStatus}
            setConnectionStatus={setConnectionStatus}
          />
        )}

        {activeTab === 'contacts' && (
          <ContactsTab onSelectFileForContact={handleSelectFileForContact} />
        )}

        {activeTab === 'history' && (
          <HistoryTab />
        )}

        {/* Feature Highlights Grid (Only show on Send/Receive tabs) */}
        {(activeTab === 'send' || activeTab === 'receive') && (
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
        )}

      </main>

      {/* Footer */}
      <footer>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', marginBottom: '1rem' }}>
          <a href="https://github.com" target="_blank" rel="noreferrer" style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', fontSize: '0.85rem' }}>
            <Globe size={16} /> Web
          </a>
        </div>
        <p>© 2026 Skiima Share. Built with WebRTC, Firebase & React.</p>
      </footer>

      {/* === MODAL OVERLAY: INBOUND DIRECT REQUEST === */}
      {inboundRequest && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(15, 12, 27, 0.7)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div className="glass-panel" style={{
            maxWidth: '440px',
            width: '100%',
            padding: '2rem',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
            border: '1px solid rgba(6, 182, 212, 0.2)',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
          }}>
            <div>
              <div style={{
                background: 'rgba(6, 182, 212, 0.1)',
                color: 'var(--accent-cyan)',
                padding: '1rem',
                borderRadius: '50%',
                display: 'inline-flex',
                marginBottom: '1rem',
                boxShadow: '0 0 20px rgba(6, 182, 212, 0.1)'
              }}>
                <Download size={28} />
              </div>
              <h3 style={{ margin: '0 0 0.5rem 0', fontWeight: 600, color: 'var(--text-primary)' }}>Incoming Magic Transfer</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                <strong style={{ color: 'var(--accent-cyan)' }}>{inboundRequest.senderName}</strong> wants to send you a file directly:
              </p>
            </div>

            {/* File details card */}
            <div className="file-card" style={{ background: 'rgba(255, 255, 255, 0.02)', borderColor: 'var(--border-muted)', padding: '0.85rem 1rem' }}>
              <div className="file-card-icon" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}>
                <File size={20} />
              </div>
              <div className="file-info" style={{ textAlign: 'left' }}>
                <div className="file-name" style={{ fontSize: '0.85rem' }} title={inboundRequest.fileMetadata.name}>
                  {inboundRequest.fileMetadata.name}
                </div>
                <div className="file-size" style={{ fontSize: '0.75rem' }}>
                  {formatBytes(inboundRequest.fileMetadata.size)}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.85rem', marginTop: '0.5rem' }}>
              <button
                onClick={handleDeclineInbound}
                className="btn-primary"
                style={{
                  flexGrow: 1,
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  color: 'var(--accent-red)',
                  boxShadow: 'none'
                }}
              >
                Decline
              </button>
              
              <button
                onClick={handleAcceptInbound}
                className="btn-cyan"
                style={{ flexGrow: 2 }}
              >
                Accept & Receive
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === MODAL OVERLAY: OUTBOUND QUICK SEND REQUEST === */}
      {outboundStatus && outboundMetadata && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(15, 12, 27, 0.7)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div className="glass-panel" style={{
            maxWidth: '440px',
            width: '100%',
            padding: '2rem',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
            border: outboundStatus === 'declined' ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid rgba(139, 92, 246, 0.2)',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
          }}>
            {outboundStatus === 'pending' && (
              <div>
                <div style={{ position: 'relative', display: 'inline-flex', marginBottom: '1rem' }}>
                  <div style={{
                    background: 'rgba(139, 92, 246, 0.1)',
                    color: 'var(--accent-purple)',
                    padding: '1rem',
                    borderRadius: '50%',
                    display: 'inline-flex'
                  }}>
                    <Radio size={28} className="ping-animate" />
                  </div>
                </div>
                
                <h3 style={{ margin: '0 0 0.5rem 0', fontWeight: 600, color: 'var(--text-primary)' }}>Sending Transfer Request</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                  Waiting for <strong style={{ color: 'var(--accent-purple)' }}>{outboundTargetName}</strong> to accept your file:
                </p>
              </div>
            )}

            {outboundStatus === 'accepted' && (
              <div>
                <div style={{
                  background: 'rgba(16, 185, 129, 0.1)',
                  color: 'var(--accent-green)',
                  padding: '1rem',
                  borderRadius: '50%',
                  display: 'inline-flex',
                  marginBottom: '1rem'
                }}>
                  <Check size={28} />
                </div>
                <h3 style={{ margin: '0 0 0.5rem 0', fontWeight: 600, color: 'var(--text-primary)' }}>Request Accepted!</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                  Connecting peer and launching WebRTC direct stream channel...
                </p>
              </div>
            )}

            {outboundStatus === 'declined' && (
              <div>
                <div style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: 'var(--accent-red)',
                  padding: '1rem',
                  borderRadius: '50%',
                  display: 'inline-flex',
                  marginBottom: '1rem'
                }}>
                  <AlertTriangle size={28} />
                </div>
                <h3 style={{ margin: '0 0 0.5rem 0', fontWeight: 600, color: 'var(--text-primary)' }}>Request Declined</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                  <strong style={{ color: 'var(--accent-red)' }}>{outboundTargetName}</strong> declined your transfer request.
                </p>
              </div>
            )}

            {/* File info card */}
            <div className="file-card" style={{ background: 'rgba(255, 255, 255, 0.02)', borderColor: 'var(--border-muted)', padding: '0.85rem 1rem' }}>
              <div className="file-card-icon" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}>
                <File size={20} />
              </div>
              <div className="file-info" style={{ textAlign: 'left' }}>
                <div className="file-name" style={{ fontSize: '0.85rem' }} title={outboundMetadata.name}>
                  {outboundMetadata.name}
                </div>
                <div className="file-size" style={{ fontSize: '0.75rem' }}>
                  {formatBytes(outboundMetadata.size)}
                </div>
              </div>
            </div>

            <div>
              {outboundStatus === 'pending' ? (
                <button
                  onClick={handleCancelOutbound}
                  className="btn-primary"
                  style={{
                    width: '100%',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    color: 'var(--accent-red)',
                    boxShadow: 'none'
                  }}
                >
                  Cancel Request
                </button>
              ) : outboundStatus === 'declined' ? (
                <button
                  onClick={handleCancelOutbound}
                  className="btn-primary"
                  style={{ width: '100%', border: '1px solid var(--border-muted)' }}
                >
                  Close
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;

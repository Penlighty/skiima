import { useState, useMemo, useEffect, useRef } from 'react';
import { Download, Zap, Info, Shield, Globe, History, User, Edit2, Check, X, Radio, File, AlertTriangle, ArrowUpRight, ArrowDownLeft, UploadCloud, DownloadCloud, ChevronRight, MessageCircle, Sun, Moon, Monitor } from 'lucide-react';
import { P2PEngine } from './lib/P2PEngine';
import type { ConnectionStatus } from './lib/P2PEngine';
import { SenderCard } from './components/SenderCard';
import { ReceiverCard } from './components/ReceiverCard';
import { presence } from './lib/presence';
import type { TransferRequest } from './lib/presence';
import { historyDb } from './lib/historyDb';
import type { ContactItem, HistoryItem } from './lib/historyDb';

type ViewType = 'dashboard' | 'send' | 'receive' | 'profile' | 'history_full';
type ThemeMode = 'light' | 'dark' | 'system';

function App() {
  const [activeView, setActiveView] = useState<ViewType>('dashboard');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');

  // Theme settings state
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem('skiima_theme_mode') as ThemeMode) || 'system';
  });

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
  const [quickSendFile, setQuickSendFile] = useState<File | null>(null);
  const [resumeHistoryItem, setResumeHistoryItem] = useState<HistoryItem | null>(null);
  const [initialReceiverCode, setInitialReceiverCode] = useState<string>('');

  // Contacts and recent history states
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [recentHistory, setRecentHistory] = useState<HistoryItem[]>([]);
  const [fullHistory, setFullHistory] = useState<HistoryItem[]>([]);
  const [activePresence, setActivePresence] = useState<Record<string, { status: 'online' | 'offline'; lastSeen: string; peerName: string }>>({});

  // Quick Send file chooser trigger state
  const quickSendFileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedQuickSendContact, setSelectedQuickSendContact] = useState<{ id: string; name: string } | null>(null);

  // Maintain a persistent P2PEngine singleton across views
  const engine = useMemo(() => new P2PEngine(), []);

  // 1. Theme Mode Management Effect
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-light', 'theme-dark');
    
    localStorage.setItem('skiima_theme_mode', themeMode);
    
    if (themeMode === 'light') {
      root.classList.add('theme-light');
    } else if (themeMode === 'dark') {
      root.classList.add('theme-dark');
    } else {
      // System mode: CSS @media query prefers-color-scheme handles it automatically
    }
  }, [themeMode]);

  // 1.5. Resilient Session Recovery & URL Param Detection on Mount
  useEffect(() => {
    // A. Parse URL ?room=xxxxxx parameter
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam && roomParam.length === 6 && !isNaN(Number(roomParam))) {
      window.history.replaceState({}, document.title, window.location.pathname);
      console.log('[Resilience] Found room code in URL parameters:', roomParam);
      setInitialReceiverCode(roomParam);
      setActiveView('receive');
      return;
    }

    // B. Check for active transfer session in localStorage
    const activeSessionRaw = localStorage.getItem('skiima_active_transfer_session');
    if (activeSessionRaw) {
      try {
        const session = JSON.parse(activeSessionRaw);
        if (session && session.roomCode) {
          console.log('[Resilience] Found unfinished active transfer session:', session);
          if (session.role === 'sender' && session.fileMetadata) {
            const dummyHistoryItem: HistoryItem = {
              id: `hist_recover_${Math.random().toString(36).substring(2, 8)}`,
              fileName: session.fileMetadata.name,
              fileSize: session.fileMetadata.size,
              transferDate: new Date().toISOString(),
              peerRole: 'sender',
              peerId: 'recovered',
              peerName: 'Paired Device',
              status: 'failed'
            };
            setResumeHistoryItem(dummyHistoryItem);
            localStorage.setItem('skiima_recovered_room_code', session.roomCode);
            setActiveView('send');
          } else if (session.role === 'receiver') {
            setInitialReceiverCode(session.roomCode);
            setActiveView('receive');
          }
        }
      } catch (e) {
        console.warn('Failed to parse active transfer session recovery:', e);
        localStorage.removeItem('skiima_active_transfer_session');
      }
    }
  }, []);

  // 2. Initialize Profile and Firestore Presence Heartbeat
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

    // Listen to Inbound Direct Transfer Requests
    const unsubscribeRequests = presence.listenToInboundRequests(prof.peerId, (req) => {
      if (req && req.status === 'pending') {
        setInboundRequest(req);
      } else {
        setInboundRequest(null);
      }
    });

    // Connect P2P handshake events to populate contact registry
    engine.onPeerHandshake = (peerId, peerName) => {
      console.log(`[P2P Handshake] Connected with peer ${peerName} (${peerId})`);
      historyDb.addContact(peerId, peerName);
      setContacts(historyDb.getContacts());
    };

    return () => {
      clearInterval(heartbeatInterval);
      window.removeEventListener('beforeunload', handleUnload);
      unsubscribeRequests();
      presence.publishPresence(prof.peerId, '', 'offline');
      engine.cleanup();
    };
  }, [engine]);

  // Load database lists on view change
  useEffect(() => {
    const list = historyDb.getContacts();
    setContacts(list);
    setRecentHistory(historyDb.getShareHistory().slice(0, 3));
    setFullHistory(historyDb.getShareHistory());

    // Subscribe to each contact's presence in Firestore
    const unsubscribers = list.map((contact) => {
      return presence.subscribeToPeerPresence(contact.peerId, (data) => {
        if (data) {
          setActivePresence((prev) => ({
            ...prev,
            [contact.peerId]: {
              status: data.status,
              lastSeen: data.lastSeen,
              peerName: data.peerName
            }
          }));
        } else {
          setActivePresence((prev) => {
            const copy = { ...prev };
            delete copy[contact.peerId];
            return copy;
          });
        }
      });
    });

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [activeView]);

  const handleViewChange = (view: ViewType) => {
    if (connectionStatus === 'disconnected') {
      engine.cleanup();
    }
    setActiveView(view);
  };

  const handleSaveName = () => {
    const trimmed = newName.trim();
    if (trimmed && profile) {
      presence.updatePeerName(trimmed);
      const updatedProfile = { ...profile, peerName: trimmed };
      setProfile(updatedProfile);
      setIsEditingName(false);
      presence.publishPresence(profile.peerId, trimmed, 'online');
    }
  };

  const isPeerOnline = (peerId: string): boolean => {
    const data = activePresence[peerId];
    if (!data || data.status !== 'online') return false;
    
    try {
      const diff = Date.now() - new Date(data.lastSeen).getTime();
      return diff < 60000;
    } catch {
      return false;
    }
  };

  const getWhatsAppBeepUrl = (peerName: string) => {
    const message = `Hey ${peerName}! I want to send you a file on Skiima Share. Open https://skiima.vercel.app/ so we can do a secure direct P2P transfer.`;
    return `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
  };

  // === HANDLE INBOUND TRANSFER REQUEST ===
  const handleAcceptInbound = async () => {
    if (!inboundRequest || !profile) return;
    const req = inboundRequest;
    await presence.acceptRequest(profile.peerId);
    historyDb.addContact(req.senderId, req.senderName);
    setInboundRequest(null);

    setActiveView('receive');
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

    engine.cleanup();
    setQuickSendFile(file);

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    engine.initialize(code);

    setOutboundStatus('pending');
    setOutboundTargetName(targetPeerName);
    setOutboundMetadata({ name: file.name, size: file.size });

    const cancelFn = await presence.createOutboundRequest(
      targetPeerId,
      profile.peerId,
      profile.peerName,
      { name: file.name, size: file.size, type: file.type || 'application/octet-stream' },
      code,
      (status) => {
        setOutboundStatus(status);
        if (status === 'accepted') {
          setTimeout(() => {
            setOutboundStatus(null);
            setOutboundCancelFn(null);
            setActiveView('send');
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

  const handleQuickSendAvatarClick = (peerId: string, peerName: string) => {
    setSelectedQuickSendContact({ id: peerId, name: peerName });
    if (quickSendFileInputRef.current) {
      quickSendFileInputRef.current.click();
    }
  };

  const handleQuickSendFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0 && selectedQuickSendContact) {
      const file = e.target.files[0];
      handleSelectFileForContact(selectedQuickSendContact.id, selectedQuickSendContact.name, file);
      setSelectedQuickSendContact(null);
      e.target.value = '';
    }
  };

  const handleClearHistory = () => {
    if (window.confirm('Are you sure you want to clear your file sharing history?')) {
      historyDb.clearShareHistory();
      setFullHistory([]);
      setRecentHistory([]);
    }
  };

  const handleClearContacts = () => {
    if (window.confirm('Are you sure you want to clear your saved contacts list?')) {
      historyDb.clearContacts();
      setContacts([]);
    }
  };

  const formatBytes = (bytes: number, decimals = 1) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

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



  const statsCalculated = useMemo(() => {
    const history = historyDb.getShareHistory().filter(item => item.status === 'success');
    const sent = history.filter(item => item.peerRole === 'sender');
    const received = history.filter(item => item.peerRole === 'receiver');
    return {
      total: history.length,
      sent: sent.length,
      received: received.length
    };
  }, [activeView]);

  const weeklyActivityData = useMemo(() => {
    const history = historyDb.getShareHistory().filter(item => item.status === 'success');
    const activity = [0, 0, 0, 0, 0, 0, 0];
    history.forEach(item => {
      try {
        const date = new Date(item.transferDate);
        const day = date.getDay();
        activity[day]++;
      } catch (e) {
        console.error(e);
      }
    });
    return activity;
  }, [activeView]);

  const maxWeeklyActivityValue = Math.max(...weeklyActivityData, 1);
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Toggle the theme mode in a single cycling sequence: Light -> Dark -> System
  const toggleTheme = () => {
    setThemeMode((prev) => {
      if (prev === 'light') return 'dark';
      if (prev === 'dark') return 'system';
      return 'light';
    });
  };

  // Global Theme Selector Component (Single Cycling Toggle)
  const renderThemeSelector = () => {
    const getThemeIcon = () => {
      switch (themeMode) {
        case 'light': return <Sun size={18} style={{ color: '#eab308' }} />;
        case 'dark': return <Moon size={18} style={{ color: '#ff5b7f' }} />;
        case 'system': return <Monitor size={18} style={{ color: '#8176f2' }} />;
      }
    };

    const getThemeTitle = () => {
      switch (themeMode) {
        case 'light': return 'Theme: Light (Click to cycle)';
        case 'dark': return 'Theme: Dark (Click to cycle)';
        case 'system': return 'Theme: System Sync (Click to cycle)';
      }
    };

    return (
      <button
        onClick={toggleTheme}
        className="theme-selector-btn active"
        style={{
          width: '38px',
          height: '38px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-input)',
          border: '1px solid var(--border-input)',
          cursor: 'pointer',
          boxShadow: 'var(--shadow-tactile)',
          transition: 'var(--transition-fast)',
          padding: 0
        }}
        title={getThemeTitle()}
      >
        {getThemeIcon()}
      </button>
    );
  };

  return (
    <>
      {/* Hidden file input for Quick Send */}
      <input
        type="file"
        ref={quickSendFileInputRef}
        onChange={handleQuickSendFileChange}
        style={{ display: 'none' }}
      />

      {/* Main Container */}
      <main style={{
        flexGrow: 1,
        maxWidth: '640px',
        width: '92%',
        margin: '2rem auto 3rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem'
      }}>
        {/* Unified Responsive Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0.25rem 0.5rem',
          marginTop: '0.5rem',
          borderBottom: '1px solid var(--border-muted)',
          paddingBottom: '1rem'
        }}>
          <div 
            onClick={() => handleViewChange('dashboard')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}
            title="Go to Dashboard"
          >
            <img src="/favicon.svg" alt="Skiima Logo" className="header-logo" />
            <h1 className="header-title">
              Skiima<span>Share</span>
            </h1>
          </div>

          {/* Theme toggler and Profile Avatar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {renderThemeSelector()}

            {profile && (
              <button
                onClick={() => handleViewChange('profile')}
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #8176f2 0%, #5649e7 100%)',
                  color: '#ffffff',
                  border: '3px solid var(--bg-dark)',
                  boxShadow: 'var(--shadow-tactile)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '1rem',
                  cursor: 'pointer',
                  outline: 'none',
                  transition: 'var(--transition-fast)'
                }}
                className="btn-icon-copy"
                title="View Profile Settings"
              >
                {profile.peerName.charAt(0).toUpperCase()}
              </button>
            )}
          </div>
        </div>

        {/* ---------------- 1. DASHBOARD VIEW ---------------- */}
        {activeView === 'dashboard' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {/* Quick Secure Badge */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              background: 'var(--bg-glass)',
              border: '1px solid var(--border-muted)',
              padding: '0.65rem 1.25rem',
              borderRadius: '9999px',
              boxShadow: 'var(--shadow-tactile)',
              alignSelf: 'center'
            }}>
              <Zap size={15} style={{ color: 'var(--accent-purple)' }} />
              <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
                100% SECURE DIRECT P2P SHARING
              </span>
            </div>

            {/* Hero Cards Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '1.25rem'
            }} className="hero-grid">
              
              {/* Send Hero (Rose Card) */}
              <div style={{
                background: 'linear-gradient(135deg, #ff5b7f 0%, #fc3657 100%)',
                borderRadius: '24px',
                padding: '1.5rem',
                color: '#ffffff',
                boxShadow: 'var(--shadow-rose)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                minHeight: '210px',
                transition: 'var(--transition-smooth)'
              }}>
                <div>
                  <div style={{
                    background: 'rgba(255, 255, 255, 0.18)',
                    width: '40px',
                    height: '40px',
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '1rem'
                  }}>
                    <UploadCloud size={22} style={{ color: '#ffffff' }} />
                  </div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.35rem 0' }}>Send</h3>
                  <p style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.85)', margin: 0, lineHeight: 1.4 }}>
                    Stream files P2P directly to any nearby device.
                  </p>
                </div>
                <button
                  onClick={() => handleViewChange('send')}
                  style={{
                    background: '#ffffff',
                    border: 'none',
                    color: '#fc3657',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    padding: '0.65rem 1rem',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    boxShadow: '0 4px 10px rgba(0, 0, 0, 0.05)',
                    transition: 'var(--transition-fast)'
                  }}
                  className="btn-icon-copy"
                >
                  Send File
                </button>
              </div>

              {/* Receive Hero (Indigo Card) */}
              <div style={{
                background: 'linear-gradient(135deg, #8176f2 0%, #5649e7 100%)',
                borderRadius: '24px',
                padding: '1.5rem',
                color: '#ffffff',
                boxShadow: 'var(--shadow-indigo)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                minHeight: '210px',
                transition: 'var(--transition-smooth)'
              }}>
                <div>
                  <div style={{
                    background: 'rgba(255, 255, 255, 0.18)',
                    width: '40px',
                    height: '40px',
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '1rem'
                  }}>
                    <DownloadCloud size={22} style={{ color: '#ffffff' }} />
                  </div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.35rem 0' }}>Receive</h3>
                  <p style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.85)', margin: 0, lineHeight: 1.4 }}>
                    Enter room key code to fetch streamed P2P payloads.
                  </p>
                </div>
                <button
                  onClick={() => handleViewChange('receive')}
                  style={{
                    background: '#ffffff',
                    border: 'none',
                    color: '#5649e7',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    padding: '0.65rem 1rem',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    boxShadow: '0 4px 10px rgba(0, 0, 0, 0.05)',
                    transition: 'var(--transition-fast)'
                  }}
                  className="btn-icon-copy"
                >
                  Receive File
                </button>
              </div>

            </div>

            {/* Quick Send Scrollable Row */}
            <div className="glass-panel" style={{ padding: '1.25rem 1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                  Quick Send Contacts
                </h3>
                {contacts.length > 0 && (
                  <button
                    onClick={() => handleViewChange('profile')}
                    style={{ background: 'none', border: 'none', color: 'var(--accent-cyan)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', padding: 0 }}
                  >
                    Manage
                  </button>
                )}
              </div>

              {contacts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '1rem 0.5rem', color: 'var(--text-secondary)' }}>
                  <p style={{ fontSize: '0.85rem', margin: 0 }}>
                    No contacts recorded yet. Connect with someone via key exchange to unlock magic Quick Share transfers!
                  </p>
                </div>
              ) : (
                <div style={{
                  display: 'flex',
                  gap: '1.25rem',
                  overflowX: 'auto',
                  padding: '0.25rem 0 0.5rem',
                  scrollbarWidth: 'none'
                }}>
                  {contacts.map((contact) => {
                    const online = isPeerOnline(contact.peerId);
                    const displayName = activePresence[contact.peerId]?.peerName || contact.peerName;
                    
                    return (
                      <div
                        key={contact.peerId}
                        onClick={() => handleQuickSendAvatarClick(contact.peerId, displayName)}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '0.4rem',
                          cursor: 'pointer',
                          flexShrink: 0,
                          width: '64px'
                        }}
                      >
                        <div style={{ position: 'relative' }}>
                          <div style={{
                            width: '52px',
                            height: '52px',
                            borderRadius: '50%',
                            background: online ? 'rgba(129, 118, 242, 0.08)' : 'var(--bg-input)',
                            border: online ? '2px solid var(--accent-cyan)' : '2px solid var(--border-input)',
                            color: online ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: '1.1rem',
                            boxShadow: online ? '0 0 10px rgba(129, 118, 242, 0.2)' : 'none',
                            transition: 'var(--transition-smooth)'
                          }}>
                            {displayName.charAt(0).toUpperCase()}
                          </div>
                          
                          {online && (
                            <span style={{
                              position: 'absolute',
                              bottom: '1px',
                              right: '1px',
                              width: '12px',
                              height: '12px',
                              background: '#10b981',
                              borderRadius: '50%',
                              border: '2px solid var(--bg-dark)',
                              boxShadow: '0 0 6px #10b981',
                              animation: 'ringPulse 1.5s infinite'
                            }} />
                          )}
                        </div>
                        <span style={{
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: 'var(--text-secondary)',
                          textAlign: 'center',
                          width: '100%',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}>
                          {displayName}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Latest Activities Ledger (Recent Shares) */}
            <div className="glass-panel" style={{
              padding: '1.25rem 1.5rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                  Latest Activity
                </h3>
                {recentHistory.length > 0 && (
                  <button
                    onClick={() => handleViewChange('history_full')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--accent-cyan)',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.2rem'
                    }}
                  >
                    See All <ChevronRight size={14} />
                  </button>
                )}
              </div>

              {recentHistory.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '1.5rem 0.5rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                  <File size={32} style={{ color: 'var(--text-muted)' }} />
                  <p style={{ fontSize: '0.85rem', margin: 0 }}>
                    No file transfers yet. Send or receive files to build up your history ledger.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {recentHistory.map((item) => {
                    const isSender = item.peerRole === 'sender';
                    return (
                      <div
                        key={item.id}
                        className="history-item-card"
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0, flexGrow: 1 }}>
                          <div style={{
                            background: isSender ? 'rgba(255, 91, 127, 0.08)' : 'rgba(129, 118, 242, 0.08)',
                            color: isSender ? '#ff5b7f' : '#8176f2',
                            padding: '0.55rem',
                            borderRadius: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                          }}>
                            {isSender ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}
                          </div>
                          
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontWeight: 600,
                                fontSize: '0.85rem',
                                color: 'var(--text-primary)',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                maxWidth: '180px'
                              }}
                              title={item.fileName}
                            >
                              {item.fileName}
                            </div>
                            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                              <span>{formatBytes(item.fileSize)}</span>
                              <span>•</span>
                              <span>{isSender ? `to ${item.peerName}` : `from ${item.peerName}`}</span>
                            </div>
                          </div>
                        </div>

                        <div className="right-block" style={{ textAlign: 'right', fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
                          <div>{formatDate(item.transferDate)}</div>
                          <div style={{
                            fontWeight: 700,
                            color: item.status === 'success' ? '#10b981' : '#ef4444',
                            textTransform: 'uppercase',
                            letterSpacing: '0.03em',
                            fontSize: '0.65rem'
                          }}>
                            {item.status === 'success' ? 'Success' : 'Failed'}
                          </div>
                          {item.status === 'failed' && (
                            <button
                              onClick={() => {
                                setResumeHistoryItem(item);
                                setActiveView(item.peerRole === 'sender' ? 'send' : 'receive');
                              }}
                              className="btn-cyan"
                              style={{
                                padding: '0.25rem 0.5rem',
                                fontSize: '0.65rem',
                                borderRadius: '8px',
                                width: 'auto',
                                boxShadow: 'none',
                                marginTop: '0.25rem',
                                cursor: 'pointer'
                              }}
                            >
                              Restart
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Feature Highlights Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '1.25rem',
              marginTop: '0.25rem'
            }}>
              <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', gap: '0.875rem', alignItems: 'flex-start' }}>
                <div style={{ background: 'rgba(255, 91, 127, 0.08)', color: '#ff5b7f', padding: '0.5rem', borderRadius: '10px' }}>
                  <Shield size={20} />
                </div>
                <div>
                  <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.25rem', color: 'var(--text-primary)' }}>End-to-End Privacy</h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>No intermediary cloud servers touch or retain your data payloads. Files stream directly browser-to-browser.</p>
                </div>
              </div>

              <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', gap: '0.875rem', alignItems: 'flex-start' }}>
                <div style={{ background: 'rgba(129, 118, 242, 0.08)', color: '#8176f2', padding: '0.5rem', borderRadius: '10px' }}>
                  <Info size={20} />
                </div>
                <div>
                  <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.25rem', color: 'var(--text-primary)' }}>Unlimited File Sizes</h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Send small files or gigabyte packages. Streams bypass direct size limits, leveraging WebRTC data channels.</p>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ---------------- 2. SEND FILE VIEW ---------------- */}
        {activeView === 'send' && (
          <SenderCard
            engine={engine}
            connectionStatus={connectionStatus}
            setConnectionStatus={setConnectionStatus}
            initialFile={quickSendFile}
            onClearInitialFile={() => setQuickSendFile(null)}
            onBack={() => {
              setResumeHistoryItem(null);
              handleViewChange('dashboard');
            }}
            resumeHistoryItem={resumeHistoryItem}
            onClearResumeHistoryItem={() => setResumeHistoryItem(null)}
          />
        )}

        {/* ---------------- 3. RECEIVE FILE VIEW ---------------- */}
        {activeView === 'receive' && (
          <ReceiverCard
            engine={engine}
            connectionStatus={connectionStatus}
            setConnectionStatus={setConnectionStatus}
            onBack={() => {
              setResumeHistoryItem(null);
              handleViewChange('dashboard');
            }}
            resumeHistoryItem={resumeHistoryItem}
            onClearResumeHistoryItem={() => setResumeHistoryItem(null)}
            initialCode={initialReceiverCode}
            onClearInitialCode={() => setInitialReceiverCode('')}
          />
        )}

        {/* ---------------- 4. FULL HISTORY VIEW ---------------- */}
        {activeView === 'history_full' && (
          <div className="glass-panel" style={{ padding: '2rem', minHeight: '400px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifySelf: 'flex-start', borderBottom: '1px solid var(--border-muted)', paddingBottom: '1rem', marginBottom: '1.5rem', width: '100%' }}>
              <button 
                onClick={() => handleViewChange('dashboard')} 
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
                  marginRight: '0.75rem'
                }}
                className="btn-icon-copy"
              >
                <X size={18} />
              </button>
              <h2 style={{ fontSize: '1.25rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <History size={20} style={{ color: 'var(--accent-cyan)' }} /> Sharing History
              </h2>
              {fullHistory.length > 0 && (
                <button
                  onClick={handleClearHistory}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent-red)',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: 0,
                    marginLeft: 'auto'
                  }}
                >
                  Clear All
                </button>
              )}
            </div>

            {fullHistory.length === 0 ? (
              <div style={{
                flexGrow: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-secondary)',
                textAlign: 'center',
                gap: '1rem',
                padding: '3rem 1rem'
              }}>
                <File size={36} style={{ color: 'var(--text-muted)' }} />
                <div>
                  <h4 style={{ color: 'var(--text-primary)', fontWeight: 700 }}>No File Shares Recorded</h4>
                  <p style={{ fontSize: '0.85rem' }}>Completed transfers will appear here in chronological logs.</p>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', overflowY: 'auto', maxHeight: '500px' }}>
                {fullHistory.map((item) => {
                  const isSender = item.peerRole === 'sender';
                  return (
                    <div
                      key={item.id}
                      className="history-item-card"
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0, flexGrow: 1 }}>
                        <div style={{
                          background: isSender ? 'rgba(255, 91, 127, 0.08)' : 'rgba(129, 118, 242, 0.08)',
                          color: isSender ? '#ff5b7f' : '#8176f2',
                          padding: '0.55rem',
                          borderRadius: '10px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          {isSender ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}
                        </div>
                        
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontWeight: 600,
                              fontSize: '0.85rem',
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
                          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                            <span>{formatBytes(item.fileSize)}</span>
                            <span>•</span>
                            <span>{isSender ? `to ${item.peerName}` : `from ${item.peerName}`}</span>
                          </div>
                        </div>
                      </div>

                      <div className="right-block" style={{ textAlign: 'right', fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
                        <div>{formatDate(item.transferDate)}</div>
                        <div style={{
                          fontWeight: 700,
                          color: item.status === 'success' ? '#10b981' : '#ef4444',
                          textTransform: 'uppercase',
                          letterSpacing: '0.03em',
                          fontSize: '0.65rem'
                        }}>
                          {item.status === 'success' ? 'Success' : 'Failed'}
                        </div>
                        {item.status === 'failed' && (
                          <button
                            onClick={() => {
                              setResumeHistoryItem(item);
                              setActiveView(item.peerRole === 'sender' ? 'send' : 'receive');
                            }}
                            className="btn-cyan"
                            style={{
                              padding: '0.25rem 0.5rem',
                              fontSize: '0.65rem',
                              borderRadius: '8px',
                              width: 'auto',
                              boxShadow: 'none',
                              marginTop: '0.25rem',
                              cursor: 'pointer'
                            }}
                          >
                            Restart
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ---------------- 5. USER PROFILE SHEET VIEW ---------------- */}
        {activeView === 'profile' && (
          <div className="glass-panel" style={{ padding: '2rem', minHeight: '400px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            
            {/* Header controls */}
            <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-muted)', paddingBottom: '1rem' }}>
              <button 
                onClick={() => handleViewChange('dashboard')} 
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
                  marginRight: '0.75rem'
                }}
                className="btn-icon-copy"
              >
                <X size={18} />
              </button>
              <h2 style={{ fontSize: '1.25rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <User size={20} style={{ color: 'var(--accent-cyan)' }} /> User Profile
              </h2>
            </div>

            {/* Profile Initials Block & Editing Device Name */}
            {profile && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '1rem',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-input)',
                padding: '1.5rem',
                borderRadius: '24px',
                boxShadow: 'var(--shadow-tactile)'
              }}>
                <div style={{
                  width: '72px',
                  height: '72px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #ff5b7f 0%, #fc3657 100%)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '1.75rem',
                  boxShadow: 'var(--shadow-rose)'
                }}>
                  {profile.peerName.charAt(0).toUpperCase()}
                </div>

                <div style={{ textAlign: 'center', width: '100%' }}>
                  {isEditingName ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', maxWidth: '280px', margin: '0 auto' }}>
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        className="input-field"
                        style={{
                          padding: '0.4rem 0.8rem',
                          fontSize: '0.9rem',
                          textAlign: 'center'
                        }}
                        maxLength={15}
                      />
                      <button onClick={handleSaveName} style={{ background: 'var(--accent-cyan)', border: 'none', color: '#fff', padding: '0.45rem', borderRadius: '8px', cursor: 'pointer', display: 'flex' }}>
                        <Check size={16} />
                      </button>
                      <button onClick={() => { setIsEditingName(false); setNewName(profile.peerName); }} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border-input)', color: 'var(--text-secondary)', padding: '0.45rem', borderRadius: '8px', cursor: 'pointer', display: 'flex' }}>
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {profile.peerName}
                      </span>
                      <button onClick={() => setIsEditingName(true)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: '0.2rem' }}>
                        <Edit2 size={14} />
                      </button>
                    </div>
                  )}
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', fontFamily: 'var(--font-mono)' }}>
                    Device ID: {profile.peerId}
                  </p>
                </div>
              </div>
            )}

            {/* Appearance settings card */}
            <div>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.65rem' }}>
                App Appearance
              </h3>
              <div style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--border-input)',
                padding: '0.85rem 1.25rem',
                borderRadius: '20px',
                boxShadow: 'var(--shadow-tactile)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Theme Mode
                </span>
                {renderThemeSelector()}
              </div>
            </div>

            {/* Real-time Stats Grid */}
            <div>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.65rem' }}>
                Sharing Statistics
              </h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '0.75rem'
              }}>
                <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border-input)', padding: '0.85rem 0.5rem', borderRadius: '16px', textAlign: 'center', boxShadow: 'var(--shadow-tactile)' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.25rem' }}>Shares</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{statsCalculated.total}</div>
                </div>
                <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border-input)', padding: '0.85rem 0.5rem', borderRadius: '16px', textAlign: 'center', boxShadow: 'var(--shadow-tactile)' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.25rem' }}>Sent</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ff5b7f', fontFamily: 'var(--font-mono)' }}>{statsCalculated.sent}</div>
                </div>
                <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border-input)', padding: '0.85rem 0.5rem', borderRadius: '16px', textAlign: 'center', boxShadow: 'var(--shadow-tactile)' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.25rem' }}>Received</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#8176f2', fontFamily: 'var(--font-mono)' }}>{statsCalculated.received}</div>
                </div>
              </div>
            </div>

            {/* Aesthetic CSS Activity Bar Chart */}
            <div>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.65rem' }}>
                Weekly Activity
              </h3>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-end',
                height: '135px',
                padding: '1.15rem 0.75rem 0.75rem',
                background: 'var(--bg-input)',
                borderRadius: '20px',
                border: '1px solid var(--border-input)',
                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.01)'
              }}>
                {weeklyActivityData.map((val, idx) => {
                  const pct = (val / maxWeeklyActivityValue) * 100;
                  const heightPct = val > 0 ? Math.max(pct, 12) : 6;
                  
                  return (
                    <div key={idx} style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '0.35rem',
                      flexGrow: 1
                    }}>
                      <span style={{
                        fontSize: '0.68rem',
                        color: val > 0 ? 'var(--accent-cyan)' : 'var(--text-muted)',
                        fontWeight: 700,
                        fontFamily: 'var(--font-mono)'
                      }}>
                        {val}
                      </span>
                      <div style={{
                        width: '12px',
                        height: '64px',
                        background: 'var(--bg-grid-block)',
                        borderRadius: '9999px',
                        position: 'relative',
                        overflow: 'hidden'
                      }}>
                        <div style={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          height: `${heightPct}%`,
                          background: val > 0 ? 'linear-gradient(180deg, var(--accent-cyan) 0%, #5649e7 100%)' : 'var(--bg-grid-block)',
                          borderRadius: '9999px',
                          transition: 'height 0.4s ease-out'
                        }} />
                      </div>
                      <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                        {daysOfWeek[idx]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Saved Contacts Registry management list */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                  Contacts Registry
                </h3>
                {contacts.length > 0 && (
                  <button
                    onClick={handleClearContacts}
                    style={{ background: 'none', border: 'none', color: 'var(--accent-red)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', padding: 0 }}
                  >
                    Clear All
                  </button>
                )}
              </div>

              {contacts.length === 0 ? (
                <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border-input)', padding: '1.25rem', borderRadius: '16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  No saved contacts yet. Direct P2P transfers save linked contacts automatically.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', overflowY: 'auto', maxHeight: '180px' }}>
                  {contacts.map((contact) => {
                    const online = isPeerOnline(contact.peerId);
                    const displayName = activePresence[contact.peerId]?.peerName || contact.peerName;
                    
                    return (
                      <div
                        key={contact.peerId}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: '0.65rem 0.85rem',
                          background: 'var(--bg-input)',
                          border: '1px solid var(--border-input)',
                          borderRadius: '14px',
                          gap: '0.75rem',
                          justifyContent: 'space-between'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
                          <div style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            background: online ? 'rgba(129, 118, 242, 0.08)' : 'var(--bg-grid-block)',
                            color: online ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: '0.85rem',
                            flexShrink: 0
                          }}>
                            {displayName.charAt(0).toUpperCase()}
                          </div>
                          
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>
                              {displayName}
                            </div>
                            <div style={{ fontSize: '0.65rem', color: online ? '#10b981' : 'var(--text-muted)', fontWeight: 600 }}>
                              {online ? 'ONLINE NOW' : 'Offline'}
                            </div>
                          </div>
                        </div>

                        {!online && (
                          <a
                            href={getWhatsAppBeepUrl(displayName)}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              background: 'var(--bg-dark)',
                              border: '1px solid var(--border-input)',
                              color: '#25D366',
                              padding: '0.3rem 0.6rem',
                              fontSize: '0.7rem',
                              fontWeight: 600,
                              textDecoration: 'none',
                              borderRadius: '8px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.25rem'
                            }}
                          >
                            <MessageCircle size={12} /> Beep
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        )}

      </main>

      {/* Footer */}
      <footer style={{
        marginTop: 'auto',
        padding: '2.5rem 1.5rem',
        textAlign: 'center',
        background: 'var(--bg-dark)',
        borderTop: '1px solid var(--border-muted)',
        width: '100%'
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', marginBottom: '0.85rem' }}>
          <a href="https://github.com/penlighty/skiima" target="_blank" rel="noreferrer" style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', fontSize: '0.85rem', fontWeight: 500 }}>
            <Globe size={16} />penlighty/skiima
          </a>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
          © 2026 Skiima Share. Built with WebRTC direct P2P data channels, Firestore presence signaling & React.
        </p>
      </footer>

      {/* === MODAL OVERLAY: INBOUND DIRECT TRANSFER REQUEST === */}
      {inboundRequest && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(15, 12, 27, 0.4)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div className="glass-panel" style={{
            maxWidth: '400px',
            width: '100%',
            padding: '2rem',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
            border: '1px solid rgba(129, 118, 242, 0.2)',
            boxShadow: '0 25px 50px -12px rgba(13, 20, 43, 0.15)'
          }}>
            <div>
              <div style={{
                background: 'rgba(129, 118, 242, 0.08)',
                color: 'var(--accent-cyan)',
                padding: '1rem',
                borderRadius: '50%',
                display: 'inline-flex',
                marginBottom: '0.85rem',
                boxShadow: '0 8px 16px rgba(129, 118, 242, 0.1)'
              }}>
                <Download size={24} />
              </div>
              <h3 style={{ margin: '0 0 0.35rem 0', fontWeight: 700, color: 'var(--text-primary)', fontSize: '1.2rem' }}>Magic Transfer Inbound</h3>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                <strong style={{ color: 'var(--accent-cyan)' }}>{inboundRequest.senderName}</strong> wants to stream a file to you directly:
              </p>
            </div>

            {/* File details card */}
            <div className="file-card" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-input)', padding: '0.75rem 0.85rem', marginBottom: 0 }}>
              <div className="file-card-icon" style={{ background: 'var(--bg-grid-container)', color: 'var(--text-secondary)', padding: '0.65rem' }}>
                <File size={18} />
              </div>
              <div className="file-info" style={{ textAlign: 'left' }}>
                <div className="file-name" style={{ fontSize: '0.8rem', fontWeight: 600 }} title={inboundRequest.fileMetadata.name}>
                  {inboundRequest.fileMetadata.name}
                </div>
                <div className="file-size" style={{ fontSize: '0.7rem' }}>
                  {formatBytes(inboundRequest.fileMetadata.size)}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
              <button
                onClick={handleDeclineInbound}
                className="btn-primary"
                style={{
                  flexGrow: 1,
                  background: '#fef2f2',
                  border: '1px solid rgba(239, 68, 68, 0.15)',
                  color: 'var(--accent-red)',
                  boxShadow: 'none',
                  padding: '0.65rem'
                }}
              >
                Decline
              </button>
              
              <button
                onClick={handleAcceptInbound}
                className="btn-cyan"
                style={{ flexGrow: 2, padding: '0.65rem' }}
              >
                Accept & Receive
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === MODAL OVERLAY: OUTBOUND QUICK SEND LOADER === */}
      {outboundStatus && outboundMetadata && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(15, 12, 27, 0.4)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div className="glass-panel" style={{
            maxWidth: '400px',
            width: '100%',
            padding: '2rem',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
            border: outboundStatus === 'declined' ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid rgba(129, 118, 242, 0.2)',
            boxShadow: '0 25px 50px -12px rgba(13, 20, 43, 0.15)'
          }}>
            {outboundStatus === 'pending' && (
              <div>
                <div style={{ position: 'relative', display: 'inline-flex', marginBottom: '0.85rem' }}>
                  <div style={{
                    background: 'rgba(255, 91, 127, 0.08)',
                    color: '#ff5b7f',
                    padding: '1rem',
                    borderRadius: '50%',
                    display: 'inline-flex'
                  }}>
                    <Radio size={24} style={{ animation: 'ringPulse 1.5s infinite' }} />
                  </div>
                </div>
                
                <h3 style={{ margin: '0 0 0.35rem 0', fontWeight: 700, color: 'var(--text-primary)', fontSize: '1.2rem' }}>Awaiting Approval</h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                  Waiting for <strong style={{ color: 'var(--accent-purple)' }}>{outboundTargetName}</strong> to accept your stream request:
                </p>
              </div>
            )}

            {outboundStatus === 'accepted' && (
              <div>
                <div style={{
                  background: 'rgba(16, 185, 129, 0.08)',
                  color: 'var(--accent-green)',
                  padding: '1rem',
                  borderRadius: '50%',
                  display: 'inline-flex',
                  marginBottom: '0.85rem'
                }}>
                  <Check size={24} />
                </div>
                <h3 style={{ margin: '0 0 0.35rem 0', fontWeight: 700, color: 'var(--text-primary)', fontSize: '1.2rem' }}>Request Approved!</h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
                  Connecting WebRTC channel and initiating peer direct data stream...
                </p>
              </div>
            )}

            {outboundStatus === 'declined' && (
              <div>
                <div style={{
                  background: '#fef2f2',
                  color: 'var(--accent-red)',
                  padding: '1rem',
                  borderRadius: '50%',
                  display: 'inline-flex',
                  marginBottom: '0.85rem',
                  border: '1px solid rgba(239, 68, 68, 0.15)'
                }}>
                  <AlertTriangle size={24} />
                </div>
                <h3 style={{ margin: '0 0 0.35rem 0', fontWeight: 700, color: 'var(--text-primary)', fontSize: '1.2rem' }}>Request Declined</h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
                  <strong style={{ color: 'var(--accent-red)' }}>{outboundTargetName}</strong> declined your transfer request.
                </p>
              </div>
            )}

            {/* File info card */}
            <div className="file-card" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-input)', padding: '0.75rem 0.85rem', marginBottom: 0 }}>
              <div className="file-card-icon" style={{ background: 'var(--bg-grid-container)', color: 'var(--text-secondary)', padding: '0.65rem' }}>
                <File size={18} />
              </div>
              <div className="file-info" style={{ textAlign: 'left' }}>
                <div className="file-name" style={{ fontSize: '0.8rem', fontWeight: 600 }} title={outboundMetadata.name}>
                  {outboundMetadata.name}
                </div>
                <div className="file-size" style={{ fontSize: '0.7rem' }}>
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
                    background: '#fef2f2',
                    border: '1px solid rgba(239, 68, 68, 0.15)',
                    color: 'var(--accent-red)',
                    boxShadow: 'none',
                    padding: '0.65rem'
                  }}
                >
                  Cancel Request
                </button>
              ) : outboundStatus === 'declined' ? (
                <button
                  onClick={handleCancelOutbound}
                  className="btn-primary"
                  style={{ width: '100%', border: '1px solid var(--border-input)', background: 'var(--bg-dark)', color: 'var(--text-primary)', boxShadow: 'none', padding: '0.65rem' }}
                >
                  Close
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Global CSS Pulser Keyframes for indicators */}
      <style>{`
        @keyframes ringPulse {
          0% {
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4);
          }
          70% {
            box-shadow: 0 0 0 6px rgba(16, 185, 129, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
          }
        }
      `}</style>
    </>
  );
}

export default App;

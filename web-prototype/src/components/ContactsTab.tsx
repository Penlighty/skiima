import React, { useState, useEffect } from 'react';
import { historyDb } from '../lib/historyDb';
import type { ContactItem } from '../lib/historyDb';
import { presence } from '../lib/presence';
import { Users, Trash2, Send, MessageCircle, Radio, Clock } from 'lucide-react';

interface ContactsTabProps {
  onSelectFileForContact: (peerId: string, peerName: string, file: File) => void;
}

export const ContactsTab: React.FC<ContactsTabProps> = ({ onSelectFileForContact }) => {
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [activePresence, setActivePresence] = useState<Record<string, { status: 'online' | 'offline'; lastSeen: string; peerName: string }>>({});

  // Hidden file input reference to handle Quick Send trigger
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [selectedContact, setSelectedContact] = useState<{ id: string; name: string } | null>(null);

  // Load contacts
  useEffect(() => {
    const list = historyDb.getContacts();
    setContacts(list);

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
  }, []);

  const handleClearContacts = () => {
    if (window.confirm('Are you sure you want to clear your saved contacts list?')) {
      historyDb.clearContacts();
      setContacts([]);
    }
  };

  const handleQuickSendClick = (peerId: string, peerName: string) => {
    setSelectedContact({ id: peerId, name: peerName });
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0 && selectedContact) {
      const file = e.target.files[0];
      onSelectFileForContact(selectedContact.id, selectedContact.name, file);
      // Reset state
      setSelectedContact(null);
      e.target.value = '';
    }
  };

  // Check if peer is online based on heartbeat updated in last 60 seconds
  const isPeerOnline = (peerId: string): boolean => {
    const data = activePresence[peerId];
    if (!data || data.status !== 'online') return false;
    
    try {
      const diff = Date.now() - new Date(data.lastSeen).getTime();
      return diff < 60000; // Online if updated within last 60s
    } catch {
      return false;
    }
  };

  // Compile WhatsApp Beeper url
  const getWhatsAppBeepUrl = (peerName: string) => {
    const message = `Hey ${peerName}! I want to send you a file on Skiima Share. Open https://skiima.vercel.app/ so we can do a secure direct P2P transfer.`;
    return `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
  };

  return (
    <div className="glass-panel" style={{ padding: '2rem', minHeight: '400px', display: 'flex', flexDirection: 'column' }}>
      {/* Hidden input for triggering file chooser */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          Contacts Directory
        </h2>
        {contacts.length > 0 && (
          <button
            onClick={handleClearContacts}
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
            <Trash2 size={15} /> Reset Contacts
          </button>
        )}
      </div>

      {contacts.length === 0 ? (
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
            <Users size={36} />
          </div>
          <div>
            <h4 style={{ color: 'var(--text-primary)', fontWeight: 600, margin: '0 0 0.25rem 0' }}>No Contacts Yet</h4>
            <p style={{ fontSize: '0.85rem', margin: 0 }}>Contacts appear automatically once you connect with someone via code entry.</p>
          </div>
        </div>
      ) : (
        <div style={{ flexGrow: 1, overflowY: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {contacts.map((contact) => {
              const online = isPeerOnline(contact.peerId);
              // Fetch latest live name from firebase status, fallback to local database contact list name
              const displayName = activePresence[contact.peerId]?.peerName || contact.peerName;

              return (
                <div
                  key={contact.peerId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0.85rem 1.15rem',
                    background: 'rgba(255, 255, 255, 0.01)',
                    border: '1px solid var(--border-muted)',
                    borderRadius: '16px',
                    gap: '1rem',
                    justifyContent: 'space-between',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.02)'
                  }}
                >
                  {/* Left Peer Profile & Status */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: 0 }}>
                    <div style={{ position: 'relative' }}>
                      <div style={{
                        background: online ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                        color: online ? 'var(--accent-green)' : 'var(--text-secondary)',
                        border: '1px solid var(--border-muted)',
                        padding: '0.6rem',
                        borderRadius: '50%',
                        width: '40px',
                        height: '40px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 600,
                        fontSize: '0.95rem'
                      }}>
                        {displayName.charAt(0).toUpperCase()}
                      </div>
                      
                      {/* Real-time Indicator Ring */}
                      <span style={{
                        position: 'absolute',
                        bottom: '2px',
                        right: '2px',
                        width: '10px',
                        height: '10px',
                        background: online ? '#10b981' : '#6b7280',
                        borderRadius: '50%',
                        border: '2px solid #0f0c1b',
                        boxShadow: online ? '0 0 8px #10b981' : 'none'
                      }}></span>
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: '0.95rem', color: 'var(--text-primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {displayName}
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                        {online ? (
                          <span style={{ color: 'var(--accent-green)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                            <Radio size={11} className="ping-animate" /> ONLINE NOW
                          </span>
                        ) : (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                            <Clock size={11} /> Offline
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions Block */}
                  <div style={{ display: 'flex', gap: '0.6rem', flexShrink: 0 }}>
                    {online ? (
                      <button
                        onClick={() => handleQuickSendClick(contact.peerId, displayName)}
                        className="btn-cyan"
                        style={{
                          padding: '0.45rem 1rem',
                          fontSize: '0.8rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          borderRadius: '12px'
                        }}
                      >
                        <Send size={14} /> Quick Send
                      </button>
                    ) : (
                      <a
                        href={getWhatsAppBeepUrl(displayName)}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-primary"
                        style={{
                          background: 'rgba(37, 211, 102, 0.1)',
                          border: '1px solid rgba(37, 211, 102, 0.2)',
                          color: '#25D366',
                          padding: '0.45rem 1rem',
                          fontSize: '0.8rem',
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          borderRadius: '12px',
                          boxShadow: 'none'
                        }}
                      >
                        <MessageCircle size={14} /> Beep Peer
                      </a>
                    )}
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

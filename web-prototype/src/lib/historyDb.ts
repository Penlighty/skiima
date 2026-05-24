export interface HistoryItem {
  id: string;
  fileName: string;
  fileSize: number;
  transferDate: string;
  peerRole: 'sender' | 'receiver';
  peerId: string;
  peerName: string;
  status: 'success' | 'failed';
  downloadUrl?: string; // Cacheable during session
}

export interface ContactItem {
  peerId: string;
  peerName: string;
  lastSeen: string;
}

const HISTORY_KEY = 'skiima_history_ledger';
const CONTACTS_KEY = 'skiima_contact_registry';

/**
 * Loads list from localStorage with fallback
 */
function loadList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error(`Failed to parse local storage for key ${key}:`, e);
    return [];
  }
}

/**
 * Saves list to localStorage
 */
function saveList<T>(key: string, list: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch (e) {
    console.error(`Failed to save to local storage for key ${key}:`, e);
  }
}

export const historyDb = {
  // === HISTORY LEDGER ===

  getShareHistory(): HistoryItem[] {
    return loadList<HistoryItem>(HISTORY_KEY).sort(
      (a, b) => new Date(b.transferDate).getTime() - new Date(a.transferDate).getTime()
    );
  },

  addShareHistoryItem(item: Omit<HistoryItem, 'id' | 'transferDate'>): HistoryItem {
    const history = loadList<HistoryItem>(HISTORY_KEY);
    const newItem: HistoryItem = {
      ...item,
      id: `hist_${Math.random().toString(36).substring(2, 10)}`,
      transferDate: new Date().toISOString(),
    };
    
    // Cap history at 100 entries to prevent local storage bloat
    const updated = [newItem, ...history].slice(0, 100);
    saveList(HISTORY_KEY, updated);
    return newItem;
  },

  clearShareHistory(): void {
    saveList(HISTORY_KEY, []);
  },

  // === CONTACT REGISTRY ===

  getContacts(): ContactItem[] {
    return loadList<ContactItem>(CONTACTS_KEY).sort(
      (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
    );
  },

  addContact(peerId: string, peerName: string): ContactItem {
    if (!peerId || peerId === 'unknown') {
      return { peerId: 'unknown', peerName: 'Anonymous Peer', lastSeen: new Date().toISOString() };
    }

    const contacts = loadList<ContactItem>(CONTACTS_KEY);
    const existingIndex = contacts.findIndex((c) => c.peerId === peerId);

    const newContact: ContactItem = {
      peerId,
      peerName: peerName || 'Anonymous Peer',
      lastSeen: new Date().toISOString(),
    };

    if (existingIndex > -1) {
      contacts[existingIndex] = newContact;
    } else {
      contacts.push(newContact);
    }

    saveList(CONTACTS_KEY, contacts);
    return newContact;
  },

  removeContact(peerId: string): void {
    const contacts = loadList<ContactItem>(CONTACTS_KEY);
    const filtered = contacts.filter((c) => c.peerId !== peerId);
    saveList(CONTACTS_KEY, filtered);
  },

  clearContacts(): void {
    saveList(CONTACTS_KEY, []);
  }
};

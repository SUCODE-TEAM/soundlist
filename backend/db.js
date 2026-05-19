import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient, ObjectId } from 'mongodb';
import crypto from 'crypto';

const ENCRYPTION_KEY = 'musicflow-secure-encryption-key!'; // 32 bytes key
const IV_LENGTH = 16;

function decrypt(text) {
  if (!text || !text.startsWith('enc:')) return text;
  try {
    const parts = text.substring(4).split(':');
    const iv = Buffer.from(parts.shift(), 'hex');
    const encryptedText = Buffer.from(parts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (err) {
    console.error('[DB] Failed to decrypt MONGODB_URI:', err.message);
    return text;
  }
}

const MONGODB_URI = decrypt(process.env.MONGODB_URI);
const DB_NAME = 'musicflow';

let mongoClient = null;
let mongoDb = null;

// Fallback JSON-file database setup for localhost relative to this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JSON_DB_PATH = path.join(__dirname, 'db.json');

// Local memory storage that syncs to db.json
let localDb = {
  users: [],
  sessions: [],
  parties: []
};

// Load db.json if exists
function loadLocalDb() {
  try {
    if (fs.existsSync(JSON_DB_PATH)) {
      const data = fs.readFileSync(JSON_DB_PATH, 'utf8');
      localDb = JSON.parse(data);
    } else {
      saveLocalDb();
    }
  } catch (err) {
    console.error('Error loading local DB:', err);
  }
}

function saveLocalDb() {
  try {
    fs.writeFileSync(JSON_DB_PATH, JSON.stringify(localDb, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving local DB:', err);
  }
}

export async function initDb() {
  if (MONGODB_URI) {
    try {
      console.log('[DB] Connecting to MongoDB Atlas...');
      mongoClient = new MongoClient(MONGODB_URI);
      await mongoClient.connect();
      mongoDb = mongoClient.db(DB_NAME);
      console.log('[DB] MongoDB Connected successfully.');
    } catch (err) {
      console.error('[DB] MongoDB Connection failed, falling back to local file:', err.message);
      loadLocalDb();
    }
  } else {
    console.log('[DB] No MONGODB_URI specified. Using local db.json database.');
    loadLocalDb();
  }
}

// ─── User APIs ───

export async function findUserByUsername(username) {
  const normUsername = username.toLowerCase().trim();
  if (mongoDb) {
    const user = await mongoDb.collection('users').findOne({ username: normUsername });
    if (user) user.id = user._id.toString();
    return user;
  } else {
    const user = localDb.users.find(u => u.username === normUsername);
    return user ? { ...user } : null;
  }
}

export async function findUserById(id) {
  if (mongoDb) {
    try {
      const user = await mongoDb.collection('users').findOne({ _id: new ObjectId(id) });
      if (user) user.id = user._id.toString();
      return user;
    } catch { return null; }
  } else {
    const user = localDb.users.find(u => u.id === id);
    return user ? { ...user } : null;
  }
}

export async function saveUser(user) {
  const normUsername = user.username.toLowerCase().trim();
  const userDoc = {
    username: normUsername,
    name: user.name,
    salt: user.salt,
    hash: user.hash,
    provider: user.provider || 'local',
    providerId: user.providerId || null,
    avatar: user.avatar || '',
    createdAt: Date.now()
  };

  if (mongoDb) {
    const res = await mongoDb.collection('users').insertOne(userDoc);
    return { id: res.insertedId.toString(), ...userDoc };
  } else {
    const id = Math.random().toString(36).substring(2, 11);
    const newUser = { id, ...userDoc };
    localDb.users.push(newUser);
    saveLocalDb();
    return newUser;
  }
}

// ─── Session APIs ───

export async function createSession(session) {
  const sessionDoc = {
    token: session.token,
    userId: session.userId,
    username: session.username,
    name: session.name,
    avatar: session.avatar || '',
    expiresAt: session.expiresAt
  };

  if (mongoDb) {
    await mongoDb.collection('sessions').insertOne(sessionDoc);
  } else {
    localDb.sessions.push(sessionDoc);
    saveLocalDb();
  }
  return sessionDoc;
}

export async function findSessionByToken(token) {
  if (mongoDb) {
    const session = await mongoDb.collection('sessions').findOne({ token });
    if (session && session.expiresAt < Date.now()) {
      await mongoDb.collection('sessions').deleteOne({ token });
      return null;
    }
    return session;
  } else {
    const session = localDb.sessions.find(s => s.token === token);
    if (session && session.expiresAt < Date.now()) {
      localDb.sessions = localDb.sessions.filter(s => s.token !== token);
      saveLocalDb();
      return null;
    }
    return session ? { ...session } : null;
  }
}

export async function deleteSession(token) {
  if (mongoDb) {
    await mongoDb.collection('sessions').deleteOne({ token });
  } else {
    localDb.sessions = localDb.sessions.filter(s => s.token !== token);
    saveLocalDb();
  }
}

// ─── Party APIs ───

export async function getParty(partyId) {
  const normId = partyId.toUpperCase().trim();
  if (mongoDb) {
    const party = await mongoDb.collection('parties').findOne({ partyId: normId });
    if (party) {
      party.id = party._id.toString();
      // Clean up stale participants (haven't pinged in 6 seconds)
      const now = Date.now();
      const activeParticipants = (party.participants || []).filter(p => now - p.ping < 6000);
      if (activeParticipants.length !== (party.participants || []).length) {
        await mongoDb.collection('parties').updateOne(
          { partyId: normId },
          { $set: { participants: activeParticipants } }
        );
        party.participants = activeParticipants;
      }
    }
    return party;
  } else {
    const party = localDb.parties.find(p => p.partyId === normId);
    if (party) {
      const now = Date.now();
      party.participants = (party.participants || []).filter(p => now - p.ping < 6000);
      saveLocalDb();
      return { ...party };
    }
    return null;
  }
}

export async function saveParty(party) {
  const normId = party.partyId.toUpperCase().trim();
  const partyDoc = {
    partyId: normId,
    hostId: party.hostId,
    hostName: party.hostName,
    currentTrack: party.currentTrack || null,
    isPlaying: party.isPlaying || false,
    currentTime: party.currentTime || 0,
    lastUpdated: party.lastUpdated || Date.now(),
    participants: party.participants || [],
    chat: party.chat || [],
    createdAt: party.createdAt || Date.now()
  };

  if (mongoDb) {
    await mongoDb.collection('parties').updateOne(
      { partyId: normId },
      { $set: partyDoc },
      { upsert: true }
    );
  } else {
    const idx = localDb.parties.findIndex(p => p.partyId === normId);
    if (idx >= 0) {
      localDb.parties[idx] = { ...partyDoc };
    } else {
      localDb.parties.push(partyDoc);
    }
    saveLocalDb();
  }
  return partyDoc;
}

export async function deleteParty(partyId) {
  const normId = partyId.toUpperCase().trim();
  if (mongoDb) {
    await mongoDb.collection('parties').deleteOne({ partyId: normId });
  } else {
    localDb.parties = localDb.parties.filter(p => p.partyId !== normId);
    saveLocalDb();
  }
}

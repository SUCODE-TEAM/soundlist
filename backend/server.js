import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import {
  initDb,
  findUserByUsername,
  findUserById,
  saveUser,
  createSession,
  findSessionByToken,
  deleteSession,
  getParty,
  saveParty,
  deleteParty
} from './db.js';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Initialize database
initDb().catch(err => console.error('[DB] Failed to initialize:', err));

// ─── Invidious API instances ───
const INVIDIOUS_INSTANCES = [
  'https://inv.thepixora.com',
  'https://yt.chocolatemoo53.com',
];

// Dynamically fetch and cache working instances with API enabled
let cachedInstances = null;
let lastInstanceFetch = 0;

async function getInstances() {
  const now = Date.now();
  // Cache for 10 minutes
  if (cachedInstances && now - lastInstanceFetch < 600000) {
    return cachedInstances;
  }

  try {
    const res = await fetch('https://api.invidious.io/instances.json?sort_by=type,health', {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      const working = data
        .filter(([_, info]) =>
          info.type === 'https' &&
          info.monitor?.uptime > 80 &&
          !info.monitor?.down
        )
        .map(([_, info]) => info.uri);

      if (working.length > 0) {
        // Merge with our verified instances to guarantee at least those are present
        const merged = [...new Set([...working, ...INVIDIOUS_INSTANCES])];
        cachedInstances = merged;
        lastInstanceFetch = now;
        console.log(`[Invidious] Fetched ${working.length} instances, merged to ${merged.length} active instances.`);
        return merged;
      }
    }
  } catch (e) {
    console.log('[Invidious] Failed to fetch instance list, using defaults');
  }

  return INVIDIOUS_INSTANCES;
}

async function fetchWithFallback(path, instances = null) {
  const list = instances || await getInstances();

  for (const instance of list) {
    try {
      const url = `${instance}${path}`;
      console.log(`[Try] ${url}`);
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: {
          'Accept': 'application/json',
        }
      });
      if (res.ok) {
        const data = await res.json();
        return data;
      }
      console.log(`[Invidious] ${instance} returned ${res.status}`);
    } catch (e) {
      console.log(`[Invidious] ${instance} failed: ${e.message}`);
    }
  }
  throw new Error('All instances failed');
}

// ─── Filter: only real music content ───
const NON_MUSIC_KEYWORDS = [
  '#shorts', 'shorts', 'short',
  'live stream', 'livestream', 'streaming live',
  'podcast', 'full album', 'full ep',
  'compilation', 'megamix', 'nonstop',
  'reaction', 'react to', 'reacting',
  'behind the scene', 'interview', 'unboxing',
  'tutorial', 'how to', 'diy',
  'gameplay', 'gaming', 'playthrough',
  'asmr', 'mukbang',
  'vlog', 'daily vlog',
  'trailer', 'teaser',
];

function isMusicContent(item) {
  const duration = item.lengthSeconds || 0;
  if (duration < 60 || duration > 600) return false;
  if (item.liveNow || item.isUpcoming) return false;
  const title = (item.title || '').toLowerCase();
  for (const kw of NON_MUSIC_KEYWORDS) {
    if (title.includes(kw)) return false;
  }
  return true;
}

function mapToTrack(item) {
  return {
    id: item.videoId || '',
    title: item.title || 'Unknown',
    artist: (item.author || 'Unknown').replace(' - Topic', ''),
    thumbnail: `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
    duration: item.lengthSeconds || 0,
    views: item.viewCount || 0,
  };
}

// ─── Search music ───
app.get('/api/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Missing query' });

    const data = await fetchWithFallback(
      `/api/v1/search?q=${encodeURIComponent(q)}&type=video&sort_by=relevance`
    );

    const items = (data || [])
      .filter(item => item.type === 'video' && isMusicContent(item))
      .slice(0, 25)
      .map(mapToTrack);

    res.json({ results: items });
  } catch (err) {
    console.error('[Search Error]', err.message);
    res.status(500).json({ error: 'Search failed', details: err.message });
  }
});

// ─── Trending music ───
app.get('/api/trending', async (req, res) => {
  try {
    const region = req.query.region || 'ID';

    // Try trending API first
    try {
      const data = await fetchWithFallback(
        `/api/v1/trending?type=Music&region=${region}`
      );

      const items = (data || [])
        .filter(item => isMusicContent(item))
        .slice(0, 20)
        .map(mapToTrack);

      if (items.length > 0) {
        return res.json({ results: items });
      }
    } catch (e) {
      console.log('[Trending] Trending API failed, falling back to search');
    }

    // Fallback: search for popular music
    const popularQueries = [
      'lagu terbaru 2026 official audio',
      'top hits indonesia music video',
      'trending lagu indonesia terbaru',
      'lagu pop indonesia terbaru official',
    ];
    const query = popularQueries[Math.floor(Math.random() * popularQueries.length)];

    const data = await fetchWithFallback(
      `/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`
    );

    const items = (data || [])
      .filter(item => item.type === 'video' && isMusicContent(item))
      .slice(0, 20)
      .map(mapToTrack);

    res.json({ results: items });
  } catch (err) {
    console.error('[Trending Error]', err.message);
    res.status(500).json({ error: 'Failed to fetch trending', details: err.message });
  }
});

// ─── Get video details (for audio stream info) ───
app.get('/api/stream/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const data = await fetchWithFallback(`/api/v1/videos/${videoId}`);

    // Get audio-only adaptive formats
    const audioStreams = (data.adaptiveFormats || [])
      .filter(f => f.type?.startsWith('audio/'))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    res.json({
      title: data.title,
      uploader: data.author,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      duration: data.lengthSeconds,
      audioStreams: audioStreams.map(s => ({
        url: s.url,
        mimeType: s.type,
        bitrate: s.bitrate,
        quality: s.audioQuality,
      })),
    });
  } catch (err) {
    console.error('[Stream Error]', err.message);
    res.status(500).json({ error: 'Failed to get stream', details: err.message });
  }
});

// ─── Lyrics from lrclib.net ───
app.get('/api/lyrics', async (req, res) => {
  try {
    const { title, artist } = req.query;
    if (!title) return res.status(400).json({ error: 'Missing title' });

    let url = `https://lrclib.net/api/search?q=${encodeURIComponent(title)}`;
    if (artist) url += `&artist_name=${encodeURIComponent(artist)}`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'MusicFlow/1.0' },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) throw new Error('Lyrics API error');

    const data = await response.json();

    if (data && data.length > 0) {
      const match = data[0];
      res.json({
        found: true,
        synced: !!match.syncedLyrics,
        syncedLyrics: match.syncedLyrics || null,
        plainLyrics: match.plainLyrics || null,
        title: match.trackName,
        artist: match.artistName,
      });
    } else {
      res.json({ found: false });
    }
  } catch (err) {
    console.error('[Lyrics Error]', err.message);
    res.json({ found: false, error: err.message });
  }
});

// ─── Cryptography Helpers ───
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, originalHash) {
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === originalHash;
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ─── Auth Middleware ───
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const session = await findSessionByToken(token);
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
    }
    req.user = session;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Authentication check failed' });
  }
}

// ─── Auth APIs ───

// Register Local User
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, name, password } = req.body;
    if (!username || !name || !password) {
      return res.status(400).json({ error: 'Username, name, and password are required' });
    }

    const existing = await findUserByUsername(username);
    if (existing) {
      return res.status(400).json({ error: 'Username is already taken' });
    }

    const { salt, hash } = hashPassword(password);
    const newUser = await saveUser({
      username,
      name,
      salt,
      hash,
      provider: 'local',
      avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`
    });

    const token = generateToken();
    const session = await createSession({
      token,
      userId: newUser.id,
      username: newUser.username,
      name: newUser.name,
      avatar: newUser.avatar,
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    res.status(201).json({ token, user: { userId: newUser.id, username: newUser.username, name: newUser.name, provider: 'local', avatar: newUser.avatar } });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed', details: err.message });
  }
});

// Login Local User
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await findUserByUsername(username);
    if (!user || user.provider !== 'local' || !user.hash) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const isValid = verifyPassword(password, user.salt, user.hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = generateToken();
    const session = await createSession({
      token,
      userId: user.id,
      username: user.username,
      name: user.name,
      avatar: user.avatar,
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    res.json({ token, user: { userId: user.id, username: user.username, name: user.name, provider: 'local', avatar: user.avatar } });
  } catch (err) {
    res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

// Social and Guest Logins
app.post('/api/auth/oauth', async (req, res) => {
  try {
    const { provider, providerId, name, username, avatar } = req.body;
    if (!provider || !name) {
      return res.status(400).json({ error: 'Provider and name are required' });
    }

    let finalUsername = (username || '').toLowerCase().trim();
    if (provider === 'guest') {
      if (!finalUsername) {
        finalUsername = 'guest_' + Math.random().toString(36).substring(2, 7);
      }
      
      const existing = await findUserByUsername(finalUsername);
      if (existing) {
        return res.status(400).json({ error: 'Username is already taken' });
      }
    } else {
      // For social auth like github, google, fb
      if (!finalUsername) {
        finalUsername = `${provider}_${providerId || Math.random().toString(36).substring(2, 7)}`;
      }
    }

    // Try finding by username
    let user = await findUserByUsername(finalUsername);
    if (!user) {
      // Create user
      user = await saveUser({
        username: finalUsername,
        name,
        salt: '',
        hash: '',
        provider,
        providerId: providerId || null,
        avatar: avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`
      });
    }

    const token = generateToken();
    const session = await createSession({
      token,
      userId: user.id,
      username: user.username,
      name: user.name,
      avatar: user.avatar,
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
    });

    res.json({ token, user: { userId: user.id, username: user.username, name: user.name, provider, avatar: user.avatar } });
  } catch (err) {
    res.status(500).json({ error: 'Authentication failed', details: err.message });
  }
});

// Get User Profile
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  res.json({ user: { userId: req.user.userId, username: req.user.username, name: req.user.name, provider: req.user.provider || 'local', avatar: req.user.avatar } });
});

// Logout
app.post('/api/auth/logout', authMiddleware, async (req, res) => {
  try {
    await deleteSession(req.headers.authorization.split(' ')[1]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

// ─── Listen Party (Sync & Chat) APIs ───

// Global map to store active SSE connections for each party room
const partyStreams = new Map(); // partyId (string) -> Set of response objects

// Helper function to broadcast update to a room
function broadcastToParty(partyId, type, data) {
  const normId = partyId.toUpperCase().trim();
  const clients = partyStreams.get(normId);
  if (clients && clients.size > 0) {
    const payload = JSON.stringify({ type, ...data });
    for (const res of clients) {
      try {
        res.write(`data: ${payload}\n\n`);
      } catch (err) {
        console.error('SSE write error:', err);
      }
    }
  }
}

// SSE Stream for real-time room updates
app.get('/api/party/stream', async (req, res) => {
  const partyId = (req.query.partyId || '').toUpperCase().trim();
  if (!partyId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Missing partyId' }));
  }

  // Set headers for SSE stream
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // bypass proxy buffering
  });
  res.write('\n');

  if (!partyStreams.has(partyId)) {
    partyStreams.set(partyId, new Set());
  }
  partyStreams.get(partyId).add(res);

  // Keep-alive heartbeat every 15 seconds
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {}
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const clients = partyStreams.get(partyId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        partyStreams.delete(partyId);
      }
    }
  });
});

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Create a Listening Party
app.post('/api/party/create', authMiddleware, async (req, res) => {
  try {
    const partyId = generateRoomCode();
    const newParty = {
      partyId,
      hostId: req.user.userId,
      hostName: req.user.name,
      currentTrack: null,
      isPlaying: false,
      currentTime: 0,
      lastUpdated: Date.now(),
      participants: [{
        userId: req.user.userId,
        name: req.user.name,
        avatar: req.user.avatar,
        joinedAt: Date.now(),
        ping: Date.now()
      }],
      chat: [],
      createdAt: Date.now()
    };

    await saveParty(newParty);
    res.status(201).json({ partyId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create party', details: err.message });
  }
});

// Join a Listening Party
app.post('/api/party/join', authMiddleware, async (req, res) => {
  try {
    const { partyId } = req.body;
    if (!partyId) return res.status(400).json({ error: 'Missing party code' });

    const party = await getParty(partyId);
    if (!party) return res.status(404).json({ error: 'Party room not found' });

    const idx = (party.participants || []).findIndex(p => p.userId === req.user.userId);
    const participantDoc = {
      userId: req.user.userId,
      name: req.user.name,
      avatar: req.user.avatar,
      joinedAt: Date.now(),
      ping: Date.now()
    };

    if (idx >= 0) {
      party.participants[idx] = participantDoc;
    } else {
      party.participants = [...(party.participants || []), participantDoc];
      party.chat = [
        ...(party.chat || []),
        {
          id: Math.random().toString(36).substring(2, 11),
          userId: 'system',
          name: 'System',
          avatar: '',
          message: `${req.user.name} joined the room.`,
          timestamp: Date.now()
        }
      ];
    }

    await saveParty(party);
    broadcastToParty(partyId, 'sync', { party, hostId: party.hostId });
    res.json({ party });
  } catch (err) {
    res.status(500).json({ error: 'Failed to join party', details: err.message });
  }
});

// Sync party state
app.post('/api/party/sync', authMiddleware, async (req, res) => {
  try {
    const { partyId, playbackState, isHost } = req.body;
    if (!partyId) return res.status(400).json({ error: 'Missing party ID' });

    const party = await getParty(partyId);
    if (!party) return res.status(404).json({ error: 'Party not found' });

    const idx = (party.participants || []).findIndex(p => p.userId === req.user.userId);
    if (idx >= 0) {
      party.participants[idx].ping = Date.now();
    } else {
      party.participants.push({
        userId: req.user.userId,
        name: req.user.name,
        avatar: req.user.avatar,
        joinedAt: Date.now(),
        ping: Date.now()
      });
    }

    const hostActive = (party.participants || []).some(p => p.userId === party.hostId);
    
    // Only reassign host if host is inactive (timed out)
    if (!hostActive && party.participants.length > 0) {
      const activeParticipants = party.participants.filter(p => Date.now() - p.ping < 6000);
      if (activeParticipants.length > 0) {
        const nextHost = activeParticipants[0];
        party.hostId = nextHost.userId;
        party.hostName = nextHost.name;
      }
    }

    if (party.hostId === req.user.userId && playbackState) {
      party.currentTrack = playbackState.currentTrack || null;
      party.isPlaying = playbackState.isPlaying || false;
      party.currentTime = playbackState.currentTime || 0;
      party.lastUpdated = Date.now();
    }

    await saveParty(party);
    broadcastToParty(partyId, 'sync', { party, hostId: party.hostId });
    res.json({ party, hostId: party.hostId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to sync party', details: err.message });
  }
});

// Send Chat Message
app.post('/api/party/chat', authMiddleware, async (req, res) => {
  try {
    const { partyId, message } = req.body;
    if (!partyId || !message) return res.status(400).json({ error: 'Missing party ID or message' });

    const party = await getParty(partyId);
    if (!party) return res.status(404).json({ error: 'Party not found' });

    const chatMsg = {
      id: Math.random().toString(36).substring(2, 11),
      userId: req.user.userId,
      name: req.user.name,
      avatar: req.user.avatar,
      message,
      timestamp: Date.now()
    };

    party.chat = [...(party.chat || []), chatMsg];
    if (party.chat.length > 100) party.chat = party.chat.slice(-100);

    await saveParty(party);
    broadcastToParty(partyId, 'chat', { party, chatMsg });
    res.json({ success: true, chatMsg });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send message', details: err.message });
  }
});

// ─── Suggestions ───
app.get('/api/suggestions', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json({ suggestions: [] });

    const data = await fetchWithFallback(
      `/api/v1/search/suggestions?q=${encodeURIComponent(q)}`
    );
    res.json({ suggestions: data.suggestions || [] });
  } catch {
    res.json({ suggestions: [] });
  }
});

// ─── Health check ───
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`\n  🎵 MusicFlow Backend running at http://localhost:${PORT}\n`);
    getInstances().then(instances => {
      console.log(`  📡 ${instances.length} Invidious instances available\n`);
    });
  });
}

export default app;

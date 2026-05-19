import express from 'express';
import cors from 'cors';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// ─── Invidious API instances ───
// Only inv.thepixora.com has api:true and cors:true
const INVIDIOUS_INSTANCES = [
  'https://inv.thepixora.com',
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
      // Only pick instances with API enabled
      const working = data
        .filter(([_, info]) =>
          info.type === 'https' &&
          info.api === true &&
          info.monitor?.uptime > 80 &&
          !info.monitor?.down
        )
        .map(([_, info]) => info.uri);

      if (working.length > 0) {
        cachedInstances = working;
        lastInstanceFetch = now;
        console.log(`[Invidious] Fetched ${working.length} API-enabled instances: ${working.join(', ')}`);
        return working;
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

// ─── Search music ───
app.get('/api/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Missing query' });

    // Use Invidious search API
    const data = await fetchWithFallback(
      `/api/v1/search?q=${encodeURIComponent(q)}&type=video&sort_by=relevance`
    );

    const items = (data || [])
      .filter(item => item.type === 'video' && item.lengthSeconds < 600)
      .slice(0, 25)
      .map(item => ({
        id: item.videoId || '',
        title: item.title || 'Unknown',
        artist: (item.author || 'Unknown').replace(' - Topic', ''),
        thumbnail: item.videoThumbnails?.[0]?.url ||
          `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
        duration: item.lengthSeconds || 0,
        views: item.viewCount || 0,
      }));

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
        .filter(item => item.lengthSeconds && item.lengthSeconds < 600)
        .slice(0, 20)
        .map(item => ({
          id: item.videoId || '',
          title: item.title || 'Unknown',
          artist: (item.author || 'Unknown').replace(' - Topic', ''),
          thumbnail: item.videoThumbnails?.[0]?.url ||
            `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
          duration: item.lengthSeconds || 0,
          views: item.viewCount || 0,
        }));

      if (items.length > 0) {
        return res.json({ results: items });
      }
    } catch (e) {
      console.log('[Trending] Trending API failed, falling back to search');
    }

    // Fallback: search for popular music
    const popularQueries = [
      'top hits 2026 music',
      'trending music indonesia',
      'popular songs 2026',
      'lagu hits terbaru',
    ];
    const query = popularQueries[Math.floor(Math.random() * popularQueries.length)];

    const data = await fetchWithFallback(
      `/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`
    );

    const items = (data || [])
      .filter(item => item.type === 'video' && item.lengthSeconds > 60 && item.lengthSeconds < 600)
      .slice(0, 20)
      .map(item => ({
        id: item.videoId || '',
        title: item.title || 'Unknown',
        artist: (item.author || 'Unknown').replace(' - Topic', ''),
        thumbnail: item.videoThumbnails?.[0]?.url ||
          `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
        duration: item.lengthSeconds || 0,
        views: item.viewCount || 0,
      }));

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

app.listen(PORT, () => {
  console.log(`\n  🎵 MusicFlow Backend running at http://localhost:${PORT}\n`);
  // Pre-fetch instances on startup
  getInstances().then(instances => {
    console.log(`  📡 ${instances.length} Invidious instances available\n`);
  });
});

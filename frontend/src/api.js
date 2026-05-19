const API_BASE = '/api';

const CLIENT_INVIDIOUS_INSTANCES = [
  'https://inv.thepixora.com',
  'https://yt.chocolatemoo53.com',
];

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
  const duration = item.lengthSeconds || item.duration || 0;
  // Reject: too short (<60s = likely Shorts) or too long (>10min = likely not a song)
  if (duration < 60 || duration > 600) return false;
  // Reject: live streams
  if (item.liveNow || item.isUpcoming) return false;
  // Reject: non-music titles
  const title = (item.title || '').toLowerCase();
  for (const keyword of NON_MUSIC_KEYWORDS) {
    if (title.includes(keyword)) return false;
  }
  return true;
}

async function fetchFromClientFallback(path) {
  for (const instance of CLIENT_INVIDIOUS_INSTANCES) {
    try {
      const url = `${instance}${path}`;
      console.log(`[Client Fallback Try] ${url}`);
      const res = await fetch(url, {
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.log(`[Client Fallback] ${instance} failed:`, e.message);
    }
  }
  throw new Error('All client fallback instances failed');
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

export async function searchMusic(query) {
  try {
    const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        return data.results;
      }
    }
  } catch (err) {
    console.warn('Backend search failed, using client-side fallback', err);
  }

  // Client-side fallback — append "music" to improve relevance
  try {
    const musicQuery = query.toLowerCase().includes('music') ? query : `${query} music`;
    const data = await fetchFromClientFallback(
      `/api/v1/search?q=${encodeURIComponent(musicQuery)}&type=video&sort_by=relevance`
    );
    return (data || [])
      .filter(item => item.type === 'video' && isMusicContent(item))
      .slice(0, 25)
      .map(mapToTrack);
  } catch (e) {
    console.error('All search options failed:', e);
    throw new Error('Search failed');
  }
}

export async function getTrending(region = 'ID') {
  try {
    const res = await fetch(`${API_BASE}/trending?region=${region}`);
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        return data.results;
      }
    }
  } catch (err) {
    console.warn('Backend trending failed, using client-side fallback', err);
  }

  // Client-side fallback: try trending first, then search popular
  try {
    let data;
    try {
      data = await fetchFromClientFallback(`/api/v1/trending?type=Music&region=${region}`);
    } catch {
      const popularQueries = [
        'lagu terbaru 2026 official audio',
        'top hits indonesia music video',
        'trending lagu indonesia terbaru',
        'lagu pop indonesia terbaru official',
      ];
      const query = popularQueries[Math.floor(Math.random() * popularQueries.length)];
      data = await fetchFromClientFallback(
        `/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`
      );
    }

    return (data || [])
      .filter(item => (item.type === 'video' || item.videoId) && isMusicContent(item))
      .slice(0, 20)
      .map(mapToTrack);
  } catch (e) {
    console.error('All trending options failed:', e);
    throw new Error('Trending failed');
  }
}

export async function getStreamUrl(videoId) {
  try {
    const res = await fetch(`${API_BASE}/stream/${videoId}`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('Backend stream failed, using local/YT-Iframe setup only', err);
  }
  return { audioStreams: [], hls: null };
}

export async function getLyrics(title, artist) {
  try {
    const cleanTitle = title
      .replace(/\(.*?\)/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/official.*?video/gi, '')
      .replace(/lyric.*?video/gi, '')
      .replace(/music.*?video/gi, '')
      .replace(/ft\.?.*$/i, '')
      .replace(/feat\.?.*$/i, '')
      .trim();

    const cleanArtist = artist
      .replace(/ - Topic$/, '')
      .replace(/VEVO$/i, '')
      .trim();

    const res = await fetch(
      `${API_BASE}/lyrics?title=${encodeURIComponent(cleanTitle)}&artist=${encodeURIComponent(cleanArtist)}`
    );
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('Backend lyrics failed', err);
  }
  return { found: false };
}

export async function getSuggestions(query) {
  try {
    const res = await fetch(`${API_BASE}/suggestions?q=${encodeURIComponent(query)}`);
    if (res.ok) {
      const data = await res.json();
      return data.suggestions || [];
    }
  } catch {}

  try {
    const data = await fetchFromClientFallback(
      `/api/v1/search/suggestions?q=${encodeURIComponent(query)}`
    );
    return data.suggestions || [];
  } catch {
    return [];
  }
}

export function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatViews(views) {
  if (!views) return '';
  if (views >= 1_000_000_000) return `${(views / 1_000_000_000).toFixed(1)}B`;
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K`;
  return views.toString();
}

export function parseLRC(lrcString) {
  if (!lrcString) return [];
  const lines = lrcString.split('\n');
  const parsed = [];

  for (const line of lines) {
    const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/);
    if (match) {
      const minutes = parseInt(match[1]);
      const seconds = parseInt(match[2]);
      const ms = parseInt(match[3].padEnd(3, '0'));
      const time = minutes * 60 + seconds + ms / 1000;
      const text = match[4].trim();
      if (text) {
        parsed.push({ time, text });
      }
    }
  }

  return parsed.sort((a, b) => a.time - b.time);
}

// localStorage helpers
const STORAGE_KEYS = {
  FAVORITES: 'musicflow_favorites',
  HISTORY: 'musicflow_history',
  VOLUME: 'musicflow_volume',
};

export function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.FAVORITES) || '[]');
  } catch { return []; }
}

export function saveFavorites(favorites) {
  localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favorites));
}

export function toggleFavorite(track) {
  const favs = getFavorites();
  const idx = favs.findIndex(f => f.id === track.id);
  if (idx >= 0) {
    favs.splice(idx, 1);
  } else {
    favs.unshift(track);
  }
  saveFavorites(favs);
  return favs;
}

export function isFavorite(trackId) {
  return getFavorites().some(f => f.id === trackId);
}

export function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY) || '[]');
  } catch { return []; }
}

export function addToHistory(track) {
  let history = getHistory();
  history = history.filter(h => h.id !== track.id);
  history.unshift(track);
  if (history.length > 50) history = history.slice(0, 50);
  localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
  return history;
}

export function getSavedVolume() {
  return parseInt(localStorage.getItem(STORAGE_KEYS.VOLUME) || '80');
}

export function saveVolume(vol) {
  localStorage.setItem(STORAGE_KEYS.VOLUME, vol.toString());
}

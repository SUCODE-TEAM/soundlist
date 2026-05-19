const API_BASE = '/api';

export async function searchMusic(query) {
  const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error('Search failed');
  const data = await res.json();
  return data.results || [];
}

export async function getTrending(region = 'ID') {
  const res = await fetch(`${API_BASE}/trending?region=${region}`);
  if (!res.ok) throw new Error('Trending failed');
  const data = await res.json();
  return data.results || [];
}

export async function getStreamUrl(videoId) {
  const res = await fetch(`${API_BASE}/stream/${videoId}`);
  if (!res.ok) throw new Error('Stream failed');
  return await res.json();
}

export async function getLyrics(title, artist) {
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
  if (!res.ok) throw new Error('Lyrics failed');
  return await res.json();
}

export async function getSuggestions(query) {
  const res = await fetch(`${API_BASE}/suggestions?q=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.suggestions || [];
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

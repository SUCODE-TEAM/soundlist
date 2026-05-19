import { useState, useEffect, useRef, useCallback } from 'react';
import MusicCard from './components/MusicCard';
import PlayerBar from './components/PlayerBar';
import LyricsPanel from './components/LyricsPanel';
import QueuePanel from './components/QueuePanel';
import {
  searchMusic, getTrending, getStreamUrl, getLyrics,
  formatDuration, parseLRC,
  getFavorites, toggleFavorite, isFavorite,
  getHistory, addToHistory,
  getSavedVolume, saveVolume,
} from './api';

function App() {
  // ─── Navigation ───
  const [page, setPage] = useState('home');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobilePlayerOpen, setMobilePlayerOpen] = useState(false);

  // ─── Home ───
  const [trending, setTrending] = useState([]);
  const [trendingLoading, setTrendingLoading] = useState(true);

  // ─── Search ───
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef(null);

  // ─── Library ───
  const [libTab, setLibTab] = useState('favorites');
  const [favorites, setFavorites] = useState(getFavorites());
  const [history, setHistory] = useState(getHistory());

  // ─── Player ───
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(getSavedVolume());
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false); // false, 'all', 'one'
  const ytPlayerRef = useRef(null);
  const ytReadyRef = useRef(false);
  const timeUpdateRef = useRef(null);
  const playbackModeRef = useRef('youtube'); // 'youtube' or 'audio'
  const audioRef = useRef(null);

  // ─── Queue ───
  const [queue, setQueue] = useState([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [queueOpen, setQueueOpen] = useState(false);

  // ─── Lyrics ───
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyricsData, setLyricsData] = useState(null);

  // ─── Toast ───
  const [toasts, setToasts] = useState([]);

  function showToast(msg) {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }

  // ─── Greeting ───
  function getGreeting() {
    const h = new Date().getHours();
    if (h < 5) return '🌙 Good Night';
    if (h < 12) return '☀️ Good Morning';
    if (h < 17) return '🌤 Good Afternoon';
    if (h < 21) return '🌆 Good Evening';
    return '🌙 Good Night';
  }

  // ─── Load YouTube IFrame API ───
  useEffect(() => {
    // Create hidden container for YT player
    if (!document.getElementById('yt-player-container')) {
      const container = document.createElement('div');
      container.id = 'yt-player-container';
      container.style.cssText = 'position:fixed;bottom:0;left:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;z-index:-1;';
      const playerDiv = document.createElement('div');
      playerDiv.id = 'yt-player';
      container.appendChild(playerDiv);
      document.body.appendChild(container);
    }

    // Load YouTube IFrame API
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }

    window.onYouTubeIframeAPIReady = () => {
      ytPlayerRef.current = new window.YT.Player('yt-player', {
        height: '1',
        width: '1',
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
        },
        events: {
          onReady: () => {
            ytReadyRef.current = true;
            console.log('[YT] Player ready');
          },
          onStateChange: (event) => {
            if (event.data === window.YT.PlayerState.ENDED) {
              handleTrackEndRef.current();
            }
          },
          onError: (event) => {
            console.error('[YT] Player error:', event.data);
          },
        },
      });
    };

    // If YT API already loaded
    if (window.YT && window.YT.Player) {
      window.onYouTubeIframeAPIReady();
    }

    // Also create Audio element as fallback
    audioRef.current = new Audio();

    return () => {
      if (timeUpdateRef.current) cancelAnimationFrame(timeUpdateRef.current);
    };
  }, []);

  // ─── Time update loop ───
  useEffect(() => {
    function updateTime() {
      if (playbackModeRef.current === 'youtube' && ytPlayerRef.current?.getCurrentTime) {
        try {
          const state = ytPlayerRef.current.getPlayerState();
          if (state === window.YT?.PlayerState?.PLAYING) {
            setCurrentTime(ytPlayerRef.current.getCurrentTime());
          }
        } catch {}
      } else if (playbackModeRef.current === 'audio' && audioRef.current && !audioRef.current.paused) {
        setCurrentTime(audioRef.current.currentTime);
      }
      timeUpdateRef.current = requestAnimationFrame(updateTime);
    }
    timeUpdateRef.current = requestAnimationFrame(updateTime);
    return () => {
      if (timeUpdateRef.current) cancelAnimationFrame(timeUpdateRef.current);
    };
  }, []);

  // ─── Load trending on mount ───
  useEffect(() => {
    loadTrending();
  }, []);

  async function loadTrending() {
    setTrendingLoading(true);
    try {
      const data = await getTrending('ID');
      setTrending(data);
    } catch (err) {
      console.error('Trending error:', err);
      showToast('Failed to load trending');
    }
    setTrendingLoading(false);
  }

  // ─── Search with debounce ───
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const results = await searchMusic(searchQuery);
        setSearchResults(results);
      } catch (err) {
        console.error('Search error:', err);
        showToast('Search failed');
      }
      setSearchLoading(false);
    }, 500);

    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQuery]);

  // ─── Volume sync ───
  useEffect(() => {
    if (ytPlayerRef.current?.setVolume) {
      try { ytPlayerRef.current.setVolume(volume); } catch {}
    }
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
    saveVolume(volume);
  }, [volume]);

  // Use ref for handleTrackEnd to avoid stale closures in YT callback
  const handleTrackEndRef = useRef(null);

  // ─── Play a track ───
  const playTrack = useCallback(async (track, newQueue = null, index = -1) => {
    try {
      setCurrentTrack(track);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(track.duration || 0);
      setLyricsData({ loading: true });

      // Update queue
      if (newQueue) {
        setQueue(newQueue);
        setQueueIndex(index >= 0 ? index : newQueue.findIndex(t => t.id === track.id));
      } else if (index >= 0) {
        setQueueIndex(index);
      }

      // Add to history
      const newHistory = addToHistory(track);
      setHistory(newHistory);

      // Try YouTube IFrame Player first (most reliable)
      if (ytReadyRef.current && ytPlayerRef.current?.loadVideoById) {
        playbackModeRef.current = 'youtube';
        ytPlayerRef.current.loadVideoById(track.id);
        ytPlayerRef.current.setVolume(volume);
        setIsPlaying(true);
        setDuration(track.duration || 0);
        showToast(`▶ Now playing: ${track.title}`);
      } else {
        // Fallback: try Invidious audio stream
        try {
          const streamData = await getStreamUrl(track.id);
          if (streamData.audioStreams?.length > 0) {
            playbackModeRef.current = 'audio';
            audioRef.current.src = streamData.audioStreams[0].url;
            audioRef.current.load();
            await audioRef.current.play();
            setIsPlaying(true);
            setDuration(streamData.duration || track.duration || 0);
          } else {
            showToast('No audio stream available');
            return;
          }
        } catch (err) {
          console.error('Audio fallback error:', err);
          showToast('Playback unavailable');
          return;
        }
      }

      // Fetch lyrics in background
      fetchLyrics(track);

    } catch (err) {
      console.error('Play error:', err);
      showToast('Failed to play track');
    }
  }, [volume]);

  async function fetchLyrics(track) {
    try {
      const lyrics = await getLyrics(track.title, track.artist);
      if (lyrics.found) {
        const lines = lyrics.synced ? parseLRC(lyrics.syncedLyrics) : null;
        setLyricsData({
          found: true,
          synced: lyrics.synced,
          lines,
          plainLyrics: lyrics.plainLyrics,
          loading: false,
        });
      } else {
        setLyricsData({ found: false, loading: false });
      }
    } catch {
      setLyricsData({ found: false, loading: false });
    }
  }

  // ─── Playback controls ───
  function handlePlayPause() {
    if (!currentTrack) return;

    if (playbackModeRef.current === 'youtube' && ytPlayerRef.current) {
      try {
        const state = ytPlayerRef.current.getPlayerState();
        if (state === window.YT?.PlayerState?.PLAYING) {
          ytPlayerRef.current.pauseVideo();
          setIsPlaying(false);
        } else {
          ytPlayerRef.current.playVideo();
          setIsPlaying(true);
        }
      } catch {}
    } else if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    }
  }

  function handleSeek(time) {
    if (playbackModeRef.current === 'youtube' && ytPlayerRef.current?.seekTo) {
      ytPlayerRef.current.seekTo(time, true);
    } else if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
    setCurrentTime(time);
  }

  function handleNext() {
    if (queue.length === 0) return;
    let nextIdx;
    if (shuffle) {
      nextIdx = Math.floor(Math.random() * queue.length);
    } else {
      nextIdx = queueIndex + 1;
      if (nextIdx >= queue.length) {
        if (repeat === 'all') nextIdx = 0;
        else return;
      }
    }
    playTrack(queue[nextIdx], null, nextIdx);
  }

  function handlePrev() {
    if (currentTime > 3) {
      handleSeek(0);
      return;
    }
    if (queue.length === 0) return;
    let prevIdx = queueIndex - 1;
    if (prevIdx < 0) {
      if (repeat === 'all') prevIdx = queue.length - 1;
      else { handleSeek(0); return; }
    }
    playTrack(queue[prevIdx], null, prevIdx);
  }

  function handleTrackEnd() {
    if (repeat === 'one') {
      handleSeek(0);
      if (playbackModeRef.current === 'youtube' && ytPlayerRef.current?.playVideo) {
        ytPlayerRef.current.playVideo();
      } else {
        audioRef.current?.play();
      }
      return;
    }
    handleNext();
  }

  // Keep the ref updated so YT callback uses latest version
  handleTrackEndRef.current = handleTrackEnd;

  function handleToggleRepeat() {
    setRepeat(prev => {
      if (!prev) return 'all';
      if (prev === 'all') return 'one';
      return false;
    });
  }

  function handleToggleFav() {
    if (!currentTrack) return;
    const newFavs = toggleFavorite(currentTrack);
    setFavorites(newFavs);
    showToast(isFavorite(currentTrack.id) ? 'Added to favorites' : 'Removed from favorites');
  }

  // ─── Play from card (set up queue from context) ───
  function handlePlayFromGrid(track, list) {
    const idx = list.findIndex(t => t.id === track.id);
    playTrack(track, list, idx);
  }

  function handlePlayFromQueue(index) {
    if (queue[index]) {
      playTrack(queue[index], null, index);
    }
  }

  // ─── Keyboard shortcuts ───
  useEffect(() => {
    function handleKey(e) {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        handlePlayPause();
      }
      if (e.code === 'ArrowRight' && e.ctrlKey) handleNext();
      if (e.code === 'ArrowLeft' && e.ctrlKey) handlePrev();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isPlaying, currentTrack, queueIndex, queue]);

  // ─── Render ───
  return (
    <>
      {/* Mobile Header */}
      <div className="mobile-header">
        <button className="btn-icon" onClick={() => setSidebarOpen(true)}>
          <span className="material-symbols-rounded">menu</span>
        </button>
        <span className="mobile-logo">MusicFlow</span>
        <button className="btn-icon" onClick={() => { setPage('search'); setSidebarOpen(false); }}>
          <span className="material-symbols-rounded">search</span>
        </button>
      </div>

      <div className="app-layout">
        {/* Sidebar */}
        <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
          <div className="sidebar-logo">
            <span className="material-symbols-rounded logo-icon">music_note</span>
            <span className="logo-text">MusicFlow</span>
          </div>
          <nav className="sidebar-nav">
            {[
              { id: 'home', icon: 'home', label: 'Home' },
              { id: 'search', icon: 'search', label: 'Search' },
              { id: 'library', icon: 'favorite', label: 'Library' },
            ].map(item => (
              <a
                key={item.id}
                href="#"
                className={`nav-item${page === item.id ? ' active' : ''}`}
                onClick={(e) => {
                  e.preventDefault();
                  setPage(item.id);
                  setSidebarOpen(false);
                }}
              >
                <span className="material-symbols-rounded">{item.icon}</span>
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
          <div className="sidebar-playlists">
            <div className="playlist-header">
              <h3>Now Playing</h3>
            </div>
            {currentTrack ? (
              <div className="queue-item active" style={{ margin: '0 0 8px' }}>
                <img className="queue-thumb" src={currentTrack.thumbnail} alt="" />
                <div className="queue-info">
                  <div className="queue-title">{currentTrack.title}</div>
                  <div className="queue-artist">{currentTrack.artist}</div>
                </div>
              </div>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 8px' }}>
                No song playing
              </p>
            )}
          </div>
        </aside>

        {/* Overlay */}
        {sidebarOpen && (
          <div className="overlay active" onClick={() => setSidebarOpen(false)} />
        )}

        {/* Main Content */}
        <main className="main-content">
          {/* ─── HOME ─── */}
          <div className={`page${page === 'home' ? ' active' : ''}`}>
            <h1 className="page-greeting">{getGreeting()}</h1>

            <section className="section">
              <h2 className="section-title">🔥 Trending Now</h2>
              {trendingLoading ? (
                <div className="card-grid">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="music-card">
                      <div className="skeleton" style={{ aspectRatio: 1, marginBottom: 12 }} />
                      <div className="skeleton" style={{ height: 14, marginBottom: 6 }} />
                      <div className="skeleton" style={{ height: 12, width: '60%' }} />
                    </div>
                  ))}
                </div>
              ) : trending.length > 0 ? (
                <div className="card-grid">
                  {trending.map(track => (
                    <MusicCard
                      key={track.id}
                      track={track}
                      onPlay={(t) => handlePlayFromGrid(t, trending)}
                      isPlaying={currentTrack?.id === track.id && isPlaying}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <span className="material-symbols-rounded">cloud_off</span>
                  <p>Could not load trending. Check your connection.</p>
                  <button className="lib-tab active" onClick={loadTrending}>Retry</button>
                </div>
              )}
            </section>

            {history.length > 0 && (
              <section className="section">
                <h2 className="section-title">⏱ Recently Played</h2>
                <div className="card-grid">
                  {history.slice(0, 10).map(track => (
                    <MusicCard
                      key={track.id}
                      track={track}
                      onPlay={(t) => handlePlayFromGrid(t, history.slice(0, 10))}
                      isPlaying={currentTrack?.id === track.id && isPlaying}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* ─── SEARCH ─── */}
          <div className={`page${page === 'search' ? ' active' : ''}`}>
            <div className="search-container">
              <div className="search-bar">
                <span className="material-symbols-rounded search-icon">search</span>
                <input
                  type="text"
                  placeholder="Search songs, artists, albums..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus={page === 'search'}
                />
                {searchQuery && (
                  <button className="btn-icon search-clear" onClick={() => setSearchQuery('')}>
                    <span className="material-symbols-rounded">close</span>
                  </button>
                )}
              </div>
            </div>

            {searchLoading ? (
              <div className="loading-spinner"><div className="spinner" /></div>
            ) : searchResults.length > 0 ? (
              <div className="search-results-list">
                {searchResults.map((track, i) => (
                  <div
                    key={track.id + i}
                    className={`search-result-item${currentTrack?.id === track.id ? ' playing' : ''}`}
                    onClick={() => handlePlayFromGrid(track, searchResults)}
                  >
                    <img className="result-thumb" src={track.thumbnail} alt="" />
                    <div className="result-info">
                      <div className="result-title">{track.title}</div>
                      <div className="result-artist">{track.artist}</div>
                    </div>
                    <span className="result-duration">{formatDuration(track.duration)}</span>
                    <div className="result-actions">
                      <button
                        className="btn-icon-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          const newFavs = toggleFavorite(track);
                          setFavorites(newFavs);
                          showToast(isFavorite(track.id) ? 'Added to favorites' : 'Removed from favorites');
                        }}
                        title="Favorite"
                      >
                        <span className="material-symbols-rounded" style={{ fontSize: 18, color: isFavorite(track.id) ? 'var(--accent)' : '' }}>
                          {isFavorite(track.id) ? 'favorite' : 'favorite_border'}
                        </span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : searchQuery.trim() ? (
              <div className="empty-state">
                <span className="material-symbols-rounded">search_off</span>
                <p>No results found for "{searchQuery}"</p>
              </div>
            ) : (
              <div className="empty-state">
                <span className="material-symbols-rounded">search</span>
                <p>Search for your favorite songs</p>
              </div>
            )}
          </div>

          {/* ─── LIBRARY ─── */}
          <div className={`page${page === 'library' ? ' active' : ''}`}>
            <h1 className="page-title">Your Library</h1>
            <div className="lib-tabs">
              <button
                className={`lib-tab${libTab === 'favorites' ? ' active' : ''}`}
                onClick={() => setLibTab('favorites')}
              >
                <span className="material-symbols-rounded">favorite</span> Favorites
              </button>
              <button
                className={`lib-tab${libTab === 'history' ? ' active' : ''}`}
                onClick={() => setLibTab('history')}
              >
                <span className="material-symbols-rounded">history</span> History
              </button>
            </div>

            {libTab === 'favorites' ? (
              favorites.length > 0 ? (
                <div className="search-results-list">
                  {favorites.map((track, i) => (
                    <div
                      key={track.id + i}
                      className={`search-result-item${currentTrack?.id === track.id ? ' playing' : ''}`}
                      onClick={() => handlePlayFromGrid(track, favorites)}
                    >
                      <img className="result-thumb" src={track.thumbnail} alt="" />
                      <div className="result-info">
                        <div className="result-title">{track.title}</div>
                        <div className="result-artist">{track.artist}</div>
                      </div>
                      <span className="result-duration">{formatDuration(track.duration)}</span>
                      <div className="result-actions">
                        <button
                          className="btn-icon-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            const newFavs = toggleFavorite(track);
                            setFavorites(newFavs);
                            showToast('Removed from favorites');
                          }}
                        >
                          <span className="material-symbols-rounded" style={{ fontSize: 18, color: 'var(--accent)' }}>
                            favorite
                          </span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <span className="material-symbols-rounded">favorite_border</span>
                  <p>No favorites yet. Start adding songs you love!</p>
                </div>
              )
            ) : (
              history.length > 0 ? (
                <div className="search-results-list">
                  {history.map((track, i) => (
                    <div
                      key={track.id + i}
                      className={`search-result-item${currentTrack?.id === track.id ? ' playing' : ''}`}
                      onClick={() => handlePlayFromGrid(track, history)}
                    >
                      <img className="result-thumb" src={track.thumbnail} alt="" />
                      <div className="result-info">
                        <div className="result-title">{track.title}</div>
                        <div className="result-artist">{track.artist}</div>
                      </div>
                      <span className="result-duration">{formatDuration(track.duration)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <span className="material-symbols-rounded">history</span>
                  <p>No listening history yet</p>
                </div>
              )
            )}
          </div>
        </main>

        {/* Lyrics Panel */}
        <LyricsPanel
          isOpen={lyricsOpen}
          onClose={() => setLyricsOpen(false)}
          lyricsData={lyricsData}
          currentTime={currentTime}
          onSeek={handleSeek}
        />
      </div>

      {/* Queue Panel */}
      <QueuePanel
        isOpen={queueOpen}
        onClose={() => setQueueOpen(false)}
        queue={queue}
        currentIndex={queueIndex}
        onPlayIndex={handlePlayFromQueue}
      />

      {/* Player Bar */}
      <PlayerBar
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        isFav={currentTrack ? isFavorite(currentTrack.id) : false}
        shuffle={shuffle}
        repeat={repeat}
        lyricsOpen={lyricsOpen}
        queueOpen={queueOpen}
        onPlayPause={handlePlayPause}
        onPrev={handlePrev}
        onNext={handleNext}
        onSeek={handleSeek}
        onVolumeChange={setVolume}
        onToggleFav={handleToggleFav}
        onToggleShuffle={() => setShuffle(p => !p)}
        onToggleRepeat={handleToggleRepeat}
        onToggleLyrics={() => setLyricsOpen(p => !p)}
        onToggleQueue={() => setQueueOpen(p => !p)}
      />

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className="toast">{t.msg}</div>
        ))}
      </div>

      {/* ─── MOBILE: Now Playing Mini Bar ─── */}
      <div className="mobile-now-playing" onClick={() => currentTrack && setMobilePlayerOpen(true)}>
        <div className="mobile-np-progress">
          <div className="mobile-np-progress-fill" style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }} />
        </div>
        {currentTrack?.thumbnail ? (
          <img className="mobile-np-art" src={currentTrack.thumbnail} alt="" />
        ) : (
          <div className="mobile-np-placeholder">
            <span className="material-symbols-rounded">music_note</span>
          </div>
        )}
        <div className="mobile-np-info">
          <div className="mobile-np-title">{currentTrack?.title || 'Not Playing'}</div>
          <div className="mobile-np-artist">{currentTrack?.artist || 'Select a song'}</div>
        </div>
        <div className="mobile-np-controls" onClick={e => e.stopPropagation()}>
          <button className="btn-icon" onClick={handlePlayPause}>
            <span className="material-symbols-rounded">{isPlaying ? 'pause' : 'play_arrow'}</span>
          </button>
          <button className="btn-icon" onClick={handleNext}>
            <span className="material-symbols-rounded">skip_next</span>
          </button>
        </div>
      </div>

      {/* ─── MOBILE: Bottom Navigation ─── */}
      <div className="mobile-bottom-nav">
        <div className="mobile-nav-items">
          {[
            { id: 'home', icon: 'home', label: 'Home' },
            { id: 'search', icon: 'search', label: 'Search' },
            { id: 'library', icon: 'favorite', label: 'Library' },
          ].map(item => (
            <button
              key={item.id}
              className={`mobile-nav-item${page === item.id ? ' active' : ''}`}
              onClick={() => { setPage(item.id); setSidebarOpen(false); }}
            >
              <span className="material-symbols-rounded">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ─── MOBILE: Full-Screen Player ─── */}
      <div className={`mobile-fullplayer${mobilePlayerOpen ? ' open' : ''}`}>
        <div className="mfp-header">
          <button className="btn-icon mfp-close" onClick={() => setMobilePlayerOpen(false)}>
            <span className="material-symbols-rounded">keyboard_arrow_down</span>
          </button>
          <span className="mfp-header-title">Now Playing</span>
          <button className="btn-icon" onClick={() => { setQueueOpen(p => !p); }}>
            <span className="material-symbols-rounded">queue_music</span>
          </button>
        </div>

        <div className="mfp-art-wrap">
          {currentTrack?.thumbnail ? (
            <img className="mfp-art" src={currentTrack.thumbnail} alt="" />
          ) : (
            <div className="mfp-art-placeholder">
              <span className="material-symbols-rounded">music_note</span>
            </div>
          )}
        </div>

        <div className="mfp-info">
          <div className="mfp-title">{currentTrack?.title || 'Not Playing'}</div>
          <div className="mfp-artist">{currentTrack?.artist || ''}</div>
        </div>

        <div className="mfp-actions">
          <button className={`btn-icon${currentTrack && isFavorite(currentTrack.id) ? ' active' : ''}`} onClick={handleToggleFav}>
            <span className="material-symbols-rounded">
              {currentTrack && isFavorite(currentTrack.id) ? 'favorite' : 'favorite_border'}
            </span>
          </button>
          <button className={`btn-icon${lyricsOpen ? ' active' : ''}`} onClick={() => setLyricsOpen(p => !p)}>
            <span className="material-symbols-rounded">lyrics</span>
          </button>
        </div>

        <div className="mfp-progress">
          <div className="progress-track" onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            handleSeek(pct * duration);
          }}>
            <div className="progress-fill" style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}>
              <div className="progress-thumb" />
            </div>
          </div>
          <div className="mfp-times">
            <span>{formatDuration(currentTime)}</span>
            <span>{formatDuration(duration)}</span>
          </div>
        </div>

        <div className="mfp-controls">
          <button className={`btn-icon${shuffle ? ' active' : ''}`} onClick={() => setShuffle(p => !p)}>
            <span className="material-symbols-rounded">shuffle</span>
          </button>
          <button className="btn-icon" onClick={handlePrev}>
            <span className="material-symbols-rounded">skip_previous</span>
          </button>
          <button className="btn-icon mfp-play-btn" onClick={handlePlayPause}>
            <span className="material-symbols-rounded">{isPlaying ? 'pause' : 'play_arrow'}</span>
          </button>
          <button className="btn-icon" onClick={handleNext}>
            <span className="material-symbols-rounded">skip_next</span>
          </button>
          <button className={`btn-icon${repeat ? ' active' : ''}`} onClick={handleToggleRepeat}>
            <span className="material-symbols-rounded">{repeat === 'one' ? 'repeat_one' : 'repeat'}</span>
          </button>
        </div>

        <div className="mfp-bottom-actions">
          <button className={`btn-icon${lyricsOpen ? ' active' : ''}`} onClick={() => setLyricsOpen(p => !p)}>
            <span className="material-symbols-rounded">lyrics</span>
          </button>
          <button className={`btn-icon${queueOpen ? ' active' : ''}`} onClick={() => setQueueOpen(p => !p)}>
            <span className="material-symbols-rounded">queue_music</span>
          </button>
        </div>
      </div>
    </>
  );
}

export default App;

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
  registerUser, loginUser, oauthUser, getCurrentUser, logoutUser,
  createParty, joinParty, syncParty, sendPartyChatMessage
} from './api';

function App() {
  // ─── Navigation ───
  const [page, setPage] = useState('home');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobilePlayerOpen, setMobilePlayerOpen] = useState(false);

  // ─── Auth ───
  const [user, setUser] = useState(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authTab, setAuthTab] = useState('login'); // 'login' | 'register'
  const [authForm, setAuthForm] = useState({ username: '', name: '', password: '' });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [guestUsernameInput, setGuestUsernameInput] = useState('');

  // ─── Listen Together (Party) ───
  const [party, setParty] = useState(null);
  const [partyCodeInput, setPartyCodeInput] = useState('');
  const [isPartyHost, setIsPartyHost] = useState(false);
  const [chatInput, setChatInput] = useState('');

  // Load current user on startup
  useEffect(() => {
    getCurrentUser().then(u => {
      if (u) setUser(u);
    });
  }, []);

  // Update party state wrapper (called when user performs actions on player)
  const updatePartyState = useCallback(async (track, playing, time) => {
    if (!party) return;
    try {
      const state = {
        currentTrack: track,
        isPlaying: playing,
        currentTime: time
      };
      const data = await syncParty(party.partyId, state, true);
      setParty(data.party);
      setIsPartyHost(data.hostId === user?.username || data.hostId === user?.userId);
    } catch (err) {
      console.warn('Failed to update party state:', err);
    }
  }, [party, user]);

  // Auth actions
  async function handleLocalAuth(e) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    try {
      let res;
      if (authTab === 'login') {
        res = await loginUser(authForm.username, authForm.password);
        showToast('Logged in successfully!');
      } else {
        res = await registerUser(authForm.username, authForm.name, authForm.password);
        showToast('Registered successfully!');
      }
      setUser(res.user);
      setAuthModalOpen(false);
      setAuthForm({ username: '', name: '', password: '' });
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSocialAuth(provider) {
    setAuthLoading(true);
    setAuthError('');
    try {
      const providerId = Math.random().toString(36).substring(2, 10);
      const name = provider.toUpperCase() + ' User ' + providerId.substring(0, 3);
      const username = `${provider}_${providerId}`;
      const res = await oauthUser(provider, providerId, name, username, `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`);
      setUser(res.user);
      setAuthModalOpen(false);
      showToast(`Signed in with ${provider.charAt(0).toUpperCase() + provider.slice(1)}!`);
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleGuestAuth(e) {
    e.preventDefault();
    if (!guestUsernameInput || !guestUsernameInput.trim()) {
      setAuthError('Guest username is required');
      return;
    }
    setAuthLoading(true);
    setAuthError('');
    try {
      const name = guestUsernameInput.trim() + ' (Guest)';
      const res = await oauthUser('guest', '', name, guestUsernameInput.trim(), `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(guestUsernameInput)}`);
      setUser(res.user);
      setAuthModalOpen(false);
      setGuestUsernameInput('');
      showToast('Signed in as Guest!');
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    try {
      if (party) {
        await handleLeaveParty();
      }
      await logoutUser();
      setUser(null);
      showToast('Logged out!');
    } catch (err) {
      showToast('Logout failed');
    }
  }

  // Party actions
  async function handleCreateParty() {
    if (!user) {
      setAuthModalOpen(true);
      return;
    }
    try {
      const code = await createParty();
      const p = await joinParty(code);
      setParty(p);
      setIsPartyHost(true);
      setPage('party');
      showToast(`Party room ${code} created!`);
    } catch (err) {
      showToast(err.message);
    }
  }

  async function handleJoinParty(e) {
    if (e) e.preventDefault();
    if (!user) {
      setAuthModalOpen(true);
      return;
    }
    if (!partyCodeInput || !partyCodeInput.trim()) {
      showToast('Please enter a room code');
      return;
    }
    try {
      const code = partyCodeInput.toUpperCase().trim();
      const p = await joinParty(code);
      setParty(p);
      setIsPartyHost(p.hostId === user?.username || p.hostId === user?.userId || p.hostId === user?.id);
      setPage('party');
      setPartyCodeInput('');
      showToast(`Joined party room ${code}!`);
    } catch (err) {
      showToast(err.message);
    }
  }

  async function handleLeaveParty() {
    if (!party) return;
    try {
      setParty(null);
      setIsPartyHost(false);
      showToast('Left party room');
    } catch (err) {
      console.error(err);
    }
  }

  async function handleSendChat(e) {
    e.preventDefault();
    if (!chatInput || !chatInput.trim() || !party) return;
    try {
      const msg = chatInput.trim();
      setChatInput('');
      const newMsg = await sendPartyChatMessage(party.partyId, msg);
      setParty(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          chat: [...(prev.chat || []), newMsg]
        };
      });
    } catch (err) {
      showToast('Failed to send message');
    }
  }

  // ─── Home ───
  const [trending, setTrending] = useState([]);
  const [trendingLoading, setTrendingLoading] = useState(true);

  // ─── Search ───
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef(null);
  const chatBottomRef = useRef(null);

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

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [party?.chat]);

  // Use ref for handleTrackEnd to avoid stale closures in YT callback
  const handleTrackEndRef = useRef(null);

  // ─── Play a track ───
  const playTrack = useCallback(async (track, newQueue = null, index = -1) => {
    if (party && !isPartyHost) {
      showToast('Only the Host can control playback in the room!');
      return;
    }
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

      // Sync playback start to party room
      if (party) {
        updatePartyState(track, true, 0);
      }

    } catch (err) {
      console.error('Play error:', err);
      showToast('Failed to play track');
    }
  }, [volume, party, isPartyHost, updatePartyState]);

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
    if (party && !isPartyHost) {
      showToast('Only the Host can control playback in the room!');
      return;
    }
    if (!currentTrack) return;

    let newState = !isPlaying;
    if (playbackModeRef.current === 'youtube' && ytPlayerRef.current) {
      try {
        const state = ytPlayerRef.current.getPlayerState();
        if (state === window.YT?.PlayerState?.PLAYING) {
          ytPlayerRef.current.pauseVideo();
          setIsPlaying(false);
          newState = false;
        } else {
          ytPlayerRef.current.playVideo();
          setIsPlaying(true);
          newState = true;
        }
      } catch {}
    } else if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
        newState = false;
      } else {
        audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
        newState = true;
      }
    }

    if (party) {
      updatePartyState(currentTrack, newState, currentTime);
    }
  }

  function handleSeek(time) {
    if (party && !isPartyHost) {
      showToast('Only the Host can control playback in the room!');
      return;
    }
    if (playbackModeRef.current === 'youtube' && ytPlayerRef.current?.seekTo) {
      ytPlayerRef.current.seekTo(time, true);
    } else if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
    setCurrentTime(time);
    
    if (party) {
      updatePartyState(currentTrack, isPlaying, time);
    }
  }

  function handleNext() {
    if (party && !isPartyHost) {
      showToast('Only the Host can control playback in the room!');
      return;
    }
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
    if (party && !isPartyHost) {
      showToast('Only the Host can control playback in the room!');
      return;
    }
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
    if (party && !isPartyHost) {
      showToast('Only the Host can control playback in the room!');
      return;
    }
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

  // Refs to avoid stale closures in the polling interval
  const currentTrackRef = useRef(currentTrack);
  const isPlayingRef = useRef(isPlaying);
  const currentTimeRef = useRef(currentTime);
  const isPartyHostRef = useRef(isPartyHost);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
    isPlayingRef.current = isPlaying;
    currentTimeRef.current = currentTime;
    isPartyHostRef.current = isPartyHost;
  });

  // ─── Listen Party SSE Stream (Real-Time updates) ───
  useEffect(() => {
    if (!party || !user) return;

    let active = true;
    const streamUrl = `/api/party/stream?partyId=${encodeURIComponent(party.partyId)}`;
    const eventSource = new EventSource(streamUrl);

    eventSource.onmessage = (event) => {
      if (!active) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'sync' || data.type === 'chat') {
          const updatedParty = data.party;
          setParty(updatedParty);

          const currentUserId = user?.userId || user?.username || user?.id;
          setIsPartyHost(updatedParty.hostId === currentUserId);

          // If we are NOT the host, synchronize playback!
          if (updatedParty.hostId !== user?.username && updatedParty.hostId !== user?.userId && updatedParty.hostId !== user?.id) {
            // 1. Sync Track
            if (updatedParty.currentTrack) {
              if (!currentTrackRef.current || currentTrackRef.current.id !== updatedParty.currentTrack.id) {
                setCurrentTrack(updatedParty.currentTrack);
                setDuration(updatedParty.currentTrack.duration || 0);
                fetchLyrics(updatedParty.currentTrack);
                
                setTimeout(() => {
                  if (ytReadyRef.current && ytPlayerRef.current?.loadVideoById) {
                    playbackModeRef.current = 'youtube';
                    if (audioRef.current) {
                      audioRef.current.pause();
                      audioRef.current.src = '';
                    }
                    ytPlayerRef.current.loadVideoById({
                      videoId: updatedParty.currentTrack.id,
                      startSeconds: updatedParty.currentTime
                    });
                    if (updatedParty.isPlaying) {
                      ytPlayerRef.current.playVideo();
                    } else {
                      ytPlayerRef.current.pauseVideo();
                    }
                  } else {
                    // Fallback Invidious audio stream
                    getStreamUrl(updatedParty.currentTrack.id).then(streamData => {
                      if (streamData.audioStreams?.length > 0) {
                        playbackModeRef.current = 'audio';
                        try { ytPlayerRef.current?.stopVideo(); } catch {}
                        
                        audioRef.current.src = streamData.audioStreams[0].url;
                        audioRef.current.load();
                        audioRef.current.currentTime = updatedParty.currentTime;
                        if (updatedParty.isPlaying) {
                          audioRef.current.play().catch(() => {});
                        } else {
                          audioRef.current.pause();
                        }
                        setDuration(streamData.duration || updatedParty.currentTrack.duration || 0);
                      }
                    }).catch(err => console.warn('Invidious fallback sync failed:', err));
                  }
                }, 200);
              }
            } else {
              setCurrentTrack(null);
              setIsPlaying(false);
              if (playbackModeRef.current === 'youtube') ytPlayerRef.current?.stopVideo();
              else audioRef.current?.pause();
            }

            // 2. Sync Play/Pause state
            if (updatedParty.currentTrack && currentTrackRef.current && currentTrackRef.current.id === updatedParty.currentTrack.id && updatedParty.isPlaying !== isPlayingRef.current) {
              setIsPlaying(updatedParty.isPlaying);
              if (updatedParty.isPlaying) {
                if (playbackModeRef.current === 'youtube') ytPlayerRef.current?.playVideo();
                else audioRef.current?.play();
              } else {
                if (playbackModeRef.current === 'youtube') ytPlayerRef.current?.pauseVideo();
                else audioRef.current?.pause();
              }
            }

            // 3. Sync position if out of sync by > 3.5 seconds
            if (updatedParty.isPlaying && updatedParty.currentTrack && currentTrackRef.current && currentTrackRef.current.id === updatedParty.currentTrack.id) {
              const elapsed = (Date.now() - updatedParty.lastUpdated) / 1000;
              const projectedTime = updatedParty.currentTime + elapsed;
              const diff = Math.abs(currentTimeRef.current - projectedTime);
              if (diff > 3.5) {
                setCurrentTime(projectedTime);
                if (playbackModeRef.current === 'youtube') {
                  ytPlayerRef.current?.seekTo(projectedTime, true);
                } else if (audioRef.current) {
                  audioRef.current.currentTime = projectedTime;
                }
              }
            }
          }
        }
      } catch (err) {
        console.error('SSE sync parse error:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.warn('SSE connection disconnected or reconnecting...', err);
    };

    return () => {
      active = false;
      eventSource.close();
    };
  }, [party?.partyId, user?.userId]);

  // ─── Listen Party Host Heartbeat / Fallback Polling Loop ───
  useEffect(() => {
    if (!party || !user) return;

    let active = true;
    const interval = setInterval(async () => {
      try {
        const isHost = party.hostId === user?.userId || party.hostId === user?.username || party.hostId === user?.id || isPartyHostRef.current;
        
        // Host pushes current time periodically. Listeners just send ping sync.
        const playbackState = isHost ? {
          currentTrack: currentTrackRef.current,
          isPlaying: isPlayingRef.current,
          currentTime: currentTimeRef.current
        } : null;

        const data = await syncParty(party.partyId, playbackState, isHost);
        if (!active) return;

        const updatedParty = data.party;
        setParty(updatedParty);
        setIsPartyHost(data.hostId === user?.username || data.hostId === user?.userId || data.hostId === user?.id);
      } catch (err) {
        console.error('Heartbeat sync failed:', err);
      }
    }, 4000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [party?.partyId, user?.userId]);

  // ─── Render ───
  return (
    <>
      {/* Mobile Header */}
      <div className="mobile-header">
        <button className="btn-icon" onClick={() => setSidebarOpen(true)}>
          <span className="material-symbols-rounded">menu</span>
        </button>
        <span className="mobile-logo">MusicFlow</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {user ? (
            <img 
              src={user.avatar} 
              className="mobile-avatar" 
              onClick={() => {
                if (window.confirm('Do you want to log out?')) {
                  handleLogout();
                }
              }} 
              alt="Profile" 
            />
          ) : (
            <button className="btn-icon" onClick={() => { setAuthTab('login'); setAuthModalOpen(true); }}>
              <span className="material-symbols-rounded">account_circle</span>
            </button>
          )}
        </div>
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
              { id: 'party', icon: 'groups', label: 'Listen Together' },
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
          
          <div className="sidebar-profile">
            {user ? (
              <div className="user-profile-widget">
                <img src={user.avatar} className="user-avatar" alt="" />
                <div className="user-profile-info">
                  <span className="user-name">{user.name}</span>
                  <span className="user-provider">{user.provider === 'guest' ? 'Guest' : 'Member'}</span>
                </div>
                <button className="btn-icon" onClick={handleLogout} title="Log Out">
                  <span className="material-symbols-rounded">logout</span>
                </button>
              </div>
            ) : (
              <button className="btn-signin-sidebar" onClick={() => { setAuthTab('login'); setAuthModalOpen(true); }}>
                <span className="material-symbols-rounded">login</span>
                <span>Sign In / Join</span>
              </button>
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

          {/* ─── LISTEN PARTY PAGE ─── */}
          <div className={`page${page === 'party' ? ' active' : ''}`}>
            <h1 className="page-greeting">👥 Listen Together</h1>
            
            {!party ? (
              <div className="party-landing">
                <div className="party-landing-card">
                  <span className="material-symbols-rounded party-hero-icon">groups</span>
                  <h2>Listen with Friends in Real Time</h2>
                  <p>Create a room and share the room code, or enter an existing room code to synchronize your music and chat together.</p>
                  
                  <div className="party-actions-group">
                    <button className="btn-primary btn-party-action" onClick={handleCreateParty}>
                      <span className="material-symbols-rounded">add</span>
                      <span>Create a Room</span>
                    </button>
                    
                    <div className="party-divider">
                      <span>or join a room</span>
                    </div>
                    
                    <form className="party-join-form" onSubmit={handleJoinParty}>
                      <input 
                        type="text" 
                        placeholder="Enter Room Code (e.g. PLAY12)" 
                        value={partyCodeInput}
                        onChange={(e) => setPartyCodeInput(e.target.value)}
                        maxLength={6}
                      />
                      <button type="submit" className="btn-secondary">
                        <span>Join</span>
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            ) : (
              <div className="party-room-layout">
                <div className="party-room-main">
                  <div className="party-room-header">
                    <div className="party-room-meta">
                      <h2>Room: <span className="room-code">{party.partyId}</span></h2>
                      <p className="room-host">
                        Host: <strong>{party.hostName}</strong> 
                        {isPartyHost && <span className="badge-host">You</span>}
                      </p>
                    </div>
                    <button className="btn-danger btn-leave-room" onClick={handleLeaveParty}>
                      <span className="material-symbols-rounded">logout</span>
                      <span>Leave Room</span>
                    </button>
                  </div>

                  {/* Sync Status Info */}
                  <div className="party-playback-card">
                    {party.currentTrack ? (
                      <div className="party-track-details">
                        <img src={party.currentTrack.thumbnail} className="party-track-thumb" alt="" />
                        <div className="party-track-info">
                          <span className="party-track-playing">NOW PLAYING SYNCED:</span>
                          <span className="party-track-title">{party.currentTrack.title}</span>
                          <span className="party-track-artist">{party.currentTrack.artist}</span>
                          <span className="party-track-status">
                            {party.isPlaying ? '▶ Playing' : '⏸ Paused'} at {formatDuration(currentTime)} / {formatDuration(duration)}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="party-track-empty">
                        <span className="material-symbols-rounded">music_off</span>
                        <p>No track is currently playing. {isPartyHost ? 'Start playing a song from Home or Search to sync it with everyone!' : 'Wait for the host to start playing a song.'}</p>
                      </div>
                    )}
                  </div>

                  {/* Room Participants */}
                  <div className="party-members-section">
                    <h3>👥 Members in Room ({party.participants?.length || 0})</h3>
                    <div className="party-members-list">
                      {(party.participants || []).map(p => (
                        <div key={p.userId} className="party-member-item">
                          <img src={p.avatar} className="member-avatar" alt="" />
                          <span className="member-name">{p.name}</span>
                          {p.userId === party.hostId && <span className="member-badge host">Host</span>}
                          {p.userId === user?.userId && <span className="member-badge you">You</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Real-time Chat Section */}
                <div className="party-room-sidebar">
                  <div className="party-chat-header">
                    <h3>💬 Real-time Chat</h3>
                  </div>
                  <div className="party-chat-messages">
                    {(party.chat || []).map(msg => (
                      <div key={msg.id} className={`chat-message-bubble ${msg.userId === 'system' ? 'system-msg' : msg.userId === user?.userId ? 'my-msg' : ''}`}>
                        {msg.userId !== 'system' && (
                          <div className="chat-msg-meta">
                            <span className="chat-msg-author">{msg.name}</span>
                          </div>
                        )}
                        <div className="chat-msg-body">
                          {msg.message}
                        </div>
                        <span className="chat-msg-time">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ))}
                    <div ref={chatBottomRef} />
                  </div>
                  <form className="party-chat-input-form" onSubmit={handleSendChat}>
                    <input 
                      type="text" 
                      placeholder="Type a message..." 
                      value={chatInput} 
                      onChange={(e) => setChatInput(e.target.value)}
                    />
                    <button type="submit" className="btn-send-chat">
                      <span className="material-symbols-rounded">send</span>
                    </button>
                  </form>
                </div>
              </div>
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
            { id: 'party', icon: 'groups', label: 'Party' },
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
          <button className={`btn-icon${lyricsOpen ? ' active' : ''}`} onClick={() => { setLyricsOpen(p => !p); }}>
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
          <button className={`btn-icon${lyricsOpen ? ' active' : ''}`} onClick={() => { setLyricsOpen(p => !p); }}>
            <span className="material-symbols-rounded">lyrics</span>
          </button>
          <button className={`btn-icon${queueOpen ? ' active' : ''}`} onClick={() => { setQueueOpen(p => !p); }}>
            <span className="material-symbols-rounded">queue_music</span>
          </button>
        </div>
      </div>

      {/* ─── AUTHENTICATION MODAL ─── */}
      {authModalOpen && (
        <div className="modal-overlay" onClick={() => setAuthModalOpen(false)}>
          <div className="modal-content auth-modal" onClick={e => e.stopPropagation()}>
            <div className="auth-modal-header">
              <h2>{authTab === 'login' ? 'Welcome Back' : authTab === 'register' ? 'Create Account' : 'Guest Access'}</h2>
              <button className="btn-icon" onClick={() => setAuthModalOpen(false)}>
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>

            {authError && (
              <div className="auth-error-msg">
                <span className="material-symbols-rounded">error</span>
                <span>{authError}</span>
              </div>
            )}

            <div className="auth-tabs">
              <button className={`auth-tab-btn ${authTab === 'login' ? 'active' : ''}`} onClick={() => { setAuthTab('login'); setAuthError(''); }}>Log In</button>
              <button className={`auth-tab-btn ${authTab === 'register' ? 'active' : ''}`} onClick={() => { setAuthTab('register'); setAuthError(''); }}>Sign Up</button>
              <button className={`auth-tab-btn ${authTab === 'guest' ? 'active' : ''}`} onClick={() => { setAuthTab('guest'); setAuthError(''); }}>Guest Access</button>
            </div>

            {authTab !== 'guest' ? (
              <form onSubmit={handleLocalAuth} className="auth-form">
                <div className="form-group">
                  <label>Username (Unique identifier)</label>
                  <input 
                    type="text" 
                    placeholder="Enter unique username" 
                    value={authForm.username} 
                    onChange={e => setAuthForm(prev => ({ ...prev, username: e.target.value }))}
                    required
                  />
                </div>
                {authTab === 'register' && (
                  <div className="form-group">
                    <label>Display Name (Shown to others)</label>
                    <input 
                      type="text" 
                      placeholder="Enter display name" 
                      value={authForm.name} 
                      onChange={e => setAuthForm(prev => ({ ...prev, name: e.target.value }))}
                      required
                    />
                  </div>
                )}
                <div className="form-group">
                  <label>Password</label>
                  <input 
                    type="password" 
                    placeholder="Enter password" 
                    value={authForm.password} 
                    onChange={e => setAuthForm(prev => ({ ...prev, password: e.target.value }))}
                    required
                  />
                </div>
                <button type="submit" className="btn-primary auth-submit-btn" disabled={authLoading}>
                  {authLoading ? 'Please wait...' : authTab === 'login' ? 'Log In' : 'Sign Up'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleGuestAuth} className="auth-form">
                <div className="form-group">
                  <label>Guest Username</label>
                  <input 
                    type="text" 
                    placeholder="Choose a guest nickname" 
                    value={guestUsernameInput} 
                    onChange={e => setGuestUsernameInput(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="btn-primary auth-submit-btn" disabled={authLoading}>
                  {authLoading ? 'Please wait...' : 'Enter as Guest'}
                </button>
              </form>
            )}

            <div className="auth-divider">
              <span>Or connect with</span>
            </div>

            <div className="social-auth-buttons">
              <button className="social-btn github" onClick={() => handleSocialAuth('github')} disabled={authLoading}>
                <img src="https://api.iconify.design/logos:github-icon.svg" className="social-icon" alt="" />
                <span>GitHub</span>
              </button>
              <button className="social-btn google" onClick={() => handleSocialAuth('google')} disabled={authLoading}>
                <img src="https://api.iconify.design/logos:google-icon.svg" className="social-icon" alt="" />
                <span>Google</span>
              </button>
              <button className="social-btn facebook" onClick={() => handleSocialAuth('facebook')} disabled={authLoading}>
                <img src="https://api.iconify.design/logos:facebook.svg" className="social-icon" alt="" />
                <span>Facebook</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;

import { formatDuration } from '../api';

export default function PlayerBar({
  currentTrack,
  isPlaying,
  currentTime,
  duration,
  volume,
  isFav,
  shuffle,
  repeat,
  lyricsOpen,
  queueOpen,
  onPlayPause,
  onPrev,
  onNext,
  onSeek,
  onVolumeChange,
  onToggleFav,
  onToggleShuffle,
  onToggleRepeat,
  onToggleLyrics,
  onToggleQueue,
}) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  function handleProgressClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = x / rect.width;
    onSeek(pct * duration);
  }

  function handleVolumeClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    onVolumeChange(Math.round(pct * 100));
  }

  const volIcon = volume === 0 ? 'volume_off' : volume < 50 ? 'volume_down' : 'volume_up';

  return (
    <div className="player-bar">
      {/* Track Info */}
      <div className="player-track-info">
        <div className="player-art-wrap">
          {currentTrack?.thumbnail ? (
            <img
              className="player-art visible"
              src={currentTrack.thumbnail}
              alt=""
            />
          ) : (
            <div className="player-art-placeholder">
              <span className="material-symbols-rounded">music_note</span>
            </div>
          )}
        </div>
        <div className="player-meta">
          <span className="player-title">
            {currentTrack?.title || 'Not Playing'}
          </span>
          <span className="player-artist">
            {currentTrack?.artist || 'Select a song to start'}
          </span>
        </div>
        {currentTrack && (
          <button
            className={`btn-icon btn-fav${isFav ? ' active' : ''}`}
            onClick={onToggleFav}
            title={isFav ? 'Remove from favorites' : 'Add to favorites'}
          >
            <span className="material-symbols-rounded">
              {isFav ? 'favorite' : 'favorite_border'}
            </span>
          </button>
        )}
      </div>

      {/* Center Controls */}
      <div className="player-center">
        <div className="player-buttons">
          <button
            className={`btn-icon${shuffle ? ' active' : ''}`}
            onClick={onToggleShuffle}
            title="Shuffle"
          >
            <span className="material-symbols-rounded">shuffle</span>
          </button>
          <button className="btn-icon" onClick={onPrev} title="Previous">
            <span className="material-symbols-rounded">skip_previous</span>
          </button>
          <button
            className="btn-icon btn-play-main"
            onClick={onPlayPause}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            <span className="material-symbols-rounded">
              {isPlaying ? 'pause' : 'play_arrow'}
            </span>
          </button>
          <button className="btn-icon" onClick={onNext} title="Next">
            <span className="material-symbols-rounded">skip_next</span>
          </button>
          <button
            className={`btn-icon${repeat ? ' active' : ''}`}
            onClick={onToggleRepeat}
            title="Repeat"
          >
            <span className="material-symbols-rounded">
              {repeat === 'one' ? 'repeat_one' : 'repeat'}
            </span>
          </button>
        </div>
        <div className="player-progress">
          <span className="time-label">{formatDuration(currentTime)}</span>
          <div className="progress-track" onClick={handleProgressClick}>
            <div className="progress-fill" style={{ width: `${progress}%` }}>
              <div className="progress-thumb" />
            </div>
          </div>
          <span className="time-label">{formatDuration(duration)}</span>
        </div>
      </div>

      {/* Extras */}
      <div className="player-extras">
        <button
          className={`btn-icon${lyricsOpen ? ' active' : ''}`}
          onClick={onToggleLyrics}
          title="Lyrics"
        >
          <span className="material-symbols-rounded">lyrics</span>
        </button>
        <button
          className={`btn-icon${queueOpen ? ' active' : ''}`}
          onClick={onToggleQueue}
          title="Queue"
        >
          <span className="material-symbols-rounded">queue_music</span>
        </button>
        <div className="volume-wrap">
          <button
            className="btn-icon"
            onClick={() => onVolumeChange(volume > 0 ? 0 : 80)}
            title="Volume"
          >
            <span className="material-symbols-rounded">{volIcon}</span>
          </button>
          <div className="volume-track" onClick={handleVolumeClick}>
            <div className="volume-fill" style={{ width: `${volume}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

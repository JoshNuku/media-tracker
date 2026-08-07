let watchlist = [];

window.onload = async () => {
  initTheme();
  updateKeyUI();

  try {
    const res = await fetch('/watchlist.json');
    if (res.ok) {
      watchlist = await res.json();
      renderWatchlist();
    }
  } catch (e) {
    console.log("No existing watchlist found yet.");
    renderWatchlist();
  }
};

/* ==========================================================================
   Page View Navigation (Single Page App Routing)
   ========================================================================== */
function showDashboardView() {
  document.getElementById('detailsPage').style.display = 'none';
  document.getElementById('dashboardView').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showDetailsView() {
  document.getElementById('dashboardView').style.display = 'none';
  document.getElementById('detailsPage').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ==========================================================================
   Theme Switcher (Dark / Light Mode)
   ========================================================================== */
function initTheme() {
  const savedTheme = localStorage.getItem('theme_preference') || 'dark';
  applyTheme(savedTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);
  localStorage.setItem('theme_preference', newTheme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const toggleIcon = document.getElementById('themeToggleIcon');
  const toggleText = document.getElementById('themeToggleText');

  if (theme === 'light') {
    if (toggleIcon) toggleIcon.innerText = '🌙';
    if (toggleText) toggleText.innerText = 'Dark';
  } else {
    if (toggleIcon) toggleIcon.innerText = '☀️';
    if (toggleText) toggleText.innerText = 'Light';
  }
}

/* ==========================================================================
   API Key & Watchlist Logic
   ========================================================================== */
function updateKeyUI() {
  const savedKey = localStorage.getItem('tmdb_key');
  const statusEl = document.getElementById('keyStatus');
  const apiKeyInput = document.getElementById('apiKey');

  if (savedKey) {
    apiKeyInput.value = '';
    apiKeyInput.placeholder = '•••••••••••••••• (API Key Saved)';
    if (statusEl) {
      statusEl.innerText = '✅ TMDb API Key is active in local storage.';
      statusEl.style.color = 'var(--g-green)';
    }
  } else {
    apiKeyInput.value = '';
    apiKeyInput.placeholder = 'Paste your TMDb API Key';
    if (statusEl) {
      statusEl.innerText = '⚠️ No API Key saved yet.';
      statusEl.style.color = 'var(--g-red)';
    }
  }
}

function saveKey() {
  const key = document.getElementById('apiKey').value.trim();
  if (!key) {
    return alert('Please paste an API key before clicking Save Key.');
  }
  localStorage.setItem('tmdb_key', key);
  updateKeyUI();
}

async function searchMedia() {
  const apiKeyInput = document.getElementById('apiKey').value.trim();
  const savedKey = localStorage.getItem('tmdb_key');
  const apiKey = apiKeyInput || savedKey;
  const query = document.getElementById('searchInput').value.trim();

  if (!apiKey) return alert('Please enter and save your TMDb API Key first.');
  if (!query) return alert('Please enter a Search Query.');

  const resultsContainer = document.getElementById('searchResults');
  
  resultsContainer.innerHTML = `
    <div class="loading-box">
      <div class="spinner"></div>
      <p>Searching TMDb for "${escapeHtml(query)}"...</p>
    </div>
  `;

  try {
    const res = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=${apiKey}&query=${encodeURIComponent(query)}`);
    const data = await res.json();
    
    resultsContainer.innerHTML = '';

    const validItems = (data.results || []).filter(item => item.media_type === 'movie' || item.media_type === 'tv');

    if (validItems.length === 0) {
      resultsContainer.innerHTML = `
        <div class="empty-state">
          <p>No movies or TV shows found matching "${escapeHtml(query)}".</p>
        </div>
      `;
      return;
    }

    validItems.forEach(item => {
      const card = createMediaCard(item, false);
      resultsContainer.appendChild(card);
    });
  } catch (e) {
    console.error(e);
    resultsContainer.innerHTML = `
      <div class="empty-state">
        <p style="color: var(--g-red);">Error fetching data from TMDb. Please check your API key.</p>
      </div>
    `;
  }
}

function createMediaCard(item, isInWatchlist = false) {
  const title = item.title || item.name || 'Untitled';
  const year = (item.release_date || item.first_air_date || item.release_year || '').substring(0, 4);
  const mediaType = item.media_type || item.type || 'movie';
  const posterPath = item.poster_path || '';
  const posterUrl = posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : '';
  const rating = item.vote_average ? item.vote_average.toFixed(1) : '';
  const overview = item.overview || 'No overview available.';
  const tmdbId = item.id || item.tmdb_id;

  const card = document.createElement('div');
  card.className = 'media-card';
  card.onclick = (e) => {
    if (!e.target.closest('button')) {
      openDetailsPage(tmdbId, mediaType, item);
    }
  };

  const posterHTML = posterUrl
    ? `<img src="${posterUrl}" alt="${escapeHtml(title)}" class="poster-img" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
       <div class="poster-fallback" style="display:none;">
         <svg width="40" height="40" viewBox="0 0 24 24"><path fill="currentColor" d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H9l2 4H8L6 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>
         <span style="margin-top:0.5rem; font-size:0.8rem;">No Poster</span>
       </div>`
    : `<div class="poster-fallback">
         <svg width="40" height="40" viewBox="0 0 24 24"><path fill="currentColor" d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H9l2 4H8L6 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>
         <span style="margin-top:0.5rem; font-size:0.8rem;">No Poster</span>
       </div>`;

  const badgeClass = mediaType === 'tv' ? 'badge-tv' : 'badge-movie';
  const badgeLabel = mediaType === 'tv' ? 'TV SHOW' : 'MOVIE';

  const ratingHTML = rating
    ? `<div class="rating-badge">★ ${rating}</div>`
    : '';

  const alreadySaved = watchlist.some(i => i.tmdb_id === tmdbId);

  let buttonHTML = '';
  if (isInWatchlist) {
    buttonHTML = `<button class="g-btn g-btn-danger g-btn-full" onclick="event.stopPropagation(); removeItem(${tmdbId})">🗑 Remove</button>`;
  } else if (alreadySaved) {
    buttonHTML = `<button class="g-btn g-btn-secondary g-btn-full" disabled style="opacity:0.6; cursor:default;">✓ Saved</button>`;
  } else {
    const safeTitle = escapeHtml(title).replace(/'/g, "\\'");
    const safeOverview = escapeHtml(overview).replace(/'/g, "\\'");
    buttonHTML = `<button class="g-btn g-btn-full" onclick='event.stopPropagation(); addItem(${tmdbId}, "${mediaType}", "${safeTitle}", "${posterPath}", "${rating}", "${year}", "${safeOverview}")'>+ Add to Watchlist</button>`;
  }

  card.innerHTML = `
    <div class="poster-wrapper">
      ${posterHTML}
      <span class="media-badge ${badgeClass}">${badgeLabel}</span>
      ${ratingHTML}
    </div>
    <div class="card-content">
      <h3 class="card-title">${escapeHtml(title)}</h3>
      <div class="card-meta">${year ? year : 'Release date N/A'} • ID: ${tmdbId}</div>
      <p class="card-overview">${escapeHtml(overview)}</p>
      <div class="card-actions">
        ${buttonHTML}
      </div>
    </div>
  `;

  return card;
}

/* ==========================================================================
   Full Media Details Page Logic (Full Screen Page)
   ========================================================================== */

async function openDetailsPage(id, mediaType, localItem = {}) {
  showDetailsView();
  const pageContent = document.getElementById('detailsPageContent');
  const apiKeyInput = document.getElementById('apiKey').value.trim();
  const savedKey = localStorage.getItem('tmdb_key');
  const apiKey = apiKeyInput || savedKey;

  pageContent.innerHTML = `
    <div class="loading-box">
      <div class="spinner"></div>
      <p>Loading full details, release dates & cast info...</p>
    </div>
  `;

  let details = localItem;
  if (apiKey) {
    try {
      const res = await fetch(`https://api.themoviedb.org/3/${mediaType}/${id}?api_key=${apiKey}&append_to_response=credits,release_dates`);
      if (res.ok) {
        details = await res.json();
      }
    } catch (e) {
      console.warn("Could not fetch detailed TMDb info", e);
    }
  }

  renderDetailsPage(details, id, mediaType);
}

function renderDetailsPage(details, id, mediaType) {
  const pageContent = document.getElementById('detailsPageContent');
  const title = details.title || details.name || 'Untitled';
  const tagline = details.tagline || '';
  const overview = details.overview || 'No description available.';
  const posterPath = details.poster_path || '';
  const posterUrl = posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : '';
  const backdropPath = details.backdrop_path || '';
  const backdropUrl = backdropPath ? `https://image.tmdb.org/t/p/w1280${backdropPath}` : posterUrl;
  const rating = details.vote_average ? details.vote_average.toFixed(1) : '';
  const voteCount = details.vote_count ? details.vote_count.toLocaleString() : '';
  const releaseDate = details.release_date || details.first_air_date || details.release_year || 'Unknown';
  const genres = details.genres ? details.genres.map(g => g.name) : [];
  const status = details.status || 'N/A';
  const runtime = details.runtime ? `${details.runtime} mins` : (details.number_of_seasons ? `${details.number_of_seasons} Season(s), ${details.number_of_episodes || 0} Episodes` : 'N/A');
  const createdBy = details.created_by ? details.created_by.map(c => c.name).join(', ') : '';

  // 1. Notification Alert & Release Schedules
  let notificationAlertHTML = '';
  let releaseScheduleHTML = '';

  if (mediaType === 'tv') {
    const nextEp = details.next_episode_to_air;
    const lastEp = details.last_episode_to_air;

    if (nextEp) {
      notificationAlertHTML = `
        <div class="notification-alert-box">
          <div class="notification-alert-icon">🔔</div>
          <div>
            <div class="notification-alert-title">Upcoming Release Notification</div>
            <div class="notification-alert-desc">
              <strong>Season ${nextEp.season_number} Episode ${nextEp.episode_number}</strong> ${nextEp.name ? `("${escapeHtml(nextEp.name)}")` : ''} is scheduled to air on <strong>${nextEp.air_date}</strong>.
            </div>
          </div>
        </div>
      `;
    } else {
      notificationAlertHTML = `
        <div class="notification-alert-box" style="background: rgba(255,255,255,0.05); border-color: var(--g-border);">
          <div class="notification-alert-icon">ℹ️</div>
          <div>
            <div class="notification-alert-title" style="color:var(--g-subtext);">Release Status</div>
            <div class="notification-alert-desc">No upcoming episode air dates currently announced on TMDb.</div>
          </div>
        </div>
      `;
    }

    let scheduleItems = [];
    if (nextEp) {
      scheduleItems.push(`
        <div class="schedule-item">
          <span class="schedule-label"><span>📺</span> Next Episode (Season ${nextEp.season_number} Ep ${nextEp.episode_number})</span>
          <span class="schedule-date">${nextEp.air_date}</span>
        </div>
      `);
    }
    if (lastEp) {
      scheduleItems.push(`
        <div class="schedule-item">
          <span class="schedule-label"><span>⏮️</span> Latest Aired (Season ${lastEp.season_number} Ep ${lastEp.episode_number})</span>
          <span class="schedule-date" style="background:var(--g-surface-hover); color:var(--g-text);">${lastEp.air_date}</span>
        </div>
      `);
    }

    if (details.seasons && details.seasons.length > 0) {
      details.seasons.forEach(s => {
        if (s.season_number > 0) {
          scheduleItems.push(`
            <div class="schedule-item">
              <span class="schedule-label"><span>🎬</span> ${escapeHtml(s.name)} (${s.episode_count} episodes)</span>
              <span class="schedule-date" style="background:var(--g-surface-hover); color:var(--g-subtext);">${s.air_date || 'TBA'}</span>
            </div>
          `);
        }
      });
    }

    if (scheduleItems.length > 0) {
      releaseScheduleHTML = `
        <div class="details-section-header">📅 Season & Release Schedule</div>
        <div class="schedule-list">
          ${scheduleItems.join('')}
        </div>
      `;
    }

  } else if (mediaType === 'movie') {
    let cinemaDate = '';
    let digitalDate = '';
    let physicalDate = '';
    let digitalCountry = '';

    if (details.release_dates && details.release_dates.results) {
      // 1. Check US releases first
      const usReleases = details.release_dates.results.find(r => r.iso_3166_1 === 'US');
      if (usReleases && usReleases.release_dates) {
        usReleases.release_dates.forEach(rd => {
          const dateStr = rd.release_date ? rd.release_date.split('T')[0] : '';
          if (rd.type === 3 && !cinemaDate) cinemaDate = dateStr;
          if (rd.type === 4 && !digitalDate) digitalDate = dateStr;
          if (rd.type === 5 && !physicalDate) physicalDate = dateStr;
        });
      }

      // 2. If Digital date not in US, check all other countries in TMDb release_dates
      if (!digitalDate) {
        for (const country of details.release_dates.results) {
          if (country.release_dates) {
            const dig = country.release_dates.find(rd => rd.type === 4);
            if (dig && dig.release_date) {
              digitalDate = dig.release_date.split('T')[0];
              digitalCountry = country.iso_3166_1;
              break;
            }
          }
        }
      }
    }

    if (digitalDate) {
      notificationAlertHTML = `
        <div class="notification-alert-box">
          <div class="notification-alert-icon">🔔</div>
          <div>
            <div class="notification-alert-title">Digital Release Alert</div>
            <div class="notification-alert-desc">Official Digital Release scheduled for <strong>${digitalDate}</strong> ${digitalCountry ? `(${digitalCountry})` : ''}.</div>
          </div>
        </div>
      `;
    } else if (cinemaDate) {
      notificationAlertHTML = `
        <div class="notification-alert-box">
          <div class="notification-alert-icon">🔔</div>
          <div>
            <div class="notification-alert-title">Cinema Release Alert</div>
            <div class="notification-alert-desc">Official Theatrical Release scheduled for <strong>${cinemaDate}</strong>. <em>(Digital VOD/Streaming release date TBA on TMDb)</em></div>
          </div>
        </div>
      `;
    } else {
      notificationAlertHTML = `
        <div class="notification-alert-box" style="background: rgba(255,255,255,0.05); border-color: var(--g-border);">
          <div class="notification-alert-icon">ℹ️</div>
          <div>
            <div class="notification-alert-title" style="color:var(--g-subtext);">Release Status</div>
            <div class="notification-alert-desc">No confirmed release dates listed on TMDb yet.</div>
          </div>
        </div>
      `;
    }

    let movieSchedule = [];
    movieSchedule.push(`
      <div class="schedule-item">
        <span class="schedule-label"><span>🍿</span> Cinema / Theatrical Release</span>
        <span class="schedule-date" style="${cinemaDate ? '' : 'background:var(--g-surface-hover); color:var(--g-subtext);'}">${cinemaDate || 'TBA (Not on TMDb)'}</span>
      </div>
    `);

    movieSchedule.push(`
      <div class="schedule-item">
        <span class="schedule-label"><span>💻</span> Digital / Streaming Release</span>
        <span class="schedule-date" style="${digitalDate ? '' : 'background:var(--g-surface-hover); color:var(--g-subtext);'}">${digitalDate ? `${digitalDate} ${digitalCountry ? `(${digitalCountry})` : ''}` : 'TBA (Not announced on TMDb yet)'}</span>
      </div>
    `);

    if (physicalDate) {
      movieSchedule.push(`
        <div class="schedule-item">
          <span class="schedule-label"><span>💿</span> Physical Disc Release</span>
          <span class="schedule-date" style="background:var(--g-surface-hover); color:var(--g-subtext);">${physicalDate}</span>
        </div>
      `);
    }

    releaseScheduleHTML = `
      <div class="details-section-header">📅 Release Dates Breakdown</div>
      <div class="schedule-list">
        ${movieSchedule.join('')}
      </div>
    `;
  }

  // 2. Cast & Crew Info
  let castHTML = '';
  const castList = (details.credits && details.credits.cast) ? details.credits.cast.slice(0, 10) : [];
  if (castList.length > 0) {
    castHTML = `
      <div class="details-section-header">⭐ Featured Cast</div>
      <div class="cast-row">
        ${castList.map(c => {
          const avatarUrl = c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : '';
          const avatarHTML = avatarUrl
            ? `<img src="${avatarUrl}" alt="${escapeHtml(c.name)}" class="cast-avatar">`
            : `<div class="cast-avatar" style="display:flex;align-items:center;justify-content:center;font-size:1.2rem;">👤</div>`;
          return `
            <div class="cast-card">
              ${avatarHTML}
              <div class="cast-name">${escapeHtml(c.name)}</div>
              <div class="cast-character">${escapeHtml(c.character || '')}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  const isSaved = watchlist.some(i => i.tmdb_id === id);

  const safeTitle = escapeHtml(title).replace(/'/g, "\\'");
  const safeOverview = escapeHtml(overview).replace(/'/g, "\\'");

  let actionBtn = '';
  if (isSaved) {
    actionBtn = `<button class="g-btn g-btn-danger" onclick="removeItem(${id}); openDetailsPage(${id}, '${mediaType}', ${JSON.stringify(details).replace(/"/g, '&quot;')})">🗑 Remove from Watchlist</button>`;
  } else {
    actionBtn = `<button class="g-btn" onclick="addItem(${id}, '${mediaType}', '${safeTitle}', '${posterPath}', '${rating}', '${releaseDate.substring(0, 4)}', '${safeOverview}'); openDetailsPage(${id}, '${mediaType}', ${JSON.stringify(details).replace(/"/g, '&quot;')})">+ Add to Watchlist</button>`;
  }

  pageContent.innerHTML = `
    <div class="details-backdrop-header" style="${backdropUrl ? `background-image: url('${backdropUrl}');` : ''}"></div>
    <div class="details-body">
      ${posterUrl ? `<img src="${posterUrl}" alt="${escapeHtml(title)}" class="details-poster-img">` : ''}
      <div class="details-info">
        <h2 class="details-title">${escapeHtml(title)}</h2>
        ${tagline ? `<p class="details-tagline">"${escapeHtml(tagline)}"</p>` : ''}
        
        <div class="details-meta-row">
          <span class="media-badge ${mediaType === 'tv' ? 'badge-tv' : 'badge-movie'}" style="position:static;">${mediaType === 'tv' ? 'TV SHOW' : 'MOVIE'}</span>
          ${rating ? `<span style="color:#fbbc04; font-weight:700;">★ ${rating}</span> ${voteCount ? `<span style="color:var(--g-subtext); font-size:0.8rem;">(${voteCount} votes)</span>` : ''}` : ''}
          ${genres.map(g => `<span class="genre-chip">${escapeHtml(g)}</span>`).join('')}
        </div>

        ${notificationAlertHTML}

        <p class="details-overview">${escapeHtml(overview)}</p>

        ${releaseScheduleHTML}

        ${castHTML}

        <div class="details-section-header">ℹ️ Overview Details</div>
        <div class="details-meta-grid">
          <div>
            <div class="detail-item-label">Release / First Air</div>
            <div class="detail-item-val">${escapeHtml(releaseDate)}</div>
          </div>
          <div>
            <div class="detail-item-label">Runtime / Format</div>
            <div class="detail-item-val">${escapeHtml(runtime)}</div>
          </div>
          <div>
            <div class="detail-item-label">Status</div>
            <div class="detail-item-val">${escapeHtml(status)}</div>
          </div>
          ${createdBy ? `
            <div>
              <div class="detail-item-label">Created By</div>
              <div class="detail-item-val">${escapeHtml(createdBy)}</div>
            </div>
          ` : ''}
          <div>
            <div class="detail-item-label">TMDb ID</div>
            <div class="detail-item-val">${id}</div>
          </div>
        </div>

        <div class="details-action-row">
          ${actionBtn}
          <a href="https://www.themoviedb.org/${mediaType}/${id}" target="_blank" rel="noopener" class="g-btn g-btn-secondary" style="text-decoration:none;">🔗 View on TMDb</a>
        </div>
      </div>
    </div>
  `;
}

/* ==========================================================================
   Watchlist Operations
   ========================================================================== */

function addItem(id, type, title, posterPath = '', rating = '', year = '', overview = '') {
  if (watchlist.some(i => i.tmdb_id === id)) {
    return alert('Already in your watchlist!');
  }
  watchlist.push({
    tmdb_id: id,
    type: type,
    title: title,
    poster_path: posterPath,
    vote_average: parseFloat(rating) || null,
    release_year: year,
    overview: overview
  });
  renderWatchlist();

  const searchInput = document.getElementById('searchInput').value.trim();
  if (searchInput) {
    searchMedia();
  }
}

function removeItem(id) {
  watchlist = watchlist.filter(i => i.tmdb_id !== id);
  renderWatchlist();

  const searchInput = document.getElementById('searchInput').value.trim();
  if (searchInput) {
    searchMedia();
  }
}

function renderWatchlist() {
  document.getElementById('count').innerText = watchlist.length;
  const container = document.getElementById('watchlist');
  container.innerHTML = '';

  if (watchlist.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
        <p>Your watchlist is currently empty.</p>
      </div>
    `;
    return;
  }

  watchlist.forEach(item => {
    const card = createMediaCard(item, true);
    container.appendChild(card);
  });
}

async function saveWatchlistDirectly() {
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span>⏳</span> Saving...`;
  }

  try {
    const res = await fetch('/save-watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(watchlist)
    });

    if (res.ok) {
      alert('✅ watchlist.json updated directly in your project folder!');
    } else {
      alert('❌ Failed to save watchlist.');
    }
  } catch (e) {
    alert('❌ Error saving watchlist.');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<span>💾</span> Save Watchlist`;
    }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

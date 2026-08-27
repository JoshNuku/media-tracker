// Global Application State
let watchlist = [];
let currentUser = null;
let activeTab = 'watchlist';
let currentSelectedFriend = null;

// Live Firebase Configuration for VESPER
const defaultFirebaseConfig = {
  apiKey: "AIzaSyDkEacdASMNvLHHvRMp2g41ckxnT52zJRY",
  authDomain: "swivel-ec2db.firebaseapp.com",
  projectId: "swivel-ec2db",
  storageBucket: "swivel-ec2db.firebasestorage.app",
  messagingSenderId: "47735840508",
  appId: "1:47735840508:web:e40e466c76e8d7b2ea0179",
  measurementId: "G-1DMYTZKRBG"
};

let firebaseInitialized = false;

// Restore cached user session immediately if present
try {
  const cachedUserStr = localStorage.getItem('vesper_current_user');
  if (cachedUserStr) {
    currentUser = JSON.parse(cachedUserStr);
  }
} catch (e) {
  console.warn("Could not parse cached user:", e);
}

window.onload = async () => {
  initTheme();
  initBottomSheetTouchGestures();
  if (currentUser) {
    updateAuthUI(true);
    const landing = document.getElementById('landingPage');
    const mainApp = document.getElementById('mainAppView');
    if (landing) landing.style.display = 'none';
    if (mainApp) mainApp.style.display = 'block';
    await loadWatchlist();
  } else {
    updateAuthUI(false);
    showLandingPage();
  }
  initFirebase();
};

/* ==========================================================================
   Firebase Authentication & User Management
   ========================================================================== */
function initFirebase() {
  try {
    if (!firebase.apps.length) {
      const savedConfig = localStorage.getItem('firebase_custom_config');
      const config = savedConfig ? JSON.parse(savedConfig) : defaultFirebaseConfig;
      firebase.initializeApp(config);
    }
    firebaseInitialized = true;

    if (firebase.auth) {
      firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
    }

    firebase.auth().onAuthStateChanged(async (user) => {
      if (user) {
        // User is signed in
        const userSyncData = {
          uid: user.uid,
          email: user.email,
          display_name: user.displayName || user.email.split('@')[0],
          photo_url: user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`
        };

        try {
          const res = await fetch('/api/user/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userSyncData)
          });
          if (res.ok) {
            currentUser = await res.json();
            localStorage.setItem('vesper_current_user', JSON.stringify(currentUser));
            updateAuthUI(true);

            // Check if onboarding is needed
            if (!currentUser.onboarded) {
              openNtfyModal(false);
            }
          }
        } catch (e) {
          console.error("Failed to sync user with backend:", e);
        }

        await loadWatchlist();
        const landing = document.getElementById('landingPage');
        if (landing && landing.style.display !== 'none') {
          enterAppDirectly(activeTab || 'watchlist');
        }

      } else {
        // Guest mode / signed out
        if (!localStorage.getItem('vesper_current_user')) {
          currentUser = null;
          updateAuthUI(false);
          showLandingPage();
        }
      }
    });
  } catch (e) {
    console.warn("Firebase Auth not initialized or using fallback mode:", e);
  }
}

function updateAuthUI(isLoggedIn) {
  const loginBtn = document.getElementById('googleLoginBtn');
  const badge = document.getElementById('userProfileBadge');
  const avatar = document.getElementById('userAvatar');
  const userName = document.getElementById('userName');

  // Landing page elements
  const landingHeroLoginBtn = document.getElementById('landingHeroLoginBtn');
  const heroCtaBtn = document.getElementById('heroCtaBtn');

  if (isLoggedIn && currentUser) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (badge) badge.style.display = 'inline-flex';
    const avatarUrl = currentUser.photo_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(currentUser.uid || 'user')}`;
    if (avatar) {
      avatar.src = avatarUrl;
      avatar.onerror = () => {
        avatar.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(currentUser.uid || 'user')}`;
      };
    }
    const firstName = currentUser.display_name ? currentUser.display_name.trim().split(' ')[0] : 'User';
    if (userName) userName.innerText = firstName;

    // Update modal profile card elements
    const modalAvatar = document.getElementById('modalProfileAvatar');
    const modalName = document.getElementById('modalProfileName');
    const modalEmail = document.getElementById('modalProfileEmail');
    if (modalAvatar) modalAvatar.src = avatarUrl;
    if (modalName) modalName.innerText = currentUser.display_name || 'VESPER Member';
    if (modalEmail) modalEmail.innerText = currentUser.email || '';

    if (landingHeroLoginBtn) landingHeroLoginBtn.style.display = 'none';
    if (heroCtaBtn) {
      heroCtaBtn.innerHTML = `Launch Dashboard <span class="arrow-circle"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" /></svg></span>`;
    }
  } else {
    if (loginBtn) loginBtn.style.display = 'inline-flex';
    if (badge) badge.style.display = 'none';

    if (landingHeroLoginBtn) landingHeroLoginBtn.style.display = 'inline-flex';
    if (heroCtaBtn) {
      heroCtaBtn.innerHTML = `Sign In & Launch <span class="arrow-circle"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" /></svg></span>`;
    }
  }
}

async function loginWithGoogle() {
  if (!firebaseInitialized) {
    const demoEmail = prompt("Enter an email address to log in as a demo user:");
    if (!demoEmail) return;
    const uid = 'user_' + Math.abs(hashCode(demoEmail));
    const res = await fetch('/api/user/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, email: demoEmail, display_name: demoEmail.split('@')[0], photo_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${uid}` })
    });
    if (res.ok) {
      currentUser = await res.json();
      updateAuthUI(true);
      if (!currentUser.onboarded) openNtfyModal(false);
      await loadWatchlist();
      enterAppDirectly();
    }
    return;
  }

  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    await firebase.auth().signInWithPopup(provider);
  } catch (e) {
    console.error("Popup sign-in failed, trying redirect:", e);
    try {
      await firebase.auth().signInWithRedirect(provider);
    } catch (err) {
      alert("Sign-in failed: " + err.message);
    }
  }
}

async function logoutFirebase() {
  try {
    if (firebaseInitialized && firebase.auth) {
      await firebase.auth().signOut();
    }
  } catch (e) {
    console.warn(e);
  }
  currentUser = null;
  localStorage.removeItem('vesper_current_user');
  updateAuthUI(false);
  showLandingPage();
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/* ==========================================================================
   Modals & Onboarding
   ========================================================================== */
function openAboutModal() {
  const modal = document.getElementById('aboutModal');
  if (modal) modal.style.display = 'flex';
}

function closeAboutModal() {
  const modal = document.getElementById('aboutModal');
  if (modal) modal.style.display = 'none';
}

function openNtfyModal(isEdit = false) {
  const modal = document.getElementById('ntfyModal');
  const topicInput = document.getElementById('ntfyTopicInput');
  const publicToggle = document.getElementById('publicProfileToggle');
  const modalTitle = document.getElementById('ntfyModalTitle');
  const modalAvatar = document.getElementById('modalProfileAvatar');
  const modalName = document.getElementById('modalProfileName');
  const modalEmail = document.getElementById('modalProfileEmail');

  if (currentUser) {
    if (modalAvatar) {
      modalAvatar.src = currentUser.photo_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(currentUser.uid || 'user')}`;
    }
    if (modalName) modalName.innerText = currentUser.display_name || 'VESPER Member';
    if (modalEmail) modalEmail.innerText = currentUser.email || '';
  }

  if (modalTitle) {
    modalTitle.innerText = isEdit ? 'Account & Settings' : 'Onboarding: Set Up Push Alerts';
  }

  let defaultTopic = currentUser ? (currentUser.ntfy_topic || `vesper-${currentUser.uid.substring(0,8)}`) : 'vesper-cinema-updates';
  if (defaultTopic.startsWith('mediatracker-')) {
    defaultTopic = defaultTopic.replace('mediatracker-', 'vesper-');
    if (currentUser) currentUser.ntfy_topic = defaultTopic;
  }
  
  if (topicInput) topicInput.value = defaultTopic;
  if (publicToggle && currentUser) publicToggle.checked = currentUser.is_public !== false;

  updateNtfySubscribeLink(defaultTopic);

  if (topicInput) {
    topicInput.oninput = () => {
      updateNtfySubscribeLink(topicInput.value.trim());
    };
  }

  if (modal) modal.style.display = 'flex';
}

function closeNtfyModal() {
  document.getElementById('ntfyModal').style.display = 'none';
}

function updateNtfySubscribeLink(topic) {
  const link = document.getElementById('ntfySubscribeLink');
  if (link && topic) {
    link.href = `https://ntfy.sh/${encodeURIComponent(topic)}`;
  }
}

async function sendTestPushAlert() {
  const topicInput = document.getElementById('ntfyTopicInput');
  const topic = topicInput ? topicInput.value.trim() : '';
  if (!topic) return alert('Please enter a ntfy topic first.');

  try {
    const res = await fetch('/api/ntfy/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ntfy_topic: topic })
    });
    const data = await res.json();
    if (res.ok) {
      alert('Test push notification dispatched! Check your ntfy app or https://ntfy.sh/' + topic);
    } else {
      alert('Test push notification failed: ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    alert('Error sending test notification: ' + e.message);
  }
}

async function saveNtfyOnboarding() {
  const topicInput = document.getElementById('ntfyTopicInput');
  const publicToggle = document.getElementById('publicProfileToggle');

  const ntfy_topic = topicInput ? topicInput.value.trim() : '';
  const is_public = publicToggle ? publicToggle.checked : true;

  if (currentUser) {
    try {
      const res = await fetch('/api/user/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: currentUser.uid,
          ntfy_topic: ntfy_topic,
          is_public: is_public,
          onboarded: true
        })
      });
      if (res.ok) {
        currentUser = await res.json();
      }
    } catch (e) {
      console.error(e);
    }
  }
  closeNtfyModal();
}

/* ==========================================================================
   Tab Navigation & Landing Page Routing
   ========================================================================== */
function requireAuth(customMessage = "Please sign in with Google to access the dashboard and perform actions.") {
  if (!currentUser) {
    showLandingPage();
    alert(customMessage);
    loginWithGoogle();
    return false;
  }
  return true;
}

function showLandingPage() {
  const landing = document.getElementById('landingPage');
  const mainApp = document.getElementById('mainAppView');
  if (landing) landing.style.display = 'flex';
  if (mainApp) mainApp.style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function enterAppDirectly(preferredTab = 'watchlist') {
  if (!currentUser) {
    loginWithGoogle();
    return;
  }
  const landing = document.getElementById('landingPage');
  const mainApp = document.getElementById('mainAppView');
  if (landing) landing.style.display = 'none';
  if (mainApp) mainApp.style.display = 'block';
  switchTab(preferredTab);
}

function switchTab(tabName) {
  if (!currentUser) {
    showLandingPage();
    loginWithGoogle();
    return;
  }
  const landing = document.getElementById('landingPage');
  const mainApp = document.getElementById('mainAppView');
  if (landing) landing.style.display = 'none';
  if (mainApp) mainApp.style.display = 'block';

  activeTab = tabName;
  document.querySelectorAll('.tab-page').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));

  if (tabName === 'watchlist') {
    document.getElementById('watchlistTab').classList.add('active');
    document.getElementById('tabWatchlist').classList.add('active');
    renderWatchlist();
  } else if (tabName === 'search') {
    document.getElementById('searchTab').classList.add('active');
    document.getElementById('tabSearch').classList.add('active');
    const container = document.getElementById('searchResults');
    if (!container || !container.children.length || container.querySelector('.empty-state')) {
      loadDiscoverCategory('trending');
    }
  } else if (tabName === 'social') {
    document.getElementById('socialTab').classList.add('active');
    document.getElementById('tabSocial').classList.add('active');
    loadSocialData();
  } else if (tabName === 'recs') {
    document.getElementById('recsTab').classList.add('active');
    document.getElementById('tabRecs').classList.add('active');
    loadRecommendations();
  }

  closeDetailsPage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeDetailsPage() {
  document.getElementById('detailsPage').style.display = 'none';
  document.querySelector('.main-content-wrapper').style.display = 'block';
}

function openDetailsView() {
  document.querySelector('.main-content-wrapper').style.display = 'none';
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
  const iconSun = document.getElementById('themeIconSun');
  const iconMoon = document.getElementById('themeIconMoon');
  const toggleBtn = document.getElementById('themeToggleBtn');
  if (iconSun && iconMoon) {
    if (theme === 'light') {
      iconSun.style.display = 'block';
      iconMoon.style.display = 'none';
      if (toggleBtn) toggleBtn.setAttribute('title', 'Switch to Dark Mode');
    } else {
      iconSun.style.display = 'none';
      iconMoon.style.display = 'block';
      if (toggleBtn) toggleBtn.setAttribute('title', 'Switch to Light Mode');
    }
  }
}

/* ==========================================================================
   Watchlist Operations, User Activity & Reminders Synchronization
   ========================================================================== */
let currentWatchlistView = 'all';
let userActivityData = { ratings: [], comments: [] };
let userReminders = [];

async function loadUserReminders() {
  if (!currentUser) return [];
  try {
    const res = await fetch(`/api/reminders?user_id=${encodeURIComponent(currentUser.uid)}`);
    if (res.ok) {
      userReminders = await res.json();
      const remCount = document.getElementById('userRemindersCount');
      if (remCount) remCount.innerText = (userReminders || []).length;
    }
  } catch (e) {
    console.error("Error loading user reminders:", e);
  }
  return userReminders;
}

async function loadUserActivity() {
  if (!currentUser) return { ratings: [], comments: [] };
  try {
    const res = await fetch(`/api/user/activity?user_id=${encodeURIComponent(currentUser.uid)}`);
    if (res.ok) {
      userActivityData = await res.json();
      const rCount = document.getElementById('userRatingsCount');
      const cCount = document.getElementById('userCommentsCount');
      if (rCount) rCount.innerText = (userActivityData.ratings || []).length;
      if (cCount) cCount.innerText = (userActivityData.comments || []).length;
    }
  } catch (e) {
    console.error("Error loading user activity:", e);
  }
  return userActivityData;
}

function filterWatchlistView(viewType) {
  currentWatchlistView = viewType;
  
  // Update active pill styling
  ['all', 'movie', 'tv', 'reminders', 'rated', 'commented'].forEach(type => {
    const pill = document.getElementById(`pill-watch-${type}`);
    if (pill) {
      if (type === viewType) pill.classList.add('active');
      else pill.classList.remove('active');
    }
  });

  const titleEl = document.getElementById('watchlistSectionTitle');
  const saveBtn = document.getElementById('saveBtn');

  if (viewType === 'reminders') {
    if (titleEl) titleEl.innerText = 'Scheduled Watch Reminders';
    if (saveBtn) saveBtn.style.display = 'none';
    renderUserReminders();
  } else if (viewType === 'rated') {
    if (titleEl) titleEl.innerText = 'My Rated Movies & Shows';
    if (saveBtn) saveBtn.style.display = 'none';
    renderUserRatings();
  } else if (viewType === 'commented') {
    if (titleEl) titleEl.innerText = 'My Comments & Discussions';
    if (saveBtn) saveBtn.style.display = 'none';
    renderUserComments();
  } else {
    if (titleEl) titleEl.innerText = 'My Watchlist';
    if (saveBtn) saveBtn.style.display = 'inline-flex';
    renderWatchlist();
  }
}

async function loadWatchlist() {
  const userId = currentUser ? currentUser.uid : 'default_user';
  try {
    const res = await fetch(`/api/watchlist?user_id=${encodeURIComponent(userId)}`);
    if (res.ok) {
      watchlist = await res.json();
    }
  } catch (e) {
    console.warn("Could not load watchlist from server:", e);
  }
  await Promise.all([loadUserActivity(), loadUserReminders()]);
  if (currentWatchlistView === 'reminders') renderUserReminders();
  else if (currentWatchlistView === 'rated') renderUserRatings();
  else if (currentWatchlistView === 'commented') renderUserComments();
  else renderWatchlist();
}

function renderWatchlist() {
  const container = document.getElementById('watchlist');
  if (!container) return;
  container.classList.remove('activity-list-mode');
  container.innerHTML = '';

  let filtered = watchlist;
  if (currentWatchlistView === 'movie') {
    filtered = watchlist.filter(i => (i.type || i.media_type) === 'movie');
  } else if (currentWatchlistView === 'tv') {
    filtered = watchlist.filter(i => (i.type || i.media_type) === 'tv');
  }

  const countBadge = document.getElementById('count');
  if (countBadge) countBadge.innerText = filtered.length;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
        <p>Your watchlist is currently empty${currentWatchlistView !== 'all' ? ' for this filter' : ''}.</p>
      </div>
    `;
    return;
  }

  filtered.forEach(item => {
    const card = createMediaCard(item, true);
    container.appendChild(card);
  });
}

function renderUserRatings(searchQuery = '') {
  const container = document.getElementById('watchlist');
  if (!container) return;
  container.classList.add('activity-list-mode');
  container.innerHTML = '';

  let ratings = userActivityData.ratings || [];
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    ratings = ratings.filter(r => (r.title || '').toLowerCase().includes(q) || (r.review || '').toLowerCase().includes(q));
  }

  const countBadge = document.getElementById('count');
  if (countBadge) countBadge.innerText = (userActivityData.ratings || []).length;

  if (ratings.length === 0 && !searchQuery) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="#f59e0b"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
        <p>You haven't rated any movies or TV shows yet.<br>Click on any title in Discover or Watchlist to leave a rating!</p>
      </div>
    `;
    return;
  }

  const feedWrapper = document.createElement('div');
  feedWrapper.className = 'activity-feed-container';

  // Search filter bar
  const headerRow = document.createElement('div');
  headerRow.className = 'activity-feed-header';
  headerRow.innerHTML = `
    <div style="font-size:0.85rem; color:var(--g-subtext); font-weight:600;">
      Showing ${ratings.length} rated title${ratings.length !== 1 ? 's' : ''}
    </div>
    <div class="activity-search-box">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" placeholder="Filter reviews by title or keyword..." value="${escapeHtml(searchQuery)}" oninput="renderUserRatings(this.value)">
    </div>
  `;
  feedWrapper.appendChild(headerRow);

  if (ratings.length === 0 && searchQuery) {
    feedWrapper.innerHTML += `<div class="empty-state" style="padding:2rem;"><p>No reviews match "${escapeHtml(searchQuery)}".</p></div>`;
    container.appendChild(feedWrapper);
    return;
  }

  ratings.forEach(r => {
    const row = document.createElement('div');
    row.className = 'activity-row-item';
    const posterUrl = r.poster_path ? (r.poster_path.startsWith('http') ? r.poster_path : `https://image.tmdb.org/t/p/w500${r.poster_path}`) : null;
    const mediaType = r.type || 'movie';
    const badgeLabel = mediaType === 'tv' ? 'TV SHOW' : 'MOVIE';
    const watchUrl = mediaType === 'tv' ? `https://hydrahd.com/tv/${r.tmdb_id}` : `https://hydrahd.com/watch/${r.tmdb_id}`;
    const dateStr = r.updated_at ? r.updated_at.substring(0, 10) : '';

    row.onclick = () => openDetailsPage(r.tmdb_id, mediaType);

    row.innerHTML = `
      <div class="activity-row-left">
        ${posterUrl ? `<img src="${posterUrl}" class="activity-poster-thumb" alt="Poster">` : `<div class="activity-poster-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--g-subtext);font-size:0.7rem;">No Img</div>`}
        <div class="activity-row-info">
          <div class="activity-row-title-row">
            <h4 class="activity-row-title">${escapeHtml(r.title || `Media #${r.tmdb_id}`)}</h4>
            <span class="activity-row-badge">${badgeLabel}</span>
          </div>
          <div class="activity-row-content">
            <span class="activity-row-score">${renderStarRating(r.score)} ${r.score}/5</span>
            ${r.review ? `<span class="activity-row-snippet">"${escapeHtml(r.review)}"</span>` : ''}
          </div>
          <span class="activity-row-date">${dateStr}</span>
        </div>
      </div>
      <div class="activity-row-actions" onclick="event.stopPropagation()">
        <button class="activity-pill-btn" onclick="openDetailsPage(${r.tmdb_id}, '${mediaType}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Details
        </button>
        <a class="activity-pill-btn hydra-link" href="${watchUrl}" target="_blank" rel="noopener">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Stream
        </a>
        <button class="activity-icon-btn" onclick="deleteUserRating(${r.id}, ${r.tmdb_id})" title="Delete Rating">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    `;
    feedWrapper.appendChild(row);
  });

  container.appendChild(feedWrapper);
}

function renderUserComments(searchQuery = '') {
  const container = document.getElementById('watchlist');
  if (!container) return;
  container.classList.add('activity-list-mode');
  container.innerHTML = '';

  let comments = userActivityData.comments || [];
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    comments = comments.filter(c => (c.title || '').toLowerCase().includes(q) || (c.content || '').toLowerCase().includes(q));
  }

  const countBadge = document.getElementById('count');
  if (countBadge) countBadge.innerText = (userActivityData.comments || []).length;

  if (comments.length === 0 && !searchQuery) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <p>You haven't posted any comments or replies yet.<br>Join the discussion on any movie or TV show!</p>
      </div>
    `;
    return;
  }

  const feedWrapper = document.createElement('div');
  feedWrapper.className = 'activity-feed-container';

  // Search filter bar
  const headerRow = document.createElement('div');
  headerRow.className = 'activity-feed-header';
  headerRow.innerHTML = `
    <div style="font-size:0.85rem; color:var(--g-subtext); font-weight:600;">
      Showing ${comments.length} comment${comments.length !== 1 ? 's' : ''}
    </div>
    <div class="activity-search-box">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" placeholder="Filter comments by title or message..." value="${escapeHtml(searchQuery)}" oninput="renderUserComments(this.value)">
    </div>
  `;
  feedWrapper.appendChild(headerRow);

  if (comments.length === 0 && searchQuery) {
    feedWrapper.innerHTML += `<div class="empty-state" style="padding:2rem;"><p>No comments match "${escapeHtml(searchQuery)}".</p></div>`;
    container.appendChild(feedWrapper);
    return;
  }

  comments.forEach(c => {
    const row = document.createElement('div');
    row.className = 'activity-row-item';
    const posterUrl = c.poster_path ? (c.poster_path.startsWith('http') ? c.poster_path : `https://image.tmdb.org/t/p/w500${c.poster_path}`) : null;
    const mediaType = c.type || 'movie';
    const badgeLabel = mediaType === 'tv' ? 'TV SHOW' : 'MOVIE';
    const watchUrl = mediaType === 'tv' ? `https://hydrahd.com/tv/${c.tmdb_id}` : `https://hydrahd.com/watch/${c.tmdb_id}`;
    const dateStr = c.created_at ? c.created_at.substring(0, 16) : '';

    row.onclick = () => openDetailsPage(c.tmdb_id, mediaType);

    row.innerHTML = `
      <div class="activity-row-left">
        ${posterUrl ? `<img src="${posterUrl}" class="activity-poster-thumb" alt="Poster">` : `<div class="activity-poster-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--g-subtext);font-size:0.7rem;">No Img</div>`}
        <div class="activity-row-info">
          <div class="activity-row-title-row">
            <h4 class="activity-row-title">${escapeHtml(c.title || `Media #${c.tmdb_id}`)}</h4>
            <span class="activity-row-badge">${badgeLabel}</span>
          </div>
          <div class="activity-row-content">
            <span style="color:var(--g-text); line-height:1.4;">"${escapeHtml(c.content)}"</span>
          </div>
          <span class="activity-row-date">${dateStr}</span>
        </div>
      </div>
      <div class="activity-row-actions" onclick="event.stopPropagation()">
        <button class="activity-pill-btn" onclick="openDetailsPage(${c.tmdb_id}, '${mediaType}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Discussion
        </button>
        <a class="activity-pill-btn hydra-link" href="${watchUrl}" target="_blank" rel="noopener">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Stream
        </a>
        <button class="activity-icon-btn" onclick="deleteUserComment(${c.id}, ${c.tmdb_id})" title="Delete Comment">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    `;
    feedWrapper.appendChild(row);
  });

  container.appendChild(feedWrapper);
}

function renderUserReminders(searchQuery = '') {
  const container = document.getElementById('watchlist');
  if (!container) return;
  container.classList.add('activity-list-mode');
  container.innerHTML = '';

  let reminders = userReminders || [];
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    reminders = reminders.filter(r => (r.media_title || '').toLowerCase().includes(q) || (r.note || '').toLowerCase().includes(q));
  }

  const countBadge = document.getElementById('count');
  if (countBadge) countBadge.innerText = (userReminders || []).length;

  if (reminders.length === 0 && !searchQuery) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="color:var(--g-subtext); margin-bottom:0.75rem;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <p>You don't have any scheduled watch reminders yet.<br>Click "⏰ Remind Me" on any movie or TV show to schedule a watch time!</p>
      </div>
    `;
    return;
  }

  const feedWrapper = document.createElement('div');
  feedWrapper.className = 'activity-feed-container';

  // Search filter bar
  const headerRow = document.createElement('div');
  headerRow.className = 'activity-feed-header';
  headerRow.innerHTML = `
    <div style="font-size:0.85rem; color:var(--g-subtext); font-weight:600;">
      Showing ${reminders.length} scheduled reminder${reminders.length !== 1 ? 's' : ''}
    </div>
    <div class="activity-search-box">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" placeholder="Filter reminders by title or note..." value="${escapeHtml(searchQuery)}" oninput="renderUserReminders(this.value)">
    </div>
  `;
  feedWrapper.appendChild(headerRow);

  if (reminders.length === 0 && searchQuery) {
    feedWrapper.innerHTML += `<div class="empty-state" style="padding:2rem;"><p>No reminders match "${escapeHtml(searchQuery)}".</p></div>`;
    container.appendChild(feedWrapper);
    return;
  }

  reminders.forEach(r => {
    const row = document.createElement('div');
    row.className = 'activity-row-item';
    const posterUrl = r.poster_path ? (r.poster_path.startsWith('http') ? r.poster_path : `https://image.tmdb.org/t/p/w500${r.poster_path}`) : null;
    const mediaType = r.media_type || 'movie';
    const badgeLabel = mediaType === 'tv' ? 'TV SHOW' : 'MOVIE';
    const watchUrl = mediaType === 'tv' ? `https://hydrahd.com/tv/${r.tmdb_id}` : `https://hydrahd.com/watch/${r.tmdb_id}`;
    
    // Format remind_at date nicely
    let formattedTime = r.remind_at || '';
    try {
      const d = new Date(r.remind_at);
      if (!isNaN(d.getTime())) {
        formattedTime = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ' at ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      }
    } catch (e) {}

    row.onclick = () => openDetailsPage(r.tmdb_id, mediaType);

    row.innerHTML = `
      <div class="activity-row-left">
        ${posterUrl ? `<img src="${posterUrl}" class="activity-poster-thumb" alt="Poster">` : `<div class="activity-poster-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--g-subtext);font-size:0.7rem;">No Img</div>`}
        <div class="activity-row-info">
          <div class="activity-row-title-row">
            <h4 class="activity-row-title">${escapeHtml(r.media_title || `Media #${r.tmdb_id}`)}</h4>
            <span class="activity-row-badge">${badgeLabel}</span>
          </div>
          <div class="activity-row-content">
            <span class="reminder-scheduled-badge">⏰ ${escapeHtml(formattedTime)}</span>
            ${r.note ? `<span class="activity-row-snippet">"${escapeHtml(r.note)}"</span>` : ''}
          </div>
        </div>
      </div>
      <div class="activity-row-actions" onclick="event.stopPropagation()">
        <button class="activity-pill-btn" onclick="openDetailsPage(${r.tmdb_id}, '${mediaType}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Details
        </button>
        <a class="activity-pill-btn hydra-link" href="${watchUrl}" target="_blank" rel="noopener">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Stream
        </a>
        <button class="activity-icon-btn" onclick="deleteUserReminder(${r.id})" title="Delete Reminder">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    `;
    feedWrapper.appendChild(row);
  });

  container.appendChild(feedWrapper);
}

async function addItem(item, copiedFromUid = null) {
  const rawId = item.tmdb_id || item.id || item.tmdbId;
  const numericId = parseInt(rawId, 10);
  if (isNaN(numericId)) {
    console.error("Invalid TMDB ID for item:", item);
    return;
  }
  const userId = currentUser ? currentUser.uid : 'default_user';

  if (watchlist.some(i => parseInt(i.tmdb_id) === numericId)) return;

  const newItem = {
    tmdb_id: numericId,
    type: item.type || item.media_type || 'movie',
    title: item.title || item.name || 'Untitled',
    poster_path: item.poster_path || '',
    vote_average: parseFloat(item.vote_average) || null,
    release_year: (item.release_year || item.release_date || item.first_air_date || '').toString().substring(0, 4),
    overview: item.overview || ''
  };

  watchlist.push(newItem);
  renderWatchlist();

  try {
    await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
      body: JSON.stringify({ item: newItem, user_id: userId, copied_from_uid: copiedFromUid })
    });
  } catch (e) {
    console.error("Error adding item:", e);
  }
}

async function removeItem(id) {
  const numericId = parseInt(id);
  const userId = currentUser ? currentUser.uid : 'default_user';

  watchlist = watchlist.filter(i => parseInt(i.tmdb_id) !== numericId);
  renderWatchlist();

  try {
    await fetch(`/api/watchlist?user_id=${encodeURIComponent(userId)}&tmdb_id=${numericId}`, {
      method: 'DELETE'
    });
  } catch (e) {
    console.error("Error removing item:", e);
  }
}

async function saveWatchlistDirectly(silent = false) {
  const saveBtn = document.getElementById('saveBtn');
  const userId = currentUser ? currentUser.uid : 'default_user';
  if (saveBtn && !silent) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = `Saving...`;
  }

  try {
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
      body: JSON.stringify(watchlist)
    });

    if (res.ok) {
      if (!silent) alert('Watchlist saved to Database!');
    } else {
      const errData = await res.json().catch(() => ({}));
      if (!silent) alert('Failed to save watchlist: ' + (errData.error || res.statusText));
    }
  } catch (e) {
    if (!silent) alert('Error saving watchlist: ' + e.message);
  } finally {
    if (saveBtn && !silent) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `Save Watchlist`;
    }
  }
}

/* ==========================================================================
   Discover Feed & Categories
   ========================================================================== */
async function loadDiscoverCategory(category = 'trending') {
  const resultsContainer = document.getElementById('searchResults');
  const sectionTitle = document.getElementById('discoverSectionTitle');
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';

  const titles = {
    'trending': '🔥 Trending This Week',
    'popular_movies': '🎬 Popular Movies',
    'popular_tv': '📺 Popular TV Series',
    'upcoming': '⏳ Upcoming Releases',
    'now_playing': '🍿 Now In Theaters'
  };

  if (sectionTitle) {
    sectionTitle.innerText = titles[category] || 'Discover';
  }

  document.querySelectorAll('.discover-pill').forEach(pill => pill.classList.remove('active'));
  const activePill = document.getElementById(`pill-${category}`);
  if (activePill) activePill.classList.add('active');

  if (!resultsContainer) return;
  resultsContainer.innerHTML = `
    <div class="empty-state">
      <div class="spinner" style="margin-bottom:1rem;"></div>
      <p>Loading ${titles[category] || 'titles'}...</p>
    </div>
  `;

  try {
    const res = await fetch(`/api/discover?category=${encodeURIComponent(category)}`);
    const data = await res.json();

    if (!res.ok || data.error) {
      resultsContainer.innerHTML = `
        <div class="empty-state">
          <p style="color: var(--g-red);">${escapeHtml(data.error || 'Server error loading discover titles.')}</p>
        </div>
      `;
      return;
    }

    resultsContainer.innerHTML = '';
    const validItems = (data.results || []).filter(item => {
      const type = item.media_type || item.type || (category === 'popular_tv' ? 'tv' : 'movie');
      return type === 'movie' || type === 'tv';
    });

    if (validItems.length === 0) {
      resultsContainer.innerHTML = `
        <div class="empty-state">
          <p>No titles found in this category.</p>
        </div>
      `;
      return;
    }

    validItems.forEach(item => {
      const card = createMediaCard(item, false);
      resultsContainer.appendChild(card);
    });
  } catch (e) {
    console.error("Error loading discover category:", e);
    resultsContainer.innerHTML = `
      <div class="empty-state">
        <p style="color: var(--g-red);">Error connecting to discover API.</p>
      </div>
    `;
  }
}

/* ==========================================================================
   Backend Proxy Search & Media Cards
   ========================================================================== */
async function searchMedia() {
  const query = document.getElementById('searchInput').value.trim();
  const resultsContainer = document.getElementById('searchResults');
  const sectionTitle = document.getElementById('discoverSectionTitle');

  if (!query) {
    loadDiscoverCategory('trending');
    return;
  }

  document.querySelectorAll('.discover-pill').forEach(pill => pill.classList.remove('active'));
  if (sectionTitle) sectionTitle.innerText = `Search Results for "${query}"`;

  resultsContainer.innerHTML = `
    <div class="loading-box">
      <div class="spinner"></div>
      <p>Searching TMDb for "${escapeHtml(query)}"...</p>
    </div>
  `;

  try {
    const res = await fetch(`/api/search?query=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (!res.ok || data.error) {
      resultsContainer.innerHTML = `
        <div class="empty-state">
          <p style="color: var(--g-red);">${escapeHtml(data.error || 'Server error searching TMDb.')}</p>
        </div>
      `;
      return;
    }

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
        <p style="color: var(--g-red);">Error connecting to backend API. Please check server logs.</p>
      </div>
    `;
  }
}

function createMediaCard(item, isInWatchlist = false, isFriendList = false, friendUid = null) {
  const title = item.title || item.name || 'Untitled';
  const year = (item.release_date || item.first_air_date || item.release_year || '').substring(0, 4);
  const mediaType = item.media_type || item.type || 'movie';
  const posterPath = item.poster_path || '';
  const posterUrl = posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : '';
  const rating = item.vote_average ? parseFloat(item.vote_average).toFixed(1) : '';
  const overview = item.overview || 'No overview available.';
  const tmdbId = parseInt(item.id || item.tmdb_id);

  const watchUrl = `https://hydrahd.ws/index.php?menu=search&query=${encodeURIComponent(title)}`;

  const card = document.createElement('div');
  card.className = 'media-card';
  card.onclick = (e) => {
    if (!e.target.closest('button') && !e.target.closest('a')) {
      openDetailsPage(tmdbId, mediaType, item);
    }
  };

  const posterHTML = posterUrl
    ? `<img src="${posterUrl}" alt="${escapeHtml(title)}" class="poster-img" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
       <div class="poster-fallback" style="display:none;">
         <svg width="40" height="40" viewBox="0 0 24 24"><path fill="currentColor" d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H9l2 4H8L6 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>
       </div>`
    : `<div class="poster-fallback">
         <svg width="40" height="40" viewBox="0 0 24 24"><path fill="currentColor" d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H9l2 4H8L6 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>
       </div>`;

  const badgeClass = mediaType === 'tv' ? 'badge-tv' : 'badge-movie';
  const badgeLabel = mediaType === 'tv' ? 'TV SHOW' : 'MOVIE';
  const ratingHTML = rating ? `<div class="rating-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="margin-right:2px; vertical-align:-1px;"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>${rating}</div>` : '';

  const alreadySaved = watchlist.some(i => parseInt(i.tmdb_id) === tmdbId);

  const actionsDiv = document.createElement('div');
  actionsDiv.style.display = 'flex';
  actionsDiv.style.flexDirection = 'column';
  actionsDiv.style.gap = '0.5rem';

  const watchBtn = document.createElement('a');
  watchBtn.className = 'g-btn g-btn-hydra g-btn-full';
  watchBtn.href = watchUrl;
  watchBtn.target = '_blank';
  watchBtn.rel = 'noopener';
  watchBtn.innerHTML = 'Watch Free on HydraHD';
  watchBtn.onclick = (e) => e.stopPropagation();

  actionsDiv.appendChild(watchBtn);

  if (isFriendList) {
    const copyBtn = document.createElement('button');
    copyBtn.className = alreadySaved ? 'g-btn g-btn-secondary g-btn-full' : 'g-btn g-btn-add g-btn-full';
    if (alreadySaved) {
      copyBtn.innerHTML = 'In Your Watchlist';
      copyBtn.disabled = true;
    } else {
      copyBtn.innerHTML = 'Add to My Watchlist';
      copyBtn.onclick = async (e) => {
        e.stopPropagation();
        copyBtn.disabled = true;
        copyBtn.innerHTML = 'Adding...';
        await addItem(item, friendUid);
        copyBtn.className = 'g-btn g-btn-secondary g-btn-full';
        copyBtn.innerHTML = 'In Your Watchlist';
        copyBtn.disabled = true;
      };
    }
    actionsDiv.appendChild(copyBtn);
  } else {
    const actionBtn = document.createElement('button');
    
    function setBtnState(saved) {
      if (isInWatchlist) {
        actionBtn.className = 'g-btn g-btn-remove g-btn-full';
        actionBtn.innerHTML = 'Remove from Watchlist';
        actionBtn.disabled = false;
        actionBtn.onclick = async (e) => {
          e.stopPropagation();
          actionBtn.disabled = true;
          actionBtn.innerHTML = 'Removing...';
          await removeItem(tmdbId);
        };
      } else if (saved) {
        actionBtn.className = 'g-btn g-btn-remove g-btn-full';
        actionBtn.innerHTML = 'Remove from Watchlist';
        actionBtn.disabled = false;
        actionBtn.onclick = async (e) => {
          e.stopPropagation();
          actionBtn.disabled = true;
          actionBtn.innerHTML = 'Removing...';
          await removeItem(tmdbId);
          setBtnState(false);
        };
      } else {
        actionBtn.className = 'g-btn g-btn-add g-btn-full';
        actionBtn.innerHTML = 'Add to Watchlist';
        actionBtn.disabled = false;
        actionBtn.onclick = async (e) => {
          e.stopPropagation();
          actionBtn.disabled = true;
          actionBtn.innerHTML = 'Adding...';
          await addItem(item);
          setBtnState(true);
        };
      }
    }

    setBtnState(alreadySaved);
    actionsDiv.appendChild(actionBtn);
  }

  card.innerHTML = `
    <div class="poster-wrapper">
      ${posterHTML}
      <span class="media-badge ${badgeClass}">${badgeLabel}</span>
      ${ratingHTML}
    </div>
    <div class="card-content">
      <h3 class="card-title">${escapeHtml(title)}</h3>
      <div class="card-meta">${year ? year : 'Release N/A'} • ID: ${tmdbId}</div>
      <p class="card-overview">${escapeHtml(overview)}</p>
      <div class="card-actions-slot"></div>
    </div>
  `;

  card.querySelector('.card-actions-slot').appendChild(actionsDiv);
  return card;
}

/* ==========================================================================
   Full Media Details Page Logic
   ========================================================================== */
let currentDetailsContext = null;

async function openDetailsPage(id, mediaType, localItem = {}) {
  if (!currentUser) {
    showLandingPage();
    loginWithGoogle();
    return;
  }
  openDetailsView();
  const pageContent = document.getElementById('detailsPageContent');
  pageContent.innerHTML = `
    <div class="loading-box">
      <div class="spinner"></div>
      <p>Loading full details, watch sources & cast info...</p>
    </div>
  `;

  let details = localItem || {};
  try {
    const res = await fetch(`/api/details?type=${encodeURIComponent(mediaType)}&id=${encodeURIComponent(id)}`);
    if (res.ok) {
      const data = await res.json();
      if (data && !data.error) details = data;
    }
  } catch (e) {
    console.warn("Failed fetching extra details:", e);
  }

  currentDetailsContext = { id: parseInt(id), mediaType, details };

  try {
    renderDetailsPage(details, id, mediaType);
  } catch (err) {
    console.error("Error rendering details page:", err);
    pageContent.innerHTML = `
      <div class="empty-state" style="padding:2rem;">
        <p style="color:var(--g-red);">Error loading media details. (${escapeHtml(err.message)})</p>
        <button class="g-btn g-btn-secondary" onclick="closeDetailsPage()" style="margin-top:1rem;">Back to Dashboard</button>
      </div>
    `;
  }
}

async function renderDetailsPage(details, id, mediaType) {
  const pageContent = document.getElementById('detailsPageContent');
  const title = details.title || details.name || 'Untitled';
  const tagline = details.tagline || '';
  const overview = details.overview || 'No description available.';
  const posterPath = details.poster_path || '';
  const posterUrl = posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : '';
  const backdropPath = details.backdrop_path || '';
  const backdropUrl = backdropPath ? `https://image.tmdb.org/t/p/w1280${backdropPath}` : posterUrl;
  const rating = details.vote_average ? parseFloat(details.vote_average).toFixed(1) : '';
  const voteCount = details.vote_count ? details.vote_count.toLocaleString() : '';
  const releaseDate = String(details.release_date || details.first_air_date || details.release_year || 'Unknown');
  const genres = details.genres ? details.genres.map(g => g.name) : [];
  const status = details.status || 'N/A';
  const runtime = details.runtime ? `${details.runtime} mins` : (details.number_of_seasons ? `${details.number_of_seasons} Season(s)` : 'N/A');
  const createdBy = (details.created_by && details.created_by.length > 0) ? details.created_by.map(c => c.name).join(', ') : 'N/A';

  // Parse theatrical, digital & physical release dates from TMDB release_dates
  let theatricalDate = '';
  let digitalDate = '';
  let physicalDate = '';
  if (details.release_dates && details.release_dates.results) {
    const usRelease = details.release_dates.results.find(r => r.iso_3166_1 === 'US')
      || details.release_dates.results[0];
    if (usRelease && usRelease.release_dates) {
      // TMDB types: 1=Premiere, 2=Theatrical (limited), 3=Theatrical, 4=Digital, 5=Physical, 6=TV
      const theatrical = usRelease.release_dates.find(d => d.type === 3)
        || usRelease.release_dates.find(d => d.type === 2);
      const digital = usRelease.release_dates.find(d => d.type === 4);
      const physical = usRelease.release_dates.find(d => d.type === 5);
      if (theatrical) theatricalDate = theatrical.release_date.substring(0, 10);
      if (digital) digitalDate = digital.release_date.substring(0, 10);
      if (physical) physicalDate = physical.release_date.substring(0, 10);
    }
  }

  // Build Release Dates Breakdown section (only for movies)
  const releaseDatesHTML = (mediaType === 'movie') ? `
    <div class="details-section-header"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px; vertical-align:text-bottom;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>Release Dates Breakdown</div>
    <div class="schedule-list">
      <div class="schedule-row-item">
        <div class="schedule-row-label">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H9l2 4H8L6 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>
          Cinema / Theatrical Release
        </div>
        <span class="schedule-date-pill">${theatricalDate || 'TBA (Not on TMDb)'}</span>
      </div>
      <div class="schedule-row-item">
        <div class="schedule-row-label">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/></svg>
          Digital / Streaming Release
        </div>
        <span class="schedule-date-pill">${digitalDate || 'TBA (Not on TMDb)'}</span>
      </div>
      <div class="schedule-row-item">
        <div class="schedule-row-label">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"/></svg>
          Physical Disc Release
        </div>
        <span class="schedule-date-pill">${physicalDate || 'TBA (Not on TMDb)'}</span>
      </div>
    </div>
  ` : '';

  const hydraWatchUrl = `https://hydrahd.ws/index.php?menu=search&query=${encodeURIComponent(title)}`;
  const isSaved = watchlist.some(i => parseInt(i.tmdb_id) === parseInt(id));

  const nextEp = details.next_episode_to_air;
  const lastEp = details.last_episode_to_air;

  // Upcoming Release Notification Box
  const notificationHTML = nextEp ? `
    <div class="upcoming-release-box">
      <div class="upcoming-release-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>
        UPCOMING RELEASE NOTIFICATION
      </div>
      <div class="upcoming-release-text">
        Season ${nextEp.season_number} Episode ${nextEp.episode_number} ("${escapeHtml(nextEp.name || '')}") is scheduled to air on <strong>${nextEp.air_date}</strong>.
      </div>
    </div>
  ` : '';

  // Season & Release Schedule Rows
  let scheduleRowsHTML = '';
  if (nextEp) {
    scheduleRowsHTML += `
      <div class="schedule-row-item">
        <div class="schedule-row-label">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/></svg>
          Next Episode (Season ${nextEp.season_number} Ep ${nextEp.episode_number})
        </div>
        <span class="schedule-date-pill">${nextEp.air_date}</span>
      </div>
    `;
  }
  if (lastEp) {
    scheduleRowsHTML += `
      <div class="schedule-row-item">
        <div class="schedule-row-label">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10z"/></svg>
          Latest Aired (Season ${lastEp.season_number} Ep ${lastEp.episode_number})
        </div>
        <span class="schedule-date-pill">${lastEp.air_date}</span>
      </div>
    `;
  }
  if (details.seasons && details.seasons.length > 0) {
    details.seasons.forEach(s => {
      scheduleRowsHTML += `
        <div class="schedule-row-item">
          <div class="schedule-row-label">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
            ${escapeHtml(s.name)} (${s.episode_count || 0} episodes)
          </div>
          <span class="schedule-date-pill">${s.air_date || 'TBA'}</span>
        </div>
      `;
    });
  }

  // Featured Cast Avatars (Screenshots 1, 2, 3)
  const castList = (details.credits && details.credits.cast) ? details.credits.cast.slice(0, 10) : [];
  const castHTML = castList.length > 0 ? `
    <div class="details-section-header"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px; vertical-align:text-bottom;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>Featured Cast</div>
    <div class="cast-avatar-row">
      ${castList.map(c => `
        <div class="cast-avatar-card">
          <img src="${c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : `https://api.dicebear.com/7.x/avataaars/svg?seed=${c.name}`}" class="cast-avatar-img" alt="${escapeHtml(c.name)}">
          <div class="cast-avatar-name">${escapeHtml(c.name)}</div>
          <div class="cast-avatar-role">${escapeHtml(c.character || '')}</div>
        </div>
      `).join('')}
    </div>
  ` : '';

  const detailsActionBtn = document.createElement('button');
  if (isSaved) {
    detailsActionBtn.className = 'g-btn g-btn-remove';
    detailsActionBtn.innerHTML = 'Remove from Watchlist';
    detailsActionBtn.onclick = async () => {
      detailsActionBtn.disabled = true;
      await removeItem(id);
      openDetailsPage(id, mediaType, details);
    };
  } else {
    detailsActionBtn.className = 'g-btn g-btn-add';
    detailsActionBtn.innerHTML = 'Add to Watchlist';
    detailsActionBtn.onclick = async () => {
      detailsActionBtn.disabled = true;
      await addItem({ tmdb_id: parseInt(id), type: mediaType, title, poster_path: posterPath, vote_average: parseFloat(rating), release_year: releaseDate.substring(0,4), overview });
      openDetailsPage(id, mediaType, details);
    };
  }

  const escapedTitle = title.replace(/'/g, "\\'");

  // Check if active watch reminder exists for this media
  const existingReminder = (userReminders || []).find(r => parseInt(r.tmdb_id) === parseInt(id));
  let formattedReminderTime = '';
  if (existingReminder) {
    try {
      const d = new Date(existingReminder.remind_at);
      if (!isNaN(d.getTime())) {
        formattedReminderTime = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ' at ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      } else {
        formattedReminderTime = existingReminder.remind_at;
      }
    } catch (e) {
      formattedReminderTime = existingReminder.remind_at;
    }
  }

  const reminderCardHTML = existingReminder ? `
    <div class="details-reminder-card">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:0.75rem; flex-wrap:wrap;">
        <div style="display:flex; align-items:center; gap:0.75rem; min-width:220px;">
          <div class="details-reminder-icon">⏰</div>
          <div>
            <div style="font-weight:700; font-size:0.95rem; color:var(--g-text);">
              Scheduled Watch Time: <span style="color:var(--g-blue);">${escapeHtml(formattedReminderTime)}</span>
            </div>
            ${existingReminder.note ? `<div style="font-size:0.85rem; color:var(--g-subtext); margin-top:0.2rem; font-style:italic;">"${escapeHtml(existingReminder.note)}"</div>` : '<div style="font-size:0.8rem; color:var(--g-subtext); margin-top:0.2rem;">Push notification alert will be sent automatically.</div>'}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
          <button class="activity-pill-btn" onclick="openGoogleCalendarReminderDirect('${escapedTitle}', ${id}, '${existingReminder.remind_at}', '${escapeHtml((existingReminder.note || '').replace(/'/g, "\\'"))}')" title="Sync / Add event to Google Calendar">
            📅 Google Calendar
          </button>
          <button class="activity-pill-btn" onclick="openReminderModal(${id}, '${escapedTitle}', '${mediaType}', '${posterPath}', ${existingReminder.id}, '${existingReminder.remind_at}', '${escapeHtml((existingReminder.note || '').replace(/'/g, "\\'"))}')" title="Edit reminder time">
            ✏️ Edit
          </button>
          <button class="activity-icon-btn" onclick="deleteUserReminder(${existingReminder.id}, ${id}, '${mediaType}')" title="Delete Reminder">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    </div>
  ` : '';

  pageContent.innerHTML = `
    <!-- Main Card Container Frame (Screenshots 1, 2, 3) -->
    <div class="details-main-card">
      
      <!-- Top Card Header & Backdrop -->
      <div class="details-card-header">
        <div class="details-card-backdrop" style="${backdropUrl ? `background-image: url('${backdropUrl}');` : ''}"></div>
        <div class="details-card-hero-info">
          ${posterUrl ? `<img src="${posterUrl}" alt="${escapeHtml(title)}" class="details-card-poster">` : ''}
          <div class="details-card-meta">
            <h2 style="font-size:2.2rem; font-weight:700; color:var(--g-text); margin-bottom:0.2rem;">${escapeHtml(title)}</h2>
            ${tagline ? `<p style="font-style:italic; color:var(--g-subtext); margin-bottom:0.75rem;">"${escapeHtml(tagline)}"</p>` : ''}
            <div style="display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap;">
              <span class="media-badge ${mediaType === 'tv' ? 'badge-tv' : 'badge-movie'}" style="position:static;">${mediaType === 'tv' ? 'TV SHOW' : 'MOVIE'}</span>
              ${rating ? `<span style="background:#fbbc04; color:#000; font-weight:700; padding:0.2rem 0.55rem; border-radius:12px; font-size:0.85rem; display:inline-flex; align-items:center; gap:3px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>${rating}</span> ${voteCount ? `<span style="color:var(--g-subtext); font-size:0.8rem;">(${voteCount} votes)</span>` : ''}` : ''}
              ${genres.map(g => `<span class="genre-chip">${escapeHtml(g)}</span>`).join('')}
            </div>
          </div>
        </div>
      </div>

      <!-- Card Inner Body -->
      <div class="details-card-body">
        
        <!-- Upcoming Release Notification -->
        ${notificationHTML}

        <!-- Overview Synopsis -->
        <p style="font-size:1rem; line-height:1.65; color:var(--g-text); margin-bottom:1.75rem;">${escapeHtml(overview)}</p>

        <!-- Release Dates Breakdown (Movies only) -->
        ${releaseDatesHTML}

        <!-- Season & Release Schedule -->
        ${scheduleRowsHTML ? `
          <div class="details-section-header"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px; vertical-align:text-bottom;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>Season & Release Schedule</div>
          <div class="schedule-list">
            ${scheduleRowsHTML}
          </div>
        ` : ''}

        <!-- Featured Cast Gallery -->
        ${castHTML}

        <!-- Overview Details Box -->
        <div class="details-section-header"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px; vertical-align:text-bottom;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>Overview Details</div>
        <div class="overview-details-box">
          <div class="overview-details-grid">
            <div class="overview-cell">
              <label>RELEASE / FIRST AIR</label>
              <div>${escapeHtml(releaseDate)}</div>
            </div>
            <div class="overview-cell">
              <label>RUNTIME / FORMAT</label>
              <div>${escapeHtml(runtime)}</div>
            </div>
            <div class="overview-cell">
              <label>STATUS</label>
              <div>${escapeHtml(status)}</div>
            </div>
            <div class="overview-cell">
              <label>CREATED BY</label>
              <div>${escapeHtml(createdBy)}</div>
            </div>
          </div>
          <div class="overview-cell overview-subrow">
            <label>TMDB ID</label>
            <div>${id}</div>
          </div>
        </div>

        <!-- Scheduled Watch Reminder Banner (Placed right here above the Action Row) -->
        ${reminderCardHTML}

        <!-- Action Row Buttons -->
        <div class="details-action-row" style="margin:1.5rem 0 1.5rem 0;">
          <span id="detailsSaveBtnSlot"></span>
          <a href="${hydraWatchUrl}" target="_blank" rel="noopener" class="g-btn g-btn-hydra" style="text-decoration:none;">
            Watch Free on HydraHD
          </a>
          <button class="g-btn g-btn-secondary" onclick="openReminderModal(${id}, '${escapedTitle}', '${mediaType}', '${posterPath}', ${existingReminder ? existingReminder.id : 'null'}, '${existingReminder ? existingReminder.remind_at : ''}', '${existingReminder ? escapeHtml((existingReminder.note || '').replace(/'/g, "\\'")) : ''}')">
            ⏰ ${existingReminder ? 'Reschedule' : 'Remind Me'}
          </button>
          <button class="g-btn g-btn-secondary" onclick="openRatingModal(${id}, '${escapedTitle}')">Rate & Review</button>
          <button class="g-btn g-btn-secondary" onclick="openCommentModal(${id}, '${escapedTitle}')">Add Comment</button>
        </div>

        <!-- Added Reviews & Comments Feed -->
        <div class="comments-section" style="margin-top:2rem;">
          <div class="details-section-header" style="margin-bottom:1rem;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px; vertical-align:text-bottom;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Community Reviews & Comments
          </div>
          <div id="commentsFeed" class="comments-feed"></div>
        </div>

      </div>
    </div>
  `;

  document.getElementById('detailsSaveBtnSlot').appendChild(detailsActionBtn);
  loadCommentsAndRatings(id);
}

/* ==========================================================================
   Rating & Review Modal Logic
   ========================================================================== */
let currentRatingTmdbId = null;
let currentCommentTmdbId = null;
let currentReplyParentId = null;
let currentMediaTitle = '';
let selectedScore = 5;

const SCORE_LABELS = {
  1: '1 / 5 — Terrible',
  2: '2 / 5 — Poor',
  3: '3 / 5 — Average',
  4: '4 / 5 — Great',
  5: '5 / 5 — Masterpiece'
};

function previewRatingScore(score) {
  const stars = document.querySelectorAll('#modalStarInput span');
  stars.forEach((star, index) => {
    if (index < score) star.classList.add('active');
    else star.classList.remove('active');
  });
  const label = document.getElementById('modalRatingScoreLabel');
  if (label) label.innerText = SCORE_LABELS[score] || `${score} / 5`;
}

function resetRatingPreview() {
  setRatingScore(selectedScore);
}

function setRatingScore(score) {
  selectedScore = score;
  const stars = document.querySelectorAll('#modalStarInput span');
  stars.forEach((star, index) => {
    if (index < score) star.classList.add('active');
    else star.classList.remove('active');
  });
  const label = document.getElementById('modalRatingScoreLabel');
  if (label) label.innerText = SCORE_LABELS[score] || `${score} / 5`;
}

function openRatingModal(id, title) {
  if (!requireAuth("Please sign in with Google to rate titles.")) return;
  currentRatingTmdbId = id;
  currentMediaTitle = title;
  const modal = document.getElementById('ratingModal');
  const titleEl = document.getElementById('ratingModalTitle');
  if (titleEl) titleEl.innerText = `Rate & Review "${title}"`;
  if (modal) modal.style.display = 'flex';
  setRatingScore(5);
  const reviewEl = document.getElementById('modalReviewText');
  if (reviewEl) reviewEl.value = '';
}

function closeRatingModal() {
  const modal = document.getElementById('ratingModal');
  if (modal) modal.style.display = 'none';
}

async function saveRatingFromModal() {
  if (!currentRatingTmdbId) return;
  if (!requireAuth("Please sign in with Google to rate movies.")) return;
  const reviewText = document.getElementById('modalReviewText').value.trim();

  try {
    const res = await fetch('/api/ratings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUser.uid,
        tmdb_id: currentRatingTmdbId,
        score: selectedScore,
        review: reviewText
      })
    });
    if (res.ok) {
      closeRatingModal();
      loadCommentsAndRatings(currentRatingTmdbId);
      loadUserActivity();
    } else {
      const data = await res.json();
      alert('Failed to submit rating: ' + (data.error || 'Server error'));
    }
  } catch (e) {
    alert('Failed to submit rating: ' + e.message);
  }
}

/* ==========================================================================
   Comment & Threaded Reply Logic
   ========================================================================== */
function openCommentModal(id, title, parentId = null, replyingToUser = null) {
  if (!requireAuth("Please sign in with Google to post comments.")) return;
  currentCommentTmdbId = id;
  currentReplyParentId = parentId;
  currentMediaTitle = title;
  const modal = document.getElementById('commentModal');
  const titleEl = document.getElementById('commentModalTitle');
  if (titleEl) {
    titleEl.innerText = replyingToUser 
      ? `Reply to @${replyingToUser}`
      : `Post a Comment on "${title}"`;
  }
  if (modal) modal.style.display = 'flex';
  const commentEl = document.getElementById('modalCommentText');
  if (commentEl) {
    commentEl.value = '';
    commentEl.placeholder = replyingToUser 
      ? `Write a reply to @${replyingToUser}...` 
      : `Write a comment or start a discussion...`;
    commentEl.focus();
  }
}

function closeCommentModal() {
  const modal = document.getElementById('commentModal');
  if (modal) modal.style.display = 'none';
  currentReplyParentId = null;
}

async function saveCommentFromModal() {
  if (!currentCommentTmdbId) return;
  if (!requireAuth("Please sign in with Google to post comments.")) return;
  const content = document.getElementById('modalCommentText').value.trim();
  if (!content) return alert('Please enter a comment.');

  try {
    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUser.uid,
        tmdb_id: currentCommentTmdbId,
        content: content,
        parent_id: currentReplyParentId,
        media_title: currentMediaTitle
      })
    });
    if (res.ok) {
      closeCommentModal();
      loadCommentsAndRatings(currentCommentTmdbId);
      loadUserActivity();
    } else {
      const data = await res.json();
      alert('Failed to post comment: ' + (data.error || 'Server error'));
    }
  } catch (e) {
    alert('Failed to post comment: ' + e.message);
  }
}

/* ==========================================================================
   Custom Watch Reminder Modal Logic
   ========================================================================== */
let currentReminderTmdbId = null;
let currentReminderMediaTitle = '';
let currentReminderMediaType = 'movie';
let currentReminderPosterPath = '';
let editingReminderId = null;

function openReminderModal(id, title, mediaType = 'movie', posterPath = '', existingReminderId = null, existingRemindAt = '', existingNote = '') {
  if (!requireAuth("Please sign in with Google to set watch reminders.")) return;
  currentReminderTmdbId = id;
  currentReminderMediaTitle = title;
  currentReminderMediaType = mediaType;
  currentReminderPosterPath = posterPath;
  editingReminderId = existingReminderId;

  const modal = document.getElementById('reminderModal');
  const titleEl = document.getElementById('reminderModalTitle');
  if (titleEl) {
    titleEl.innerText = existingReminderId ? `Edit Watch Reminder for "${title}"` : `Set Watch Reminder for "${title}"`;
  }
  
  const dtInput = document.getElementById('reminderDatetimeInput');
  const noteEl = document.getElementById('reminderNoteInput');

  if (existingRemindAt && dtInput) {
    dtInput.value = existingRemindAt;
  } else {
    setReminderPreset('tonight');
  }

  if (noteEl) {
    noteEl.value = existingNote || '';
  }

  if (modal) modal.style.display = 'flex';
}

function closeReminderModal() {
  const modal = document.getElementById('reminderModal');
  if (modal) modal.style.display = 'none';
  editingReminderId = null;
}

function setReminderPreset(preset) {
  const dtInput = document.getElementById('reminderDatetimeInput');
  if (!dtInput) return;

  const now = new Date();
  let target = new Date();

  if (preset === 'tonight') {
    target.setHours(20, 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
  } else if (preset === 'tomorrow') {
    target.setDate(target.getDate() + 1);
    target.setHours(20, 0, 0, 0);
  } else if (preset === 'friday') {
    const day = target.getDay(); // 0 is Sun, 5 is Fri
    let daysUntilFriday = (5 - day + 7) % 7;
    if (daysUntilFriday === 0 && target.getHours() >= 20) daysUntilFriday = 7;
    target.setDate(target.getDate() + daysUntilFriday);
    target.setHours(20, 0, 0, 0);
  } else if (preset === 'saturday') {
    const day = target.getDay(); // 6 is Sat
    let daysUntilSat = (6 - day + 7) % 7;
    if (daysUntilSat === 0 && target.getHours() >= 20) daysUntilSat = 7;
    target.setDate(target.getDate() + daysUntilSat);
    target.setHours(20, 0, 0, 0);
  }

  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = target.getFullYear();
  const mm = pad(target.getMonth() + 1);
  const dd = pad(target.getDate());
  const hh = pad(target.getHours());
  const min = pad(target.getMinutes());
  dtInput.value = `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function openGoogleCalendarReminderDirect(title, tmdbId, remindAt, note) {
  if (!remindAt) return alert('No reminder date/time found.');
  const startDate = new Date(remindAt);
  if (isNaN(startDate.getTime())) return alert('Invalid date/time.');
  
  const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
  const formatGCal = (d) => d.toISOString().replace(/-|:|\.\d\d\d/g, "");
  const dates = `${formatGCal(startDate)}/${formatGCal(endDate)}`;
  const calTitle = `Watch: ${title}`;
  const details = `${note || ''}\n\nStream on VESPER: https://hydrahd.com/watch/${tmdbId}`;

  const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(calTitle)}&dates=${dates}&details=${encodeURIComponent(details)}`;
  window.open(gcalUrl, '_blank', 'noopener');
}

function openGoogleCalendarReminder() {
  const dtInput = document.getElementById('reminderDatetimeInput');
  const noteInput = document.getElementById('reminderNoteInput');
  if (!dtInput || !dtInput.value) return alert('Please select a date and time first.');

  const startDate = new Date(dtInput.value);
  if (isNaN(startDate.getTime())) return alert('Invalid date/time.');
  
  const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

  const formatGCal = (d) => d.toISOString().replace(/-|:|\.\d\d\d/g, "");
  const dates = `${formatGCal(startDate)}/${formatGCal(endDate)}`;
  const title = `Watch: ${currentReminderMediaTitle}`;
  const details = `${noteInput ? noteInput.value : ''}\n\nStream on VESPER: https://hydrahd.com/watch/${currentReminderTmdbId}`;

  const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${dates}&details=${encodeURIComponent(details)}`;
  window.open(gcalUrl, '_blank', 'noopener');
}

async function saveReminderFromModal() {
  if (!currentUser) return;
  if (!currentReminderTmdbId) return;

  const dtInput = document.getElementById('reminderDatetimeInput');
  const noteInput = document.getElementById('reminderNoteInput');
  const remindAt = dtInput ? dtInput.value : '';
  const note = noteInput ? noteInput.value.trim() : '';

  if (!remindAt) return alert('Please select a date and time for your reminder.');

  try {
    // If we're updating an existing reminder, delete the prior one first
    if (editingReminderId) {
      await fetch('/api/reminders/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reminder_id: editingReminderId, user_id: currentUser.uid })
      });
    }

    const res = await fetch('/api/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUser.uid,
        tmdb_id: currentReminderTmdbId,
        media_title: currentReminderMediaTitle,
        media_type: currentReminderMediaType,
        poster_path: currentReminderPosterPath,
        remind_at: remindAt,
        note: note
      })
    });

    if (res.ok) {
      closeReminderModal();
      alert(`⏰ Watch reminder ${editingReminderId ? 'updated' : 'set'} for "${currentReminderMediaTitle}"! You will receive an instant push notification at the scheduled time.`);
      await loadUserReminders();
      if (currentWatchlistView === 'reminders') renderUserReminders();
      if (currentDetailsContext && currentDetailsContext.id === currentReminderTmdbId) {
        openDetailsPage(currentDetailsContext.id, currentDetailsContext.mediaType, currentDetailsContext.details);
      }
    } else {
      const data = await res.json().catch(() => ({}));
      alert('Failed to set reminder: ' + (data.error || 'Server error'));
    }
  } catch (e) {
    alert('Error setting reminder: ' + e.message);
  }
}

async function deleteUserReminder(reminderId, reloadDetailsTmdbId = null, mediaType = 'movie') {
  if (!currentUser) return;
  if (!confirm("Are you sure you want to delete this reminder?")) return;

  try {
    const res = await fetch('/api/reminders/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reminder_id: reminderId, user_id: currentUser.uid })
    });
    if (res.ok) {
      await loadUserReminders();
      if (currentWatchlistView === 'reminders') renderUserReminders();
      if (reloadDetailsTmdbId && currentDetailsContext && currentDetailsContext.id === reloadDetailsTmdbId) {
        openDetailsPage(reloadDetailsTmdbId, mediaType, currentDetailsContext.details);
      }
    } else {
      const data = await res.json().catch(() => ({}));
      alert('Failed to delete reminder: ' + (data.error || 'Server error'));
    }
  } catch (e) {
    alert('Error deleting reminder: ' + e.message);
  }
}

function toggleInlineReplyBox(commentId, userName) {
  if (!requireAuth("Please sign in with Google to reply.")) return;
  const box = document.getElementById(`reply-box-${commentId}`);
  if (!box) return;
  if (box.style.display === 'none' || !box.style.display) {
    box.style.display = 'block';
    const input = box.querySelector('textarea');
    if (input) input.focus();
  } else {
    box.style.display = 'none';
  }
}

async function submitInlineReply(parentId, tmdbId, targetUserId) {
  if (!requireAuth("Please sign in with Google to reply.")) return;
  const box = document.getElementById(`reply-box-${parentId}`);
  const input = box ? box.querySelector('textarea') : null;
  const content = input ? input.value.trim() : '';
  if (!content) return alert('Please enter a reply.');

  try {
    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUser.uid,
        tmdb_id: tmdbId,
        content: content,
        parent_id: parentId,
        target_user_id: targetUserId,
        media_title: currentMediaTitle || 'Media'
      })
    });
    if (res.ok) {
      if (input) input.value = '';
      if (box) box.style.display = 'none';
      loadCommentsAndRatings(tmdbId);
      loadUserActivity();
    } else {
      const data = await res.json();
      alert('Failed to post reply: ' + (data.error || 'Server error'));
    }
  } catch (e) {
    alert('Failed to post reply: ' + e.message);
  }
}

function renderStarRating(score) {
  const num = Math.min(5, Math.max(0, Math.round(score || 0)));
  let stars = '';
  for (let i = 1; i <= 5; i++) {
    const isFilled = i <= num;
    stars += `<svg width="14" height="14" viewBox="0 0 24 24" fill="${isFilled ? '#f59e0b' : 'var(--g-border)'}" style="vertical-align:middle; margin-right:1px;"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`;
  }
  return stars;
}

async function loadCommentsAndRatings(tmdbId) {
  const feed = document.getElementById('commentsFeed');
  if (!feed) return;

  try {
    const [ratingsRes, commentsRes] = await Promise.all([
      fetch(`/api/ratings?tmdb_id=${tmdbId}`).then(r => r.json()).catch(() => []),
      fetch(`/api/comments?tmdb_id=${tmdbId}`).then(r => r.json()).catch(() => [])
    ]);

    const ratings = Array.isArray(ratingsRes) ? ratingsRes : [];
    const comments = Array.isArray(commentsRes) ? commentsRes : [];

    let avgScore = 0;
    if (ratings.length > 0) {
      const sum = ratings.reduce((acc, r) => acc + (parseFloat(r.score) || 0), 0);
      avgScore = (sum / ratings.length).toFixed(1);
    }

    let ratingSummaryHTML = '';
    if (ratings.length > 0) {
      ratingSummaryHTML = `
        <div class="community-rating-card">
          <div class="community-rating-score">
            <span class="score-number">${avgScore}</span>
            <div class="score-stars">
              <div>${renderStarRating(Math.round(avgScore))}</div>
              <span class="score-count">${ratings.length} community review${ratings.length > 1 ? 's' : ''}</span>
            </div>
          </div>
          <button class="g-btn g-btn-secondary" style="font-size:0.8rem; padding:0.35rem 0.85rem;" onclick="openRatingModal(${tmdbId}, currentMediaTitle || 'Media')">
            ★ Rate / Edit Your Review
          </button>
        </div>
      `;
    }

    let reviewsHTML = '';
    if (ratings.length > 0) {
      reviewsHTML = `
        <div class="feed-subheading">Community Reviews (${ratings.length})</div>
        <div class="reviews-list" style="display:flex; flex-direction:column; gap:0.75rem; margin-bottom:1.5rem;">
          ${ratings.map(r => {
            const isMyReview = currentUser && (r.user_id === currentUser.uid);
            return `
              <div class="review-card">
                <div class="review-header">
                  <div class="review-user">
                    <img src="${r.user_photo || `https://api.dicebear.com/7.x/avataaars/svg?seed=${r.user_id}`}" class="user-avatar-img" style="width:28px; height:28px;">
                    <span class="review-author">${escapeHtml(r.user_name)}</span>
                  </div>
                  <div style="display:flex; align-items:center; gap:0.6rem;">
                    <div class="review-score-stars">
                      ${renderStarRating(r.score)}
                      <span class="review-score-val">${r.score}/5</span>
                    </div>
                    ${isMyReview ? `
                      <button class="item-delete-btn" onclick="deleteUserRating(${r.id}, ${tmdbId})" title="Delete your review">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        Delete
                      </button>
                    ` : ''}
                  </div>
                </div>
                ${r.review ? `<p class="review-content">${escapeHtml(r.review)}</p>` : ''}
                <div class="review-date">${r.updated_at ? r.updated_at.substring(0, 10) : ''}</div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    const topLevelComments = comments.filter(c => !c.parent_id);
    const replyMap = {};
    comments.filter(c => c.parent_id).forEach(reply => {
      if (!replyMap[reply.parent_id]) replyMap[reply.parent_id] = [];
      replyMap[reply.parent_id].push(reply);
    });

    let commentsHTML = '';
    if (topLevelComments.length === 0 && ratings.length === 0) {
      feed.innerHTML = `
        <div class="empty-state" style="padding:2rem 1rem;">
          <p>No reviews or comments yet. Be the first to start the conversation!</p>
        </div>
      `;
      return;
    }

    if (topLevelComments.length > 0) {
      commentsHTML = `
        <div class="feed-subheading">Discussions & Comments (${comments.length})</div>
        <div class="comments-thread-list" style="display:flex; flex-direction:column; gap:1rem;">
          ${topLevelComments.map(c => {
            const replies = replyMap[c.id] || [];
            const isMyComment = currentUser && (c.user_id === currentUser.uid);
            return `
              <div class="comment-card-container">
                <div class="comment-card">
                  <div class="comment-header">
                    <div class="comment-user">
                      <img src="${c.user_photo || `https://api.dicebear.com/7.x/avataaars/svg?seed=${c.user_id}`}" class="user-avatar-img" style="width:28px; height:28px;">
                      <span class="comment-author">${escapeHtml(c.user_name)}</span>
                    </div>
                    <span class="comment-date">${c.created_at ? c.created_at.substring(0, 16) : ''}</span>
                  </div>
                  <p class="comment-body">${escapeHtml(c.content)}</p>
                  <div class="comment-actions">
                    <button class="comment-reply-btn" onclick="toggleInlineReplyBox(${c.id}, '${escapeHtml(c.user_name)}')">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                      Reply ${replies.length > 0 ? `(${replies.length})` : ''}
                    </button>
                    ${isMyComment ? `
                      <button class="comment-delete-btn" onclick="deleteUserComment(${c.id}, ${tmdbId})" title="Delete comment">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        Delete
                      </button>
                    ` : ''}
                  </div>
                  
                  <div class="inline-reply-box" id="reply-box-${c.id}" style="display:none; margin-top:0.75rem;">
                    <textarea class="inline-reply-textarea" placeholder="Write a reply to @${escapeHtml(c.user_name)}..."></textarea>
                    <div style="display:flex; gap:0.4rem; justify-content:flex-end; margin-top:0.4rem;">
                      <button class="g-btn g-btn-secondary" style="font-size:0.75rem; padding:0.25rem 0.65rem; min-height:28px;" onclick="toggleInlineReplyBox(${c.id})">Cancel</button>
                      <button class="g-btn" style="font-size:0.75rem; padding:0.25rem 0.75rem; min-height:28px;" onclick="submitInlineReply(${c.id}, ${tmdbId}, '${c.user_id}')">Post Reply</button>
                    </div>
                  </div>
                </div>

                ${replies.length > 0 ? `
                  <div class="replies-thread">
                    ${replies.map(r => {
                      const isMyReply = currentUser && (r.user_id === currentUser.uid);
                      return `
                        <div class="reply-card">
                          <div class="comment-header">
                            <div class="comment-user">
                              <img src="${r.user_photo || `https://api.dicebear.com/7.x/avataaars/svg?seed=${r.user_id}`}" class="user-avatar-img" style="width:24px; height:24px;">
                              <span class="comment-author">${escapeHtml(r.user_name)}</span>
                              <span class="replying-to-tag">replied to @${escapeHtml(c.user_name)}</span>
                            </div>
                            <span class="comment-date">${r.created_at ? r.created_at.substring(0, 16) : ''}</span>
                          </div>
                          <p class="comment-body">${escapeHtml(r.content)}</p>
                          ${isMyReply ? `
                            <div class="comment-actions" style="margin-top:0.35rem;">
                              <button class="comment-delete-btn" onclick="deleteUserComment(${r.id}, ${tmdbId})" title="Delete reply">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                Delete
                              </button>
                            </div>
                          ` : ''}
                        </div>
                      `;
                    }).join('')}
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    feed.innerHTML = ratingSummaryHTML + reviewsHTML + commentsHTML;
  } catch (e) {
    console.error("Error loading comments and ratings:", e);
  }
}

async function deleteUserRating(ratingId, tmdbId) {
  if (!currentUser) return;
  if (!confirm("Are you sure you want to delete your review and rating?")) return;

  try {
    const res = await fetch('/api/ratings/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating_id: ratingId, user_id: currentUser.uid })
    });
    if (res.ok) {
      loadCommentsAndRatings(tmdbId);
      await loadUserActivity();
      if (currentWatchlistView === 'rated') renderUserRatings();
    } else {
      const data = await res.json();
      alert('Failed to delete rating: ' + (data.error || 'Server error'));
    }
  } catch (e) {
    alert('Error deleting rating: ' + e.message);
  }
}

async function deleteUserComment(commentId, tmdbId) {
  if (!currentUser) return;
  if (!confirm("Are you sure you want to delete this comment?")) return;

  try {
    const res = await fetch('/api/comments/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment_id: commentId, user_id: currentUser.uid })
    });
    if (res.ok) {
      loadCommentsAndRatings(tmdbId);
      await loadUserActivity();
      if (currentWatchlistView === 'commented') renderUserComments();
    } else {
      const data = await res.json();
      alert('Failed to delete comment: ' + (data.error || 'Server error'));
    }
  } catch (e) {
    alert('Error deleting comment: ' + e.message);
  }
}

/* ==========================================================================
   Social & Friends Logic
   ========================================================================== */
let userConnections = [];

async function loadSocialData() {
  await loadFriendsList();
  await searchPublicUsers();
}

async function searchPublicUsers() {
  const queryInput = document.getElementById('userSearchInput');
  const query = queryInput ? queryInput.value.trim() : '';
  const currentUid = currentUser ? currentUser.uid : '';

  const resultsDiv = document.getElementById('userSearchResults');
  resultsDiv.innerHTML = `<p style="color:var(--g-subtext); font-size:0.85rem;">Searching public profiles...</p>`;

  try {
    const res = await fetch(`/api/users/search?current_uid=${encodeURIComponent(currentUid)}&query=${encodeURIComponent(query)}`);
    const users = await res.json();

    // Filter out users who are already connected friends so they only appear once under Connected Friends
    const availableUsers = users.filter(u => !userConnections.some(c => c.uid === u.uid));

    if (availableUsers.length === 0) {
      resultsDiv.innerHTML = `<p style="color:var(--g-subtext); font-size:0.85rem;">No other public users found.</p>`;
      return;
    }

    resultsDiv.innerHTML = availableUsers.map(u => {
      return `
        <div class="user-card">
          <div class="user-card-info">
            <img src="${u.photo_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.uid}`}" class="user-avatar-img">
            <span class="user-card-name" title="${escapeHtml(u.display_name)}">${escapeHtml(u.display_name)}</span>
          </div>
          <div class="user-card-actions">
            <button class="g-btn g-btn-secondary" onclick="viewFriendWishlist('${u.uid}', '${escapeHtml(u.display_name)}')">View Watchlist</button>
            <button class="g-btn" onclick="connectUser('${u.uid}')">Connect</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error(e);
  }
}

async function loadFriendsList() {
  if (!currentUser) return;
  const listDiv = document.getElementById('friendsList');
  const badge = document.getElementById('friendsCountBadge');
  try {
    const res = await fetch(`/api/connections?user_id=${encodeURIComponent(currentUser.uid)}`);
    userConnections = await res.json();

    if (badge) badge.innerText = userConnections.length;

    if (userConnections.length === 0) {
      listDiv.innerHTML = `<p style="color:var(--g-subtext); font-size:0.85rem;">No connections yet. Search users above to connect!</p>`;
      return;
    }

    listDiv.innerHTML = userConnections.map(f => `
      <div class="user-card">
        <div class="user-card-info">
          <img src="${f.photo_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${f.uid}`}" class="user-avatar-img">
          <span class="user-card-name" title="${escapeHtml(f.display_name)}">${escapeHtml(f.display_name)}</span>
        </div>
        <div class="user-card-actions">
          <button class="g-btn g-btn-secondary" onclick="viewFriendWishlist('${f.uid}', '${escapeHtml(f.display_name)}')">View Watchlist</button>
          <button class="g-btn g-btn-danger" onclick="disconnectUser('${f.uid}')">Disconnect</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    console.error(e);
  }
}

function toggleSidebarAccordion(accordionId) {
  const el = document.getElementById(accordionId);
  if (el) {
    el.classList.toggle('active');
  }
}

async function connectUser(receiverUid) {
  if (!requireAuth("Please sign in with Google to connect with users.")) return;
  try {
    const res = await fetch('/api/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requester_id: currentUser.uid, receiver_id: receiverUid, action: 'request' })
    });
    if (res.ok) {
      await loadSocialData();
    }
  } catch (e) {
    alert('Failed to connect: ' + e.message);
  }
}

async function disconnectUser(targetUid) {
  if (!requireAuth("Please sign in with Google to manage connections.")) return;
  try {
    const res = await fetch('/api/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requester_id: currentUser.uid, receiver_id: targetUid, action: 'remove' })
    });
    if (res.ok) {
      await loadSocialData();
    }
  } catch (e) {
    alert('Failed to disconnect: ' + e.message);
  }
}

async function viewFriendWishlist(uid, name) {
  currentSelectedFriend = uid;
  const titleEl = document.getElementById('friendWatchlistTitle');
  const gridEl = document.getElementById('friendWatchlistGrid');

  if (titleEl) titleEl.innerText = `${name}'s Watchlist`;
  if (gridEl) gridEl.innerHTML = `<div class="loading-box"><div class="spinner"></div><p>Loading watchlist...</p></div>`;

  try {
    const res = await fetch(`/api/watchlist?user_id=${encodeURIComponent(uid)}`);
    const items = await res.json();

    if (items.length === 0) {
      gridEl.innerHTML = `<div class="empty-state"><p>${name}'s watchlist is currently empty.</p></div>`;
      return;
    }

    gridEl.innerHTML = '';
    items.forEach(item => {
      const card = createMediaCard(item, false, true, uid);
      gridEl.appendChild(card);
    });
  } catch (e) {
    gridEl.innerHTML = `<div class="empty-state"><p style="color:var(--g-red);">Could not fetch user's watchlist.</p></div>`;
  }
}

/* ==========================================================================
   Recommendations Logic
   ========================================================================== */
async function loadRecommendations() {
  const container = document.getElementById('recsResults');
  if (!container) return;

  if (watchlist.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>Add items to your watchlist to receive movie & TV recommendations!</p></div>`;
    return;
  }

  container.innerHTML = `<div class="loading-box"><div class="spinner"></div><p>Generating personalized recommendations...</p></div>`;

  // Fetch recommendations for the most recent item in user's watchlist
  const seedItem = watchlist[0];
  try {
    const res = await fetch(`/api/recommendations?type=${seedItem.type || 'movie'}&id=${seedItem.tmdb_id}`);
    const data = await res.json();

    if (!res.ok || !data.results || data.results.length === 0) {
      container.innerHTML = `<div class="empty-state"><p>No recommendations found for ${seedItem.title}.</p></div>`;
      return;
    }

    container.innerHTML = '';
    data.results.slice(0, 12).forEach(item => {
      const card = createMediaCard(item, false);
      container.appendChild(card);
    });
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p style="color:var(--g-red);">Error fetching recommendations.</p></div>`;
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

/* Global Modal Dismissal on Outside Backdrop Click & Escape Key */
window.addEventListener('click', (e) => {
  if (e.target && e.target.classList.contains('modal-overlay')) {
    e.target.style.display = 'none';
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.style.display = 'none';
    });
  }
});

/* Touch Drag Gesture to Dismiss Mobile Modal Bottom Sheets (Header & Handle Only) */
function initBottomSheetTouchGestures() {
  document.querySelectorAll('.modal-card').forEach(card => {
    const handle = card.querySelector('.modal-sheet-handle');
    const header = card.querySelector('.modal-header');

    let startY = 0;
    let currentY = 0;
    let isDragging = false;

    const onTouchStart = (e) => {
      if (window.innerWidth > 768) return;
      startY = e.touches[0].clientY;
      currentY = startY;
      isDragging = true;
      card.style.transition = 'none';
    };

    if (handle) handle.addEventListener('touchstart', onTouchStart, { passive: true });
    if (header) header.addEventListener('touchstart', onTouchStart, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (!isDragging || window.innerWidth > 768) return;
      currentY = e.touches[0].clientY;
      const diffY = currentY - startY;
      if (diffY > 0) {
        card.style.transform = `translateY(${diffY}px)`;
      }
    }, { passive: true });

    window.addEventListener('touchend', () => {
      if (!isDragging || window.innerWidth > 768) return;
      isDragging = false;
      const diffY = currentY - startY;
      card.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
      if (diffY > 90) {
        const modalOverlay = card.closest('.modal-overlay');
        if (modalOverlay) {
          card.style.transform = 'translateY(100%)';
          setTimeout(() => {
            modalOverlay.style.display = 'none';
            card.style.transform = '';
          }, 220);
        }
      } else {
        card.style.transform = '';
      }
    }, { passive: true });
  });
}




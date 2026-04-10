/* ═══════════════════════════════════════════
   CONSTANTS & STATE
═══════════════════════════════════════════ */
const state = {
  token:        null,
  user:         null,
  likedIds:     new Set(),
  watchedIds:   new Set(),
  searchResults: [],
  currentPage:  1,
  totalPages:   1,
  lastFilters:  {},
};
/* ═══════════════════════════════════════════
   DOM READY
═══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  populateYearFilter();

  // Проверяем сохранённый токен
  const savedToken = localStorage.getItem('kf_token');
  const savedUser  = localStorage.getItem('kf_user');
  if (savedToken && savedUser) {
    state.token = savedToken;
    state.user  = JSON.parse(savedUser);
    showApp();
  }

  // Enter в поле поиска
  document.getElementById('searchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') searchMovies();
  });
});

/* ═══════════════════════════════════════════
   YEAR FILTER
═══════════════════════════════════════════ */
function populateYearFilter() {
  const sel = document.getElementById('yearFilter');
  const now = new Date().getFullYear();
  for (let y = now; y >= 1960; y--) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    sel.appendChild(opt);
  }
}

/* ═══════════════════════════════════════════
   AUTH TAB SWITCH
═══════════════════════════════════════════ */
function switchAuthTab(tab) {
  const loginForm    = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const loginBtn     = document.getElementById('tabLoginBtn');
  const regBtn       = document.getElementById('tabRegisterBtn');

  if (tab === 'login') {
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    loginBtn.classList.add('active');
    regBtn.classList.remove('active');
  } else {
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
    loginBtn.classList.remove('active');
    regBtn.classList.add('active');
  }

  document.getElementById('loginError').textContent    = '';
  document.getElementById('registerError').textContent = '';
}

/* ═══════════════════════════════════════════
   TOGGLE PASSWORD VISIBILITY
═══════════════════════════════════════════ */
function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🙈';
  } else {
    input.type = 'password';
    btn.textContent = '👁';
  }
}

/* ═══════════════════════════════════════════
   HANDLE LOGIN
═══════════════════════════════════════════ */
async function handleLogin(e) {
  e.preventDefault();
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('loginError');
  const btn      = document.getElementById('loginBtn');

  errEl.textContent = '';
  setButtonLoading(btn, true);

  try {
    const res = await fetch(`${API}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.message || 'Ошибка входа');

    state.token = data.token;
    state.user  = data.user;
    localStorage.setItem('kf_token', data.token);
    localStorage.setItem('kf_user',  JSON.stringify(data.user));
    showApp();
    showToast('Добро пожаловать, ' + data.user.username + '! 🎬', 'success');
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    setButtonLoading(btn, false);
  }
}

/* ═══════════════════════════════════════════
   HANDLE REGISTER
═══════════════════════════════════════════ */
async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById('regUsername').value.trim();
  const email    = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirm  = document.getElementById('regPasswordConfirm').value;
  const errEl    = document.getElementById('registerError');
  const btn      = document.getElementById('registerBtn');

  errEl.textContent = '';

  if (password !== confirm) {
    errEl.textContent = 'Пароли не совпадают';
    return;
  }

  setButtonLoading(btn, true);

  try {
    const res = await fetch(`${API}/auth/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, email, password }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.message || 'Ошибка регистрации');

    state.token = data.token;
    state.user  = data.user;
    localStorage.setItem('kf_token', data.token);
    localStorage.setItem('kf_user',  JSON.stringify(data.user));
    showApp();
    showToast('Аккаунт создан! Добро пожаловать 🎉', 'success');
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    setButtonLoading(btn, false);
  }
}

/* ═══════════════════════════════════════════
   SHOW / HIDE APP
═══════════════════════════════════════════ */
function showApp() {
  document.getElementById('authOverlay').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('headerUsername').textContent = state.user.username;

  loadUserMovieSets();
}

function logout() {
  state.token      = null;
  state.user       = null;
  state.likedIds   = new Set();
  state.watchedIds = new Set();
  state.searchResults = [];

  localStorage.removeItem('kf_token');
  localStorage.removeItem('kf_user');

  document.getElementById('app').classList.add('hidden');
  document.getElementById('authOverlay').classList.remove('hidden');
  document.getElementById('searchResults').innerHTML = '';
  document.getElementById('loginEmail').value    = '';
  document.getElementById('loginPassword').value = '';
  switchAuthTab('login');
  showToast('Вы вышли из системы', 'info');
}

/* ═══════════════════════════════════════════
   TAB SWITCHING
═══════════════════════════════════════════ */
function switchTab(tab) {
  // Скрываем все панели
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  // Показываем нужную
  document.getElementById('tab' + capitalize(tab)).classList.remove('hidden');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');

  if (tab === 'liked')   loadLikedMovies();
  if (tab === 'watched') loadWatchedMovies();
  if (tab === 'profile') loadProfile();
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ═══════════════════════════════════════════
   LOAD USER MOVIE SETS (для подсветки лайков)
═══════════════════════════════════════════ */
async function loadUserMovieSets() {
  try {
    const [likedRes, watchedRes] = await Promise.all([
      authFetch(`${API}/movies/ids?status=liked`),
      authFetch(`${API}/movies/ids?status=watched`),
    ]);
    const likedData   = await likedRes.json();
    const watchedData = await watchedRes.json();

    state.likedIds   = new Set(likedData.ids || []);
    state.watchedIds = new Set(watchedData.ids || []);

    updateBadges();
  } catch {}
}

function updateBadges() {
  const lb = document.getElementById('likedBadge');
  const wb = document.getElementById('watchedBadge');

  if (state.likedIds.size > 0) {
    lb.textContent = state.likedIds.size;
    lb.classList.remove('hidden');
  } else {
    lb.classList.add('hidden');
  }

  if (state.watchedIds.size > 0) {
    wb.textContent = state.watchedIds.size;
    wb.classList.remove('hidden');
  } else {
    wb.classList.add('hidden');
  }
}

/* ═══════════════════════════════════════════
   SEARCH MOVIES
═══════════════════════════════════════════ */
async function searchMovies(page = 1) {
  const genre = document.getElementById('genreFilter').value;
  const mood  = document.getElementById('moodFilter').value;
  const year  = document.getElementById('yearFilter').value;
  const query = document.getElementById('searchInput').value.trim();

  if (!genre && !mood && !year && !query) {
    showToast('Введите хотя бы один параметр поиска', 'error');
    return;
  }

  state.lastFilters = { genre, mood, year, query };
  state.currentPage = page;

  const spinner   = document.getElementById('searchSpinner');
  const noResults = document.getElementById('searchNoResults');
  const grid      = document.getElementById('searchResults');
  const pagination = document.getElementById('paginationWrap');

  spinner.classList.remove('hidden');
  noResults.classList.add('hidden');
  pagination.classList.add('hidden');
  if (page === 1) grid.innerHTML = '';

  try {
    const params = new URLSearchParams({ page });
    if (genre) params.append('genre', genre);
    if (mood)  params.append('mood',  mood);
    if (year)  params.append('year',  year);
    if (query) params.append('query', query);

    const res  = await authFetch(`${API}/movies/search?${params}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.message || 'Ошибка поиска');

    const movies = data.docs || data.movies || [];
    state.totalPages = data.pages || 1;

    if (movies.length === 0 && page === 1) {
      noResults.classList.remove('hidden');
    } else {
      movies.forEach(m => grid.appendChild(createMovieCard(m)));

      if (state.currentPage < state.totalPages) {
        pagination.classList.remove('hidden');
      }
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    spinner.classList.add('hidden');
  }
}

function loadMore() {
  searchMovies(state.currentPage + 1);
}

function resetFilters() {
  document.getElementById('genreFilter').value  = '';
  document.getElementById('moodFilter').value   = '';
  document.getElementById('yearFilter').value   = '';
  document.getElementById('searchInput').value  = '';
  document.getElementById('searchResults').innerHTML = '';
  document.getElementById('searchNoResults').classList.add('hidden');
  document.getElementById('paginationWrap').classList.add('hidden');
}

/* ═══════════════════════════════════════════
   CREATE MOVIE CARD
═══════════════════════════════════════════ */
function createMovieCard(movie) {
  const id      = movie.kinopoisk_id || movie.id;
  const title   = movie.name || movie.title || 'Без названия';
  const year    = movie.year || '';
  const rating  = movie.rating?.kp || movie.rating || null;
  const poster  = movie.poster?.previewUrl || movie.poster?.url || movie.poster_url || null;
  const genres  = movie.genres || [];
  const isLiked   = state.likedIds.has(String(id));
  const isWatched = state.watchedIds.has(String(id));

  const card = document.createElement('div');
  card.className = 'movie-card';
  card.dataset.id = id;

  card.innerHTML = `
    <div class="movie-poster">
      ${poster
        ? `<img src="${poster}" alt="${title}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'poster-placeholder\\'><span>🎬</span><span>${title}</span></div>'">`
        : `<div class="poster-placeholder"><span>🎬</span><span>${title}</span></div>`
      }
      ${rating ? `<div class="movie-rating">⭐ ${parseFloat(rating).toFixed(1)}</div>` : ''}
      <div class="movie-actions-overlay">
        <button class="action-btn ${isLiked ? 'liked' : ''}"
                onclick="toggleLike(event, ${JSON.stringify(movie).replace(/"/g, '&quot;')})"
                title="${isLiked ? 'Убрать из избранного' : 'В избранное'}">
          ${isLiked ? '❤️' : '🤍'}
        </button>
        <button class="action-btn"
                onclick="openMovieModal(event, ${JSON.stringify(movie).replace(/"/g, '&quot;')})"
                title="Подробнее">
          ℹ️
        </button>
        <button class="action-btn ${isWatched ? 'watched' : ''}"
                onclick="toggleWatched(event, ${JSON.stringify(movie).replace(/"/g, '&quot;')})"
                title="${isWatched ? 'Убрать из просмотренных' : 'Отметить просмотренным'}">
          ${isWatched ? '👁️' : '👁'}
        </button>
      </div>
    </div>
    <div class="movie-info">
      <div class="movie-title">${title}</div>
      <div class="movie-meta">
        <span class="movie-year">${year}</span>
      </div>
      <div class="movie-genres">
        ${genres.slice(0, 2).map(g => `<span class="genre-tag">${g.name || g}</span>`).join('')}
      </div>
    </div>
  `;

  card.querySelector('.movie-info').addEventListener('click', () => {
    openMovieModal(null, movie);
  });

  return card;
}

/* ═══════════════════════════════════════════
   TOGGLE LIKE
═══════════════════════════════════════════ */
async function toggleLike(e, movie) {
  if (e) e.stopPropagation();

  const id     = String(movie.kinopoisk_id || movie.id);
  const isLiked = state.likedIds.has(id);

  try {
    const method = isLiked ? 'DELETE' : 'POST';
    const res = await authFetch(`${API}/movies/like`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ movie: normalizeMovie(movie) }),
    });

    if (!res.ok) throw new Error('Ошибка');

    if (isLiked) {
      state.likedIds.delete(id);
      showToast('Убрано из избранного', 'info');
    } else {
      state.likedIds.add(id);
      showToast('Добавлено в избранное ❤️', 'success');
    }

    updateBadges();
    refreshCardButtons(id);

    // Обновляем модалку если открыта
    const openId = document.getElementById('movieModal').dataset.movieId;
    if (openId === id) refreshModalButtons(id);

  } catch {
    showToast('Ошибка. Попробуйте снова', 'error');
  }
}

/* ═══════════════════════════════════════════
   TOGGLE WATCHED
═══════════════════════════════════════════ */
async function toggleWatched(e, movie) {
  if (e) e.stopPropagation();

  const id        = String(movie.kinopoisk_id || movie.id);
  const isWatched = state.watchedIds.has(id);

  try {
    const method = isWatched ? 'DELETE' : 'POST';
    const res = await authFetch(`${API}/movies/watch`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ movie: normalizeMovie(movie) }),
    });

    if (!res.ok) throw new Error('Ошибка');

    if (isWatched) {
      state.watchedIds.delete(id);
      showToast('Убрано из просмотренных', 'info');
    } else {
      state.watchedIds.add(id);
      showToast('Отмечено как просмотренное 👁️', 'success');
    }

    updateBadges();
    refreshCardButtons(id);

    const openId = document.getElementById('movieModal').dataset.movieId;
    if (openId === id) refreshModalButtons(id);

  } catch {
    showToast('Ошибка. Попробуйте снова', 'error');
  }
}

/* Обновляем кнопки на карточках после изменения состояния */
function refreshCardButtons(id) {
  document.querySelectorAll(`.movie-card[data-id="${id}"]`).forEach(card => {
    const [likeBtn, , watchBtn] = card.querySelectorAll('.action-btn');
    const isLiked   = state.likedIds.has(id);
    const isWatched = state.watchedIds.has(id);

    if (likeBtn) {
      likeBtn.textContent = isLiked ? '❤️' : '🤍';
      likeBtn.classList.toggle('liked', isLiked);
    }
    if (watchBtn) {
      watchBtn.textContent = isWatched ? '👁️' : '👁';
      watchBtn.classList.toggle('watched', isWatched);
    }
  });
}

function refreshModalButtons(id) {
  const likeBtn  = document.getElementById('modalLikeBtn');
  const watchBtn = document.getElementById('modalWatchBtn');
  if (likeBtn) {
    const isLiked = state.likedIds.has(id);
    likeBtn.textContent = isLiked ? '❤️ В избранном' : '🤍 В избранное';
    likeBtn.classList.toggle('active', isLiked);
  }
  if (watchBtn) {
    const isWatched = state.watchedIds.has(id);
    watchBtn.textContent = isWatched ? '👁️ Просмотрено' : '👁 Отметить просмотренным';
    watchBtn.classList.toggle('active', isWatched);
  }
}

/* ═══════════════════════════════════════════
   MOVIE MODAL
═══════════════════════════════════════════ */
function openMovieModal(e, movie) {
  if (e) e.stopPropagation();

  const id         = String(movie.kinopoisk_id || movie.id);
  const title      = movie.name || movie.title || 'Без названия';
  const origTitle  = movie.alternativeName || '';
  const year       = movie.year || '';
  const rating     = movie.rating?.kp || movie.rating || null;
  const ratingImdb = movie.rating?.imdb || null;
  const poster     = movie.poster?.url || movie.poster_url || null;
  const genres     = movie.genres || [];
  const countries  = movie.countries || [];
  const desc       = movie.description || movie.shortDescription || 'Описание отсутствует.';
  const length     = movie.movieLength || null;
  const isLiked    = state.likedIds.has(id);
  const isWatched  = state.watchedIds.has(id);

  const streamLinks = buildStreamLinks(title);

  document.getElementById('movieModalBody').innerHTML = `
    <div class="modal-movie-inner">
      <div class="modal-poster">
        ${poster
          ? `<img src="${poster}" alt="${title}" onerror="this.parentElement.outerHTML='<div class=\\'modal-poster-placeholder\\'>🎬</div>'">`
          : `<div class="modal-poster-placeholder">🎬</div>`
        }
      </div>
      <div class="modal-details">
        <h2 class="modal-title">${title}</h2>
        ${origTitle ? `<p class="modal-original">${origTitle}</p>` : ''}
        <div class="modal-meta-row">
          ${rating
            ? `<div class="modal-rating-kp">⭐ ${parseFloat(rating).toFixed(1)}
               <span style="font-size:12px;color:var(--text-muted);font-weight:400">КП</span></div>`
            : ''
          }
          ${ratingImdb
            ? `<div class="modal-meta-item">
               <span class="icon">⭐</span>${parseFloat(ratingImdb).toFixed(1)}
               <span style="font-size:11px;color:var(--text-muted)">IMDb</span></div>`
            : ''
          }
          ${year  ? `<div class="modal-meta-item"><span class="icon">📅</span>${year}</div>` : ''}
          ${length? `<div class="modal-meta-item"><span class="icon">⏱️</span>${length} мин.</div>` : ''}
          ${countries.length
            ? `<div class="modal-meta-item"><span class="icon">🌍</span>${countries.map(c=>c.name||c).join(', ')}</div>`
            : ''
          }
        </div>
        <div class="modal-genres">
          ${genres.map(g => `<span class="genre-tag">${g.name || g}</span>`).join('')}
        </div>
        <p class="modal-desc">${desc}</p>
        <div class="modal-actions">
          <button id="modalLikeBtn"
                  class="modal-btn modal-btn-like ${isLiked ? 'active' : ''}"
                  onclick="toggleLike(null, ${JSON.stringify(movie).replace(/"/g, '&quot;')})">
            ${isLiked ? '❤️ В избранном' : '🤍 В избранное'}
          </button>
          <button id="modalWatchBtn"
                  class="modal-btn modal-btn-watch ${isWatched ? 'active' : ''}"
                  onclick="toggleWatched(null, ${JSON.stringify(movie).replace(/"/g, '&quot;')})">
            ${isWatched ? '👁️ Просмотрено' : '👁 Отметить просмотренным'}
          </button>
        </div>
        <div class="modal-streaming">
          <h3>🌐 Где смотреть</h3>
          <div class="modal-stream-links">
            ${streamLinks}
          </div>
        </div>
      </div>
    </div>
  `;

  const modal = document.getElementById('movieModal');
  modal.dataset.movieId = id;
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function buildStreamLinks(title) {
  const encoded = encodeURIComponent(title);
  const services = [
    { name: 'Кинопоиск',  url: `https://www.kinopoisk.ru/index.php?kp_query=${encoded}` },
    { name: 'Netflix',    url: `https://www.netflix.com/search?q=${encoded}` },
    { name: 'Okko',       url: `https://okko.tv/search?query=${encoded}` },
    { name: 'IVI',        url: `https://www.ivi.ru/search/?q=${encoded}` },
    { name: 'More.tv',    url: `https://more.tv/search?query=${encoded}` },
    { name: 'MEGOGO',     url: `https://megogo.net/ru/search-extended?q=${encoded}` },
    { name: 'Premier',    url: `https://premier.one/search?q=${encoded}` },
  ];
  return services.map(s =>
    `<a href="${s.url}" target="_blank" rel="noopener" class="modal-stream-link">▶ ${s.name}</a>`
  ).join('');
}

function closeMovieModal(e) {
  if (e && e.target !== document.getElementById('movieModal')) return;
  document.getElementById('movieModal').classList.add('hidden');
  document.body.style.overflow = '';
}

/* ═══════════════════════════════════════════
   LOAD LIKED MOVIES
═══════════════════════════════════════════ */
async function loadLikedMovies() {
  const spinner = document.getElementById('likedSpinner');
  const empty   = document.getElementById('likedEmpty');
  const grid    = document.getElementById('likedGrid');

  spinner.classList.remove('hidden');
  empty.classList.add('hidden');
  grid.innerHTML = '';

  try {
    const res  = await authFetch(`${API}/movies/liked`);
    const data = await res.json();
    const movies = data.movies || [];

    spinner.classList.add('hidden');

    if (movies.length === 0) {
      empty.classList.remove('hidden');
    } else {
      movies.forEach(m => grid.appendChild(createMovieCard(m)));
      document.getElementById('likedSubtitle').textContent =
        `${movies.length} фильм${pluralRu(movies.length)}`;
    }
  } catch {
    spinner.classList.add('hidden');
    showToast('Ошибка загрузки избранных', 'error');
  }
}

/* ═══════════════════════════════════════════
   LOAD WATCHED MOVIES
═══════════════════════════════════════════ */
async function loadWatchedMovies() {
  const spinner = document.getElementById('watchedSpinner');
  const empty   = document.getElementById('watchedEmpty');
  const grid    = document.getElementById('watchedGrid');

  spinner.classList.remove('hidden');
  empty.classList.add('hidden');
  grid.innerHTML = '';

  try {
    const res  = await authFetch(`${API}/movies/watched`);
    const data = await res.json();
    const movies = data.movies || [];

    spinner.classList.add('hidden');

    if (movies.length === 0) {
      empty.classList.remove('hidden');
    } else {
      movies.forEach(m => grid.appendChild(createMovieCard(m)));
      document.getElementById('watchedSubtitle').textContent =
        `${movies.length} фильм${pluralRu(movies.length)}`;
    }
  } catch {
    spinner.classList.add('hidden');
    showToast('Ошибка загрузки просмотренных', 'error');
  }
}

/* ═══════════════════════════════════════════
   LOAD PROFILE
═══════════════════════════════════════════ */
async function loadProfile() {
  try {
    const res  = await authFetch(`${API}/user/profile`);
    const data = await res.json();

    document.getElementById('profileAvatar').textContent =
      (data.username || 'U').charAt(0).toUpperCase();
    document.getElementById('profileName').textContent    = data.username || '—';
    document.getElementById('profileEmail').textContent   = '✉️ ' + (data.email || '—');
    document.getElementById('profileSince').textContent   =
      '📅 На сайте с: ' + new Date(data.created_at).toLocaleDateString('ru-RU', {
        year: 'numeric', month: 'long', day: 'numeric',
      });

    document.getElementById('statLiked').textContent   = data.liked_count   || 0;
    document.getElementById('statWatched').textContent = data.watched_count  || 0;
    document.getElementById('statRating').textContent  =
      data.avg_rating ? parseFloat(data.avg_rating).toFixed(1) : '—';

  } catch {
    showToast('Ошибка загрузки профиля', 'error');
  }
}

/* ═══════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════ */
function normalizeMovie(movie) {
  const normalizedTitle = String(movie.name || movie.title || '').trim() || 'Без названия';
  return {
    kinopoisk_id: movie.kinopoisk_id || movie.id,
    title:        normalizedTitle,
    year:         movie.year || null,
    poster_url:   movie.poster?.previewUrl || movie.poster?.url || movie.poster_url || null,
    rating:       movie.rating?.kp || movie.rating || null,
    genres:       (movie.genres || []).map(g => g.name || g).join(', '),
    description:  movie.description || movie.shortDescription || '',
  };
}

async function authFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'Authorization': `Bearer ${state.token}`,
    },
  });
}

function setButtonLoading(btn, loading) {
  btn.disabled = loading;
  const text   = btn.querySelector('.btn-text');
  const loader = btn.querySelector('.btn-loader');
  if (text && loader) {
    text.classList.toggle('hidden', loading);
    loader.classList.toggle('hidden', !loading);
  }
}

function pluralRu(n) {
  const abs = Math.abs(n) % 100;
  const n1  = abs % 10;
  if (abs > 10 && abs < 20) return 'ов';
  if (n1 > 1 && n1 < 5) return 'а';
  if (n1 === 1) return '';
  return 'ов';
}

/* ═══════════════════════════════════════════
   TOAST
═══════════════════════════════════════════ */
let toastTimer = null;
function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  clearTimeout(toastTimer);

  toast.textContent = msg;
  toast.className   = `toast ${type} show`;

  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3200);
}

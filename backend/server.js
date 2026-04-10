require('dotenv').config();

const express  = require('express');
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const cors     = require('cors');
const axios    = require('axios');

const app  = express();

// Подключение к базе данных через URL или отдельные параметры
// Подключение к базе данных Render Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false   // Обязательно для Render
  },
  // Дополнительно для стабильности
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

console.log('Database connected with URL:', process.env.DATABASE_URL ? '✅ URL установлен' : '❌ DATABASE_URL отсутствует!');

const JWT_SECRET    = process.env.JWT_SECRET || 'supersecret_change_me';
const KP_API_KEY    = process.env.KP_API_KEY || 'YOUR_KINOPOISK_API_KEY';
const KP_BASE       = 'https://api.kinopoisk.dev/v1.4';
const OMDB_API_KEY  = process.env.OMDB_API_KEY || '';
const OMDB_BASE     = 'https://www.omdbapi.com/';
const PORT          = process.env.PORT || 3001;
const FRONTEND_URL  = process.env.FRONTEND_URL || 'https://kinofonder.netlify.app';

/* ─── MIDDLEWARE ─── */
// Настройка CORS для Netlify
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5500',
  'https://kinofonder.netlify.app',
  FRONTEND_URL,
];

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://kinofonder.netlify.app';

const corsOptions = {
  origin: (origin, callback) => {
    const allowed = [
      'http://localhost:3000',
      'http://localhost:5500',
      FRONTEND_URL,
      'https://kinofonder.netlify.app',
      // добавь свой custom domain, если есть
    ];

    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());
//app.use(express.static('../frontend')); // Для локальной разработки

/* ─── JWT MIDDLEWARE ─── */
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Требуется авторизация' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: 'Токен недействителен' });
  }
}

/* ═══════════════════════════════════════════
   AUTH ROUTES
═══════════════════════════════════════════ */

/* Регистрация */
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password)
    return res.status(400).json({ message: 'Заполните все поля' });
  if (password.length < 6)
    return res.status(400).json({ message: 'Пароль минимум 6 символов' });

  try {
    const exists = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email.toLowerCase(), username]
    );
    if (exists.rows.length > 0)
      return res.status(409).json({ message: 'Email или имя уже занято' });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
      [username, email.toLowerCase(), hash]
    );

    const user  = result.rows[0];
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

/* Вход */
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ message: 'Заполните все поля' });

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (result.rows.length === 0)
      return res.status(401).json({ message: 'Неверный email или пароль' });

    const user  = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ message: 'Неверный email или пароль' });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, created_at: user.created_at },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

/* ═══════════════════════════════════════════
   MOVIES ROUTES
═══════════════════════════════════════════ */

const moodToGenre = {
  веселое:       'комедия',
  грустное:      'драма',
  страшное:      'ужасы',
  романтичное:   'мелодрама',
  напряженное:   'триллер',
  вдохновляющее: 'биография',
  расслабляющее: 'анимация',
};

const omdbGenreToRu = {
  action: 'боевик',
  adventure: 'приключения',
  animation: 'мультфильм',
  biography: 'биография',
  comedy: 'комедия',
  crime: 'криминал',
  documentary: 'документальный',
  drama: 'драма',
  family: 'семейный',
  fantasy: 'фэнтези',
  history: 'история',
  horror: 'ужасы',
  music: 'музыка',
  musical: 'мюзикл',
  mystery: 'детектив',
  romance: 'мелодрама',
  'sci-fi': 'фантастика',
  sport: 'спорт',
  thriller: 'триллер',
  war: 'военный',
  western: 'вестерн',
};

const omdbCountryToRu = {
  usa: 'США',
  'united states': 'США',
  'united states of america': 'США',
  russia: 'Россия',
  uk: 'Великобритания',
  'united kingdom': 'Великобритания',
  france: 'Франция',
  germany: 'Германия',
  japan: 'Япония',
  'south korea': 'Корея Южная',
  italy: 'Италия',
  spain: 'Испания',
  canada: 'Канада',
  australia: 'Австралия',
  india: 'Индия',
  china: 'Китай',
};

function mapOmdbGenreToRu(name) {
  const key = String(name || '').trim().toLowerCase();
  return omdbGenreToRu[key] || name;
}

function mapOmdbCountryToRu(name) {
  const key = String(name || '').trim().toLowerCase();
  return omdbCountryToRu[key] || name;
}

function dedupeMoviesPayload(payload) {
  const list = payload?.docs || payload?.movies;
  if (!Array.isArray(list)) return payload;

  const unique = [];
  const seen = new Set();

  for (const movie of list) {
    const id = String(
      movie?.kinopoiskId ||
      movie?.kinopoisk_id ||
      movie?.id ||
      movie?._id ||
      ''
    );
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(movie);
  }

  if (Array.isArray(payload.docs)) {
    return { ...payload, docs: unique };
  }
  if (Array.isArray(payload.movies)) {
    return { ...payload, movies: unique };
  }
  return payload;
}

function dedupeMoviesList(list) {
  const unique = [];
  const seen = new Set();

  for (const movie of list) {
    const rawId =
      movie?.kinopoiskId ||
      movie?.kinopoisk_id ||
      movie?.id ||
      movie?._id ||
      movie?.imdbID ||
      '';
    const title = (movie?.name || movie?.title || '').trim().toLowerCase();
    const year = String(movie?.year || '');
    const key = String(rawId || `${title}-${year}`);

    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(movie);
  }

  return unique;
}

function mapOmdbMovieToUnified(omdbMovie) {
  const yearNum = Number.parseInt(omdbMovie.Year, 10) || null;
  const poster = omdbMovie.Poster && omdbMovie.Poster !== 'N/A' ? omdbMovie.Poster : null;
  const genresRaw = (omdbMovie.Genre && omdbMovie.Genre !== 'N/A')
    ? omdbMovie.Genre.split(',').map(g => g.trim()).filter(Boolean)
    : [];
  const countriesRaw = (omdbMovie.Country && omdbMovie.Country !== 'N/A')
    ? omdbMovie.Country.split(',').map(c => c.trim()).filter(Boolean)
    : [];

  return {
    id: `omdb:${omdbMovie.imdbID}`,
    kinopoisk_id: omdbMovie.imdbID,
    imdbID: omdbMovie.imdbID,
    name: omdbMovie.Title,
    title: omdbMovie.Title,
    year: yearNum,
    poster: poster ? { url: poster, previewUrl: poster } : null,
    poster_url: poster,
    description: omdbMovie.Plot && omdbMovie.Plot !== 'N/A' ? omdbMovie.Plot : 'Описание отсутствует.',
    rating: { 
      kp: omdbMovie.imdbRating && omdbMovie.imdbRating !== 'N/A' ? parseFloat(omdbMovie.imdbRating) : null,
      imdb: omdbMovie.imdbRating && omdbMovie.imdbRating !== 'N/A' ? parseFloat(omdbMovie.imdbRating) : null
    },
    genres: genresRaw.map(g => ({ name: mapOmdbGenreToRu(g) })),
    countries: countriesRaw.map(c => ({ name: mapOmdbCountryToRu(c) })),
    source: 'omdb',
  };
}

async function fetchKinopoiskMovies({ genre, mood, year, query, page }) {
  let url;
  let params = new URLSearchParams();

  params.append('token', KP_API_KEY);
  params.append('limit', '30');
  params.append('page', page);

  if (query && query.trim()) {
    url = `${KP_BASE}/movie/search`;
    params = new URLSearchParams({
      token: KP_API_KEY,
      query: query.trim(),
      limit: 30,
      page,
    });
  } else {
    url = `${KP_BASE}/movie`;
    const effectiveGenre = genre || (mood ? moodToGenre[mood] : null);
    if (effectiveGenre) params.append('genres.name', effectiveGenre);
    if (year) params.append('year', year);

    params.append('rating.kp', '5-10');
    params.append('sortField', 'rating.kp');
    params.append('sortType', '-1');
    params.append('notNullFields', 'poster.url');
  }

  const response = await axios.get(`${url}?${params}`, {
    headers: { 'X-API-KEY': KP_API_KEY },
    timeout: 10000,
  });

  const normalized = dedupeMoviesPayload(response.data);
  return {
    docs: normalized.docs || normalized.movies || [],
    pages: normalized.pages || 1,
  };
}

function buildOmdbSeedTerms({ query, genre, mood }) {
  const terms = [];
  if (query && query.trim()) terms.push(query.trim());
  if (genre && genre.trim()) terms.push(genre.trim());
  if (mood && mood.trim()) terms.push(mood.trim());

  terms.push(
    'movie', 'film', 'love', 'life', 'night', 'day', 'city',
    'war', 'man', 'woman', 'family', 'school', 'star', 'world'
  );

  return Array.from(new Set(terms.filter(t => t && t.length >= 3)));
}

async function fetchOmdbMovies({ query, genre, mood, year, page }) {
  if (!OMDB_API_KEY) {
    return { docs: [], pages: 1 };
  }

  const targetCount = 30;
  const chunkSize = 3;
  const pageNum = Math.max(1, Number(page) || 1);
  const startPage = (pageNum - 1) * chunkSize + 1;
  const pageNumbers = Array.from({ length: chunkSize }, (_, i) => startPage + i);
  const seedTerms = buildOmdbSeedTerms({ query, genre, mood });

  const collected = [];
  const seen = new Set();
  let bestTotalPages = 1;

  for (const term of seedTerms) {
    if (collected.length >= targetCount) break;

    const responses = await Promise.all(
      pageNumbers.map(async (p) => {
        const params = new URLSearchParams({
          apikey: OMDB_API_KEY,
          s: term,
          type: 'movie',
          page: String(p),
        });
        if (year) params.append('y', String(year));
        try {
          const response = await axios.get(`${OMDB_BASE}?${params.toString()}`, { timeout: 10000 });
          return response.data || {};
        } catch {
          return { Response: 'False' };
        }
      })
    );

    const firstOk = responses.find(r => r.Response === 'True');
    if (firstOk) {
      const total = Number.parseInt(firstOk.totalResults || '0', 10) || 0;
      const rawPages = Math.max(1, Math.ceil(total / 10));
      bestTotalPages = Math.max(bestTotalPages, Math.ceil(rawPages / chunkSize));
    }

    const imdbIds = [];
    for (const resp of responses) {
      if (resp.Response !== 'True' || !Array.isArray(resp.Search)) continue;
      for (const item of resp.Search) {
        const key = item.imdbID;
        if (seen.has(key)) continue;
        seen.add(key);
        imdbIds.push(item.imdbID);
        if (imdbIds.length >= targetCount) break;
      }
      if (imdbIds.length >= targetCount) break;
    }

    const fullInfoPromises = imdbIds.map(async (imdbID) => {
      try {
        const detailParams = new URLSearchParams({
          apikey: OMDB_API_KEY,
          i: imdbID,
          plot: 'full',
        });
        const detailResponse = await axios.get(`${OMDB_BASE}?${detailParams.toString()}`, { timeout: 10000 });
        const data = detailResponse.data;
        if (data.Response === 'True') {
          return mapOmdbMovieToUnified(data);
        }
        return null;
      } catch {
        return null;
      }
    });

    const fullMovies = (await Promise.all(fullInfoPromises)).filter(m => m !== null);
    collected.push(...fullMovies);
  }

  return { docs: collected.slice(0, targetCount), pages: Math.max(1, bestTotalPages) };
}

/* Поиск фильмов через Kinopoisk API + OMDb */
app.get('/api/movies/search', auth, async (req, res) => {
  let { genre, mood, year, query, page = 1, country } = req.query;

  try {
    const pageNum = Number.parseInt(page, 10) || 1;
    const [kpResult, omdbResult] = await Promise.allSettled([
      fetchKinopoiskMovies({ genre, mood, year, query, page: pageNum }),
      fetchOmdbMovies({ query, genre, mood, year, page: pageNum }),
    ]);

    const kpDocs = kpResult.status === 'fulfilled' ? kpResult.value.docs : [];
    const omdbDocs = omdbResult.status === 'fulfilled' ? omdbResult.value.docs : [];
    
    let docs = dedupeMoviesList([...kpDocs, ...omdbDocs]);

    // Фильтрация по стране
    if (country && country !== '') {
      docs = docs.filter(movie => 
        movie.countries && movie.countries.some(c => 
          c.name.toLowerCase() === country.toLowerCase() ||
          c.name.includes(country)
        )
      );
    }

    // Фильтрация по жанру (если не было в API запросе)
    if (genre && genre !== '' && !query) {
      docs = docs.filter(movie => 
        movie.genres && movie.genres.some(g => 
          g.name.toLowerCase().includes(genre.toLowerCase())
        )
      );
    }

    const pages = Math.max(
      kpResult.status === 'fulfilled' ? kpResult.value.pages : 1,
      omdbResult.status === 'fulfilled' ? omdbResult.value.pages : 1
    );

    if (kpResult.status !== 'fulfilled') {
      console.error('Kinopoisk API error:', kpResult.reason?.response?.data || kpResult.reason?.message || kpResult.reason);
    }
    if (omdbResult.status !== 'fulfilled') {
      console.error('OMDb API error:', omdbResult.reason?.response?.data || omdbResult.reason?.message || omdbResult.reason);
    }

    res.json({ docs, pages, page: pageNum });
  } catch (err) {
    console.error('Kinopoisk API error:', err.response?.data || err.message);
    const status = err.response?.status || 500;
    if (status === 401 || status === 403) {
      return res.status(502).json({ message: 'Неверный API-ключ Кинопоиска' });
    }
    res.status(502).json({ message: 'Ошибка при запросе к Кинопоиску' });
  }
});

/* Получить ID фильмов (liked/watched) */
app.get('/api/movies/ids', auth, async (req, res) => {
  const { status } = req.query;
  if (!['liked', 'watched'].includes(status))
    return res.status(400).json({ message: 'Неверный статус' });

  try {
    const result = await pool.query(
      `SELECT m.kinopoisk_id
       FROM user_movies um
       JOIN movies m ON um.movie_id = m.id
       WHERE um.user_id = $1 AND um.status = $2`,
      [req.user.id, status]
    );
    res.json({ ids: result.rows.map(r => String(r.kinopoisk_id)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

/* Вспомогательная функция: upsert фильма, вернуть его id */
async function upsertMovie(movieData) {
  const { kinopoisk_id, title, year, poster_url, rating, genres, description } = movieData || {};

  const safeKinopoiskId = String(kinopoisk_id || '').trim();
  if (!safeKinopoiskId) {
    throw new Error('Отсутствует идентификатор фильма');
  }

  const safeTitle = String(title || '').trim() || 'Без названия';

  let ratingValue = null;
  if (rating) {
    if (typeof rating === 'object') {
      ratingValue = rating.kp || rating.imdb || null;
    } else {
      ratingValue = rating;
    }
  }

  const result = await pool.query(
    `INSERT INTO movies (kinopoisk_id, title, year, poster_url, rating, genres, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (kinopoisk_id) DO UPDATE
       SET title       = EXCLUDED.title,
           poster_url  = EXCLUDED.poster_url,
           rating      = EXCLUDED.rating,
           genres      = EXCLUDED.genres,
           description = EXCLUDED.description
     RETURNING id`,
    [safeKinopoiskId, safeTitle, year, poster_url, ratingValue, genres, description]
  );
  return result.rows[0].id;
}

/* Добавить в избранное */
app.post('/api/movies/like', auth, async (req, res) => {
  const { movie } = req.body;
  if (!movie) return res.status(400).json({ message: 'Нет данных фильма' });

  try {
    const movieDbId = await upsertMovie(movie);
    await pool.query(
      `INSERT INTO user_movies (user_id, movie_id, status)
       VALUES ($1, $2, 'liked')
       ON CONFLICT (user_id, movie_id, status) DO NOTHING`,
      [req.user.id, movieDbId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

/* Убрать из избранного */
app.delete('/api/movies/like', auth, async (req, res) => {
  const { movie } = req.body;
  if (!movie) return res.status(400).json({ message: 'Нет данных фильма' });

  try {
    const movieRes = await pool.query(
      'SELECT id FROM movies WHERE kinopoisk_id = $1', [movie.kinopoisk_id]
    );
    if (movieRes.rows.length === 0) return res.json({ success: true });

    await pool.query(
      `DELETE FROM user_movies WHERE user_id = $1 AND movie_id = $2 AND status = 'liked'`,
      [req.user.id, movieRes.rows[0].id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

/* Добавить в просмотренные */
app.post('/api/movies/watch', auth, async (req, res) => {
  const { movie } = req.body;
  if (!movie) return res.status(400).json({ message: 'Нет данных фильма' });

  try {
    const movieDbId = await upsertMovie(movie);
    await pool.query(
      `INSERT INTO user_movies (user_id, movie_id, status)
       VALUES ($1, $2, 'watched')
       ON CONFLICT (user_id, movie_id, status) DO NOTHING`,
      [req.user.id, movieDbId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

/* Убрать из просмотренных */
app.delete('/api/movies/watch', auth, async (req, res) => {
  const { movie } = req.body;
  if (!movie) return res.status(400).json({ message: 'Нет данных фильма' });

  try {
    const movieRes = await pool.query(
      'SELECT id FROM movies WHERE kinopoisk_id = $1', [movie.kinopoisk_id]
    );
    if (movieRes.rows.length === 0) return res.json({ success: true });

    await pool.query(
      `DELETE FROM user_movies WHERE user_id = $1 AND movie_id = $2 AND status = 'watched'`,
      [req.user.id, movieRes.rows[0].id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

/* Получить избранные фильмы */
app.get('/api/movies/liked', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.kinopoisk_id AS id, m.title AS name, m.year, m.poster_url, m.rating, m.genres, m.description,
              um.created_at AS added_at
       FROM user_movies um
       JOIN movies m ON um.movie_id = m.id
       WHERE um.user_id = $1 AND um.status = 'liked'
       ORDER BY um.created_at DESC`,
      [req.user.id]
    );
    const movies = result.rows.map(normalizeDbMovie);
    res.json({ movies });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

/* Получить просмотренные фильмы */
app.get('/api/movies/watched', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.kinopoisk_id AS id, m.title AS name, m.year, m.poster_url, m.rating, m.genres, m.description,
              um.created_at AS added_at
       FROM user_movies um
       JOIN movies m ON um.movie_id = m.id
       WHERE um.user_id = $1 AND um.status = 'watched'
       ORDER BY um.created_at DESC`,
      [req.user.id]
    );
    const movies = result.rows.map(normalizeDbMovie);
    res.json({ movies });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

/* Профиль пользователя */
app.get('/api/user/profile', auth, async (req, res) => {
  try {
    const [userRes, statsRes] = await Promise.all([
      pool.query(
        'SELECT username, email, created_at FROM users WHERE id = $1',
        [req.user.id]
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE um.status = 'liked')   AS liked_count,
           COUNT(*) FILTER (WHERE um.status = 'watched') AS watched_count,
           AVG(m.rating) FILTER (WHERE um.status = 'liked') AS avg_rating
         FROM user_movies um
         JOIN movies m ON um.movie_id = m.id
         WHERE um.user_id = $1`,
        [req.user.id]
      ),
    ]);

    res.json({
      ...userRes.rows[0],
      ...statsRes.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

/* Нормализация фильма из БД для фронтенда */
function normalizeDbMovie(row) {
  return {
    id:             row.id,
    kinopoisk_id:   row.kinopoisk_id,
    name:           row.name,
    year:           row.year,
    poster_url:     row.poster_url,
    poster:         { url: row.poster_url, previewUrl: row.poster_url },
    rating:         { kp: row.rating },
    genres:         (row.genres || '').split(',').filter(Boolean).map(g => ({ name: g.trim() })),
    description:    row.description,
  };
}

/* ─── START ─── */
app.listen(PORT, () => {
  console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
  console.log(`🌐 Разрешённые CORS origins:`, allowedOrigins);
  console.log(`📡 Kinopoisk API Key: ${KP_API_KEY && KP_API_KEY !== 'YOUR_KINOPOISK_API_KEY' ? '✅ Установлен' : '⚠️ НЕ УСТАНОВЛЕН'}`);
  console.log(`🎞 OMDb API Key: ${OMDB_API_KEY ? '✅ Установлен' : '⚠️ НЕ УСТАНОВЛЕН'}`);
});

module.exports = app;

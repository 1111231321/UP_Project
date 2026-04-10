-- ═══════════════════════════════════════════
-- Создание базы данных
-- ═══════════════════════════════════════════
-- psql -U postgres -c "CREATE DATABASE kinofinder;"
-- psql -U postgres -d kinofinder -f database.sql

-- ═══════════════════════════════════════════
-- Таблица пользователей
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(100) NOT NULL,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_users_email    UNIQUE (email),
  CONSTRAINT uq_users_username UNIQUE (username)
);

-- ═══════════════════════════════════════════
-- Таблица фильмов (кэш данных из Kinopoisk)
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS movies (
  id            SERIAL PRIMARY KEY,
  kinopoisk_id  INTEGER NOT NULL,
  title         VARCHAR(500) NOT NULL,
  year          SMALLINT,
  poster_url    TEXT,
  rating        DECIMAL(4, 2),
  genres        VARCHAR(500),
  description   TEXT,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_movies_kp_id UNIQUE (kinopoisk_id)
);

-- ═══════════════════════════════════════════
-- Таблица связей пользователь-фильм
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_movies (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  movie_id   INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  status     VARCHAR(20) NOT NULL CHECK (status IN ('liked', 'watched')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_user_movie_status UNIQUE (user_id, movie_id, status)
);

-- ═══════════════════════════════════════════
-- Индексы для ускорения запросов
-- ═══════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_users_email        ON users(email);
CREATE INDEX IF NOT EXISTS idx_movies_kp_id       ON movies(kinopoisk_id);
CREATE INDEX IF NOT EXISTS idx_user_movies_user   ON user_movies(user_id);
CREATE INDEX IF NOT EXISTS idx_user_movies_status ON user_movies(user_id, status);

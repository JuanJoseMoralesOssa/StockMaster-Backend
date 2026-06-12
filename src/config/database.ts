// Guarantee .env is loaded BEFORE the env vars below are read. This module
// captures process.env at load time; without this line, whichever module
// chain happens to load first decides whether the values exist yet (a test
// file importing src/auth before src/index once cached localhost defaults
// here and silently pointed every suite at a nonexistent database).
import 'dotenv/config'

export const databaseConfig = {
  url:
    process.env.BD_URL ??
    'postgresql://postgres:postgres@localhost:5432/postgres?sslmode=verify-full',
  host: process.env.BD_HOST ?? 'localhost',
  port: Number(process.env.BD_PORT ?? 5432),
  user: process.env.BD_USER ?? 'postgres',
  password: process.env.BD_PASSWORD ?? 'postgres',
  database: process.env.BD_DATABASE ?? 'postgres',
}

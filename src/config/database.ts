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

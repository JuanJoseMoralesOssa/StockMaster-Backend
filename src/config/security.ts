export const securityConfig = {
  URL: process.env.BD_URL ?? 'postgresql://postgres:postgres@localhost:5432/postgres',
  HOST: process.env.BD_HOST ?? 'localhost',
  PORT: process.env.BD_PORT ?? 5432,
  USER: process.env.BD_USER ?? 'postgres',
  PASSWORD: process.env.BD_PASSWORD ?? 'postgres',
  DATABASE: process.env.BD_DATABASE ?? 'postgres',
  JWT_SECRET: process.env.JWT_SECRET ?? 'default_secret',
}

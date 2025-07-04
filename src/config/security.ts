export const securityConfig = {
  URL: process.env.BD_URL ?? '',
  HOST: process.env.BD_HOST ?? '',
  PORT: process.env.BD_PORT ?? 3306,
  USER: process.env.BD_USER ?? '',
  PASSWORD: process.env.BD_PASSWORD ?? '',
  DATABASE: process.env.BD_DATABASE ?? '',
  SSL_CERT_PATH: process.env.SSL_CERT_PATH ?? '',
  JWT_SECRET: process.env.JWT_SECRET ?? '',
};

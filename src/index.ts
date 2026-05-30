require('dotenv').config()

import { App, ApplicationConfig } from './application'

export * from './application'

export async function main(options: ApplicationConfig = {}) {
  const app = new App(options)
  await app.boot()
  await app.start()

  const url = app.restServer.url
  console.log(`Server is running at ${url}`)
  console.log(`Try ${url}/ping`)

  return app
}

if (require.main === module) {
  // Run the application
  const config = {
    rest: {
      port: +(process.env.PORT ?? 3000),
      host: process.env.HOST ?? '127.0.0.1',
      // The `gracePeriodForClose` provides a graceful close for http/https
      // servers with keep-alive clients. The default value is `Infinity`
      // (don't force-close). If you want to immediately destroy all sockets
      // upon stop, set its value to `0`.
      // See https://www.npmjs.com/package/stoppable
      gracePeriodForClose: 5000, // 5 seconds
      openApiSpec: {
        // useful when used with OpenAPI-to-GraphQL to locate your application
        setServersFromRequest: true,
      },
      // CORS: restringir a los orígenes del frontend. En prod, definir
      // FRONTEND_ORIGIN (coma-separado). Default: orígenes de Vite en dev.
      cors: {
        origin: process.env.FRONTEND_ORIGIN
          ? process.env.FRONTEND_ORIGIN.split(',').map(o => o.trim())
          : ['http://localhost:5173', 'http://127.0.0.1:5173'],
        credentials: true,
        maxAge: 86400,
      },
    },
  }
  main(config).catch(err => {
    console.error('Cannot start the application.', err)
    process.exit(1)
  })
}

import { authenticate } from '@loopback/authentication'
import { inject } from '@loopback/core'
import {
  Request,
  RestBindings,
  get,
  response,
  ResponseObject,
} from '@loopback/rest'

/**
 * OpenAPI response for health check
 */
const HEALTH_RESPONSE: ResponseObject = {
  description: 'Health Check Response',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        title: 'HealthResponse',
        properties: {
          status: { type: 'string' },
          timestamp: { type: 'string' },
          uptime: { type: 'number' },
          environment: { type: 'string' },
          version: { type: 'string' },
        },
      },
    },
  },
}

/**
 * Health check controller
 */
export class HealthController {
  constructor(@inject(RestBindings.Http.REQUEST) private req: Request) {}

  @authenticate.skip()
  @get('/health')
  @response(200, HEALTH_RESPONSE)
  health(): object {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV ?? 'development',
      version: process.env.npm_package_version ?? '1.0.0',
    }
  }
}

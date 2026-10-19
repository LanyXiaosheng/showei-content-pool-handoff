import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.logLevel,
  base: { service: 'shiwei-content-pool' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      '*.password',
      '*.apiKey',
      '*.api_key',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
  transport: config.nodeEnv === 'development' ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } } : undefined,
});

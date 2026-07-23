import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import pino from 'pino';
import { env } from './config/env';
import { globalErrorHandler, notFoundHandler } from './middleware/errorHandler';
import { globalRateLimiter } from './middleware/rateLimiter';
import { requestIdMiddleware } from './middleware/requestId';
import apiRoutes from './routes';

const app = express();

app.use(helmet());

// Support multiple CORS origins (comma-separated in CLIENT_URL)
const allowedOrigins = env.CLIENT_URL.split(',').map((s: string) => s.trim());
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(compression());

app.use(requestIdMiddleware);

// Use a real pino instance for pino-http (it requires the pino Logger type)
const httpLogger = pino({ level: env.NODE_ENV === 'production' ? 'info' : 'debug' });
app.use(pinoHttp({ logger: httpLogger, autoLogging: env.NODE_ENV === 'production' }));

app.use('/api', globalRateLimiter);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/v1', apiRoutes);

app.use(notFoundHandler);
app.use(globalErrorHandler);

export default app;

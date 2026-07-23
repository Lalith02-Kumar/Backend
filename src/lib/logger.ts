// Re-export the canonical Pino logger from utils
// All services, workers, and middleware should import { logger } from this path
export { logger } from '../utils/logger';

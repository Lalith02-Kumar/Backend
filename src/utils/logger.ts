import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

const pinoLogger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  transport: !isProduction
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

// Wrap pino to accept Winston-style calls: logger.error('message', error)
// Pino expects: logger.error({ err }, 'message') or logger.error('message')
function wrapLevel(level: 'info' | 'warn' | 'error' | 'debug' | 'fatal' | 'trace') {
  return (msgOrObj: any, ...args: any[]) => {
    if (typeof msgOrObj === 'object' && msgOrObj !== null) {
      // Already Pino-style: logger.error({ key: val }, 'msg')
      pinoLogger[level](msgOrObj, ...args);
    } else if (args.length > 0 && typeof args[0] === 'object') {
      // Winston-style: logger.error('msg', { key: val }) or logger.error('msg', error)
      const extra = args[0];
      if (extra instanceof Error) {
        pinoLogger[level]({ err: extra }, msgOrObj);
      } else {
        pinoLogger[level](extra, msgOrObj);
      }
    } else {
      // Simple string: logger.info('msg')
      pinoLogger[level](msgOrObj, ...args);
    }
  };
}

export const logger = {
  info: wrapLevel('info'),
  warn: wrapLevel('warn'),
  error: wrapLevel('error'),
  debug: wrapLevel('debug'),
  fatal: wrapLevel('fatal'),
  trace: wrapLevel('trace'),
  child: pinoLogger.child.bind(pinoLogger),
  level: pinoLogger.level,
};

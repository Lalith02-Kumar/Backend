import { Response } from 'express';

export const sendSuccess = (res: Response, data: any, statusCode = 200, meta?: any) => {
  res.status(statusCode).json({
    success: true,
    data,
    meta: {
      requestId: res.req?.id,
      timestamp: new Date().toISOString(),
      ...meta
    }
  });
};

import { AppError } from './AppError';

export abstract class BaseService {
  protected handleError(error: any, defaultMessage: string = 'Service error') {
    if (error instanceof AppError) throw error;
    throw new AppError(defaultMessage, 500, 'INTERNAL_ERROR', error.message);
  }
}

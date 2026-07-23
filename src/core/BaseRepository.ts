import { prisma } from '../lib/prisma';

export abstract class BaseRepository<T> {
  protected db = prisma;
  protected modelName: string;

  constructor(modelName: string) {
    this.modelName = modelName;
  }
}

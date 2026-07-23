import { Request, Response, NextFunction } from 'express';
import { auth } from '../lib/firebase';
import { prisma } from '../lib/prisma';
import { AppError } from '../core/AppError';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    firebaseUid: string;
  };
}

/**
 * Verifies the Firebase Bearer token and attaches the DB user to `req.user`.
 * Auto-creates the user record on first sign-in.
 */
export async function authenticate(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError('Missing or invalid authorization header', 401, 'UNAUTHORIZED');
    }

    const token = authHeader.split(' ')[1];

    // Verify Firebase ID token
    const decodedToken = await auth.verifyIdToken(token);

    // Find or create user in our DB
    let user = await prisma.user.findUnique({
      where: { firebaseUid: decodedToken.uid },
      select: { id: true, email: true, firebaseUid: true, isActive: true },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: decodedToken.email || '',
          displayName: decodedToken.name || 'Student',
          photoURL: decodedToken.picture,
          firebaseUid: decodedToken.uid,
          role: 'STUDENT',
        },
        select: { id: true, email: true, firebaseUid: true, isActive: true },
      });
    }

    if (!user.isActive) {
      throw new AppError('Account is disabled', 403, 'ACCOUNT_DISABLED');
    }

    req.user = { id: user.id, email: user.email, firebaseUid: user.firebaseUid };
    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('Invalid or expired token', 401, 'UNAUTHORIZED'));
    }
  }
}

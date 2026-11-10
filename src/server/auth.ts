import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET || 'greenedge-esg-default-secret-2026';

export interface AuthUser {
  id: string;
  clientId?: string | null;
  clientName?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  email: string;
  name: string;
  role: 'ge_admin' | 'client_admin' | 'employee';
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function generateToken(user: AuthUser): string {
  return jwt.sign(
    {
      id: user.id,
      clientId: user.clientId,
      clientName: user.clientName,
      departmentId: user.departmentId,
      departmentName: user.departmentName,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function verifyToken(token: string): AuthUser | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthUser;
  } catch (err) {
    return null;
  }
}

/**
 * Express middleware to authenticate JWT from Authorization header or cookie
 */
export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  let token: string | undefined;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired session token' });
  }

  req.user = user;
  next();
}

/**
 * Optional auth middleware (attaches req.user if present, doesn't reject if not)
 */
export function optionalAuthMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  let token: string | undefined;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (token) {
    const user = verifyToken(token);
    if (user) {
      req.user = user;
    }
  }
  next();
}

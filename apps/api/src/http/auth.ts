import bcrypt from "bcryptjs";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { DB } from "../db.js";
import type { Role } from "../domain/types.js";
import { AppError } from "../errors.js";

export const SESSION_COOKIE = "ed_session";
const SESSION_HOURS = 8;

// Хеш-пустышка: при несуществующем email всё равно тратим время на bcrypt,
// чтобы по времени ответа нельзя было подобрать существующие адреса
const DUMMY_HASH = bcrypt.hashSync("timing-equalizer", 10);

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: SessionUser;
  }
}

const loginSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(1).max(200),
});

export function authRouter(db: DB, jwtSecret: string, secureCookies: boolean): Router {
  const router = Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "too_many_attempts", message: "Слишком много попыток входа. Подождите 15 минут." },
  });

  router.post("/login", loginLimiter, async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = db
      .prepare("SELECT id, email, name, role, password_hash FROM users WHERE email = ?")
      .get(email.toLowerCase()) as (SessionUser & { password_hash: string }) | undefined;

    const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) throw new AppError(401, "invalid_credentials", "Неверный email или пароль");

    const token = jwt.sign({ sub: String(user.id), role: user.role }, jwtSecret, {
      algorithm: "HS256",
      expiresIn: `${SESSION_HOURS}h`,
    });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "strict",
      maxAge: SESSION_HOURS * 3600_000,
      path: "/api",
    });
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  });

  router.post("/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: "/api" });
    res.status(204).end();
  });

  router.get("/me", requireAuth(db, jwtSecret), (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}

export function requireAuth(db: DB, jwtSecret: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!token) return next(new AppError(401, "unauthorized", "Требуется вход"));
    try {
      const payload = jwt.verify(token, jwtSecret, { algorithms: ["HS256"] }) as jwt.JwtPayload;
      // Пользователя читаем из БД на каждый запрос: удалённый сотрудник теряет доступ сразу
      const user = db
        .prepare("SELECT id, email, name, role FROM users WHERE id = ?")
        .get(Number(payload.sub)) as SessionUser | undefined;
      if (!user) return next(new AppError(401, "unauthorized", "Требуется вход"));
      req.user = user;
      next();
    } catch {
      next(new AppError(401, "unauthorized", "Сессия истекла, войдите заново"));
    }
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError(403, "forbidden", "Недостаточно прав"));
    }
    next();
  };
}

export async function createUser(db: DB, email: string, name: string, password: string, role: Role) {
  const hash = await bcrypt.hash(password, 12);
  db.prepare(
    `INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET name = excluded.name, password_hash = excluded.password_hash, role = excluded.role`,
  ).run(email.toLowerCase(), name, hash, role);
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { Env } from '../../../config/env.schema';
import { PrismaService } from '../../../infra/prisma/prisma.service';

const SALT_ROUNDS = 10;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async issue(payload: JwtPayload) {
    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: '1d',
    });

    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

    const refreshToken = this.jwt.sign(
      { sub: payload.sub, sessionId },
      {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        expiresIn: '7d',
      },
    );

    const hashedToken = await bcrypt.hash(refreshToken, SALT_ROUNDS);

    await this.prisma.session.create({
      data: { id: sessionId, userId: payload.sub, hashedToken, expiresAt },
    });

    return { accessToken, refreshToken };
  }
}

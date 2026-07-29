import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import * as bcrypt from 'bcrypt';
import { Request } from 'express';
import { Env } from '../../config/env.schema';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { JwtPayload } from './jwt-access.strategy';

export interface RefreshContext extends JwtPayload {
  sessionId: string;
}

interface RefreshTokenPayload {
  sub: string;
  sessionId: string;
}

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_REFRESH_SECRET', { infer: true }),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: RefreshTokenPayload): Promise<RefreshContext> {
    const refreshToken = req.headers['authorization']?.split(' ')[1];
    if (!refreshToken) throw new UnauthorizedException();

    const session = await this.prisma.session.findUnique({ where: { id: payload.sessionId } });
    if (!session || session.userId !== payload.sub) throw new UnauthorizedException();
    if (session.expiresAt < new Date()) throw new UnauthorizedException('Session expired');

    const matches = await bcrypt.compare(refreshToken, session.hashedToken);
    if (!matches) throw new UnauthorizedException();

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { email: true, type: true, agencyId: true },
    });
    if (!user) throw new UnauthorizedException();

    return {
      sub: payload.sub,
      email: user.email,
      role: user.type,
      agencyId: user.agencyId ?? '',
      sessionId: session.id,
    };
  }
}

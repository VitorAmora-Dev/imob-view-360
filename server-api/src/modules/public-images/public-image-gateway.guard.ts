import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Request, Response } from 'express';
import { Env } from '../../config/env.schema';

@Injectable()
export class PublicImageGatewayGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    http.getResponse<Response>().setHeader('Cache-Control', 'no-store');
    const segredo = this.config.get('PUBLIC_IMAGE_GATEWAY_SECRET', {
      infer: true,
    });
    const authorization = http.getRequest<Request>().headers.authorization;
    const recebido = authorization?.match(
      /^Bearer ([A-Za-z0-9+/_=-]{32,256})$/i,
    )?.[1];
    if (
      !segredo ||
      !recebido ||
      !timingSafeEqual(
        createHash('sha256').update(segredo).digest(),
        createHash('sha256').update(recebido).digest(),
      )
    )
      throw new UnauthorizedException();
    return true;
  }
}

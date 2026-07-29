import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../strategies/jwt-access.strategy';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    return ctx.switchToHttp().getRequest().user;
  },
);

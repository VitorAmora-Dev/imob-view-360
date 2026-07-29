import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { JwtPayload } from '../strategies/jwt-access.strategy';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user: JwtPayload = context.switchToHttp().getRequest().user;
    if (user?.role !== 'ADMINISTRATOR') throw new ForbiddenException();
    return true;
  }
}

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtAccessStrategy } from '../../common/strategies/jwt-access.strategy';
import { JwtRefreshStrategy } from '../../common/strategies/jwt-refresh.strategy';
import { TokenService } from './services/token.service';
import { SignupService } from './services/signup.service';
import { SigninService } from './services/signin.service';
import { RefreshService } from './services/refresh.service';
import { SignupController } from './controllers/signup.controller';
import { SigninController } from './controllers/signin.controller';
import { RefreshController } from './controllers/refresh.controller';
import { MeController } from './controllers/me.controller';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [SignupController, SigninController, RefreshController, MeController],
  providers: [TokenService, SignupService, SigninService, RefreshService, JwtAccessStrategy, JwtRefreshStrategy],
})
export class AuthModule {}

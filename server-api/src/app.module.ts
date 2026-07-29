import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ApiThrottlerGuard } from './common/guards/throttler.guard';
import { validateEnv } from './config/env.schema';
import { GLOBAL_THROTTLE } from './config/throttle.config';
import { PrismaModule } from './infra/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { PropertiesModule } from './modules/properties/properties.module';
import { VirtualToursModule } from './modules/virtual-tours/virtual-tours.module';
import { PanoramasModule } from './modules/panoramas/panoramas.module';
import { HotspotsModule } from './modules/hotspots/hotspots.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([GLOBAL_THROTTLE]),
    PrismaModule,
    AuthModule,
    UsersModule,
    PropertiesModule,
    VirtualToursModule,
    PanoramasModule,
    HotspotsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ApiThrottlerGuard }],
})
export class AppModule {}

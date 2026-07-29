import { Module } from '@nestjs/common';
import { CreateUserController } from './controllers/create-user.controller';
import { UpdateUserController } from './controllers/update-user.controller';
import { ListUsersController } from './controllers/list-users.controller';
import { FindUserController } from './controllers/find-user.controller';
import { CreateUserService } from './services/create-user.service';
import { UpdateUserService } from './services/update-user.service';
import { ListUsersService } from './services/list-users.service';
import { FindUserService } from './services/find-user.service';

@Module({
  controllers: [CreateUserController, UpdateUserController, ListUsersController, FindUserController],
  providers: [CreateUserService, UpdateUserService, ListUsersService, FindUserService],
})
export class UsersModule {}

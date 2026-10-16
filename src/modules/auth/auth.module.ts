import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthCookiesService } from './auth-cookies.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [JwtModule.register({ global: true })],
  controllers: [AuthController],
  providers: [AuthService, AuthCookiesService],
  exports: [AuthCookiesService],
})
export class AuthModule {}

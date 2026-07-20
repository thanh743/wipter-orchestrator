import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class BasicAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext) {
    const username = this.config.get<string>('BASIC_AUTH_USER');
    const password = this.config.get<string>('BASIC_AUTH_PASSWORD');
    if (!username || !password) return true;

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const header = request.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    const decoded = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '';
    const separator = decoded.indexOf(':');
    const requestUser = separator >= 0 ? decoded.slice(0, separator) : '';
    const requestPass = separator >= 0 ? decoded.slice(separator + 1) : '';

    if (safeEqual(requestUser, username) && safeEqual(requestPass, password)) return true;

    response.setHeader('WWW-Authenticate', 'Basic realm="Wipter Orchestrator"');
    response.status(401).send('Unauthorized');
    return false;
  }
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

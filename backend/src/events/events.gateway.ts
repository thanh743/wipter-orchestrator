import { timingSafeEqual } from 'crypto';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',').map((origin) => origin.trim()).filter(Boolean)
      ?? ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    const username = process.env.BASIC_AUTH_USER;
    const password = process.env.BASIC_AUTH_PASSWORD;
    if (!username || !password) return;

    const header = client.handshake.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    const decoded = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '';
    const separator = decoded.indexOf(':');
    const requestUser = separator >= 0 ? decoded.slice(0, separator) : '';
    const requestPass = separator >= 0 ? decoded.slice(separator + 1) : '';
    if (!safeEqual(requestUser, username) || !safeEqual(requestPass, password)) {
      client.disconnect(true);
    }
  }

  emitRefresh() {
    this.server?.emit('refresh', { at: new Date().toISOString() });
  }
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

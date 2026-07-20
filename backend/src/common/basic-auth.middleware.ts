import { timingSafeEqual } from 'crypto';

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function basicAuthMiddleware(username: string, password: string) {
  return (req: any, res: any, next: () => void) => {
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme !== 'Basic' || !encoded) {
      return unauthorized(res);
    }

    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const requestUser = separator >= 0 ? decoded.slice(0, separator) : '';
    const requestPass = separator >= 0 ? decoded.slice(separator + 1) : '';

    if (safeEqual(requestUser, username) && safeEqual(requestPass, password)) {
      return next();
    }

    return unauthorized(res);
  };
}

function unauthorized(res: any) {
  res.setHeader('WWW-Authenticate', 'Basic realm="Wipter Orchestrator"');
  return res.status(401).send('Unauthorized');
}

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'crypto';

const PREFIX_V1 = 'enc:v1:';
const PREFIX_V2 = 'enc:v2:';

function legacyKeyFromSecret(secret: string) {
  return createHash('sha256').update(secret).digest();
}

function keyFromSecret(secret: string, salt: Buffer) {
  return scryptSync(secret, salt, 32);
}

export function encryptSecret(value: string | undefined, secret: string) {
  if (!value || value.startsWith(PREFIX_V1) || value.startsWith(PREFIX_V2) || !secret || secret.startsWith('change-me')) return value;
  const iv = randomBytes(12);
  const salt = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', keyFromSecret(secret, salt), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX_V2}${Buffer.concat([salt, iv, tag, encrypted]).toString('base64')}`;
}

export function decryptSecret(value: string | undefined, secret: string) {
  if (!value) return value;
  if (value.startsWith(PREFIX_V2)) {
    const raw = Buffer.from(value.slice(PREFIX_V2.length), 'base64');
    const salt = raw.subarray(0, 16);
    const iv = raw.subarray(16, 28);
    const tag = raw.subarray(28, 44);
    const encrypted = raw.subarray(44);
    const decipher = createDecipheriv('aes-256-gcm', keyFromSecret(secret, salt), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }
  if (!value.startsWith(PREFIX_V1)) return value;
  const raw = Buffer.from(value.slice(PREFIX_V1.length), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', legacyKeyFromSecret(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

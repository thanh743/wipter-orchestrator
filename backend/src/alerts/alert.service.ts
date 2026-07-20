import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  private readonly sentAt = new Map<string, number>();

  constructor(private readonly config: ConfigService) {}

  async send(message: string) {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    const chatId = this.config.get<string>('TELEGRAM_CHAT_ID');
    if (!token || !chatId) return;

    const dedupeMs = Number(this.config.get('ALERT_DEDUPE_MS', 10 * 60 * 1000));
    const now = Date.now();
    const lastSentAt = this.sentAt.get(message) ?? 0;
    if (dedupeMs > 0 && now - lastSentAt < dedupeMs) return;
    this.sentAt.set(message, now);

    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message }),
      });
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : 'Telegram alert failed');
    }
  }
}

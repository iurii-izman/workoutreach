import { asSafeResult, SafeStop } from '../n8n/code/lib/errors.mjs';
import { createTelegramClient, parseIdAllowlist } from '../n8n/code/lib/telegram-api.mjs';

const commands = [
  { command: 'start', description: 'Начать работу' },
  { command: 'help', description: 'Как пользоваться ботом' },
  { command: 'status', description: 'Статус и безопасность' },
  { command: 'version', description: 'Версия рабочего контура' },
];
const name = 'Workoutreach · Bitrix24';
const description = 'Пришлите публичный URL сайта компании. Я найду опубликованный контакт, проверяемый факт и подготовлю персонализированный карьерный email для ручной проверки. Email-отправка на текущем этапе отключена.';
const shortDescription = 'Проверяемый карьерный outreach для интеграторов Bitrix24 — только с human review.';

try {
  if ((process.env.MAIL_TRANSPORT ?? 'disabled') !== 'disabled' || process.env.LIVE_SEND_ENABLED?.toLowerCase() === 'true') {
    throw new SafeStop('LIVE_SEND_BLOCKED', 'Bot profile cannot be configured while mail sending is enabled');
  }
  const allowedChatIds = parseIdAllowlist(process.env.ALLOWED_TELEGRAM_CHAT_IDS);
  const client = createTelegramClient({ botToken: process.env.TELEGRAM_BOT_TOKEN, allowedChatIds });
  const webhook = await client.call('getWebhookInfo');
  if (webhook.url) throw new SafeStop('TELEGRAM_WEBHOOK_CONFLICT', 'A webhook is already configured; guarded polling setup was not applied');

  await client.call('setMyCommands', { commands });
  await client.call('setMyCommands', { commands, language_code: 'ru' });
  await client.call('setMyName', { name });
  await client.call('setMyName', { name, language_code: 'ru' });
  await client.call('setMyDescription', { description });
  await client.call('setMyDescription', { description, language_code: 'ru' });
  await client.call('setMyShortDescription', { short_description: shortDescription });
  await client.call('setMyShortDescription', { short_description: shortDescription, language_code: 'ru' });
  await client.call('setChatMenuButton', { menu_button: { type: 'commands' } });

  const [configuredCommands, configuredDescription, configuredShortDescription, menuButton] = await Promise.all([
    client.call('getMyCommands', { language_code: 'ru' }),
    client.call('getMyDescription', { language_code: 'ru' }),
    client.call('getMyShortDescription', { language_code: 'ru' }),
    client.call('getChatMenuButton'),
  ]);
  console.log(JSON.stringify({
    ok: true,
    bot_profile: {
      name,
      command_count: configuredCommands.length,
      commands: configuredCommands.map(({ command }) => command),
      description_configured: configuredDescription.description === description,
      short_description_configured: configuredShortDescription.short_description === shortDescription,
      menu_button: menuButton.type,
    },
    mode: 'allowlisted-long-polling',
    mail_transport: 'disabled',
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify(asSafeResult(error), null, 2));
  process.exit(1);
}

#!/bin/sh
set -eu

read_secret() {
  variable="$1"
  path="$2"
  value="$(cat "$path")"
  export "$variable=$value"
}

read_secret OPENAI_API_KEY /run/secrets/openai_api_key
read_secret TELEGRAM_BOT_TOKEN /run/secrets/telegram_bot_token
read_secret WORKOUTREACH_DB_PASSWORD /run/secrets/business_db_password
read_secret SUPPRESSION_HMAC_KEY /run/secrets/suppression_hmac_key
read_secret ALLOWED_TELEGRAM_USER_IDS /run/secrets/telegram_allowed_user_ids
read_secret ALLOWED_TELEGRAM_CHAT_IDS /run/secrets/telegram_allowed_chat_ids
read_secret CV_ATTACHMENT_SHA256 /run/secrets/cv_attachment_sha256

export CV_ATTACHMENT_PATH=/run/workoutreach/cv/Iurii_Izman_CV_Bitrix24_AI.pdf
export CV_ATTACHMENT_FILENAME=Iurii_Izman_CV_Bitrix24_AI.pdf

exec node scripts/telegram-bot.mjs

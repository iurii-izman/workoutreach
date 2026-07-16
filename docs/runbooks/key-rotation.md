# Key rotation

No production keys are present in stages 0–1.

For later stages, rotate one secret class at a time: Telegram test/prod tokens, OpenAI key, database passwords, approval/suppression HMAC keys, webhook signing secrets, mailbox OAuth credentials and n8n encryption key. Use the provider's revocation procedure, update the protected secret store, restart the minimum affected service, run a non-sending health check, then revoke the previous credential.

The n8n encryption key requires the official n8n rotation procedure and a verified backup. Never replace it by editing a Code node, workflow export or tracked env file.

import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1–65535 的整数');
const { server } = await createApp();
server.listen(port, host, () => {
  process.stdout.write(`Haidou server listening on ${host}:${port}\n`);
});

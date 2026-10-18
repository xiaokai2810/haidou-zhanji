import { mkdir, readdir, readFile, rename, unlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const WAITING_TTL = 2 * 60 * 60 * 1000;
const ACTIVE_TTL = 24 * 60 * 60 * 1000;
const FINISHED_TTL = 24 * 60 * 60 * 1000;

export class RoomStore {
  constructor(directory, now = () => Date.now()) {
    this.directory = directory;
    this.now = now;
    this.rooms = new Map();
    this.queues = new Map();
    this.createQueue = Promise.resolve();
  }

  expired(room) {
    const ttl = room.status === 'waiting' ? WAITING_TTL : room.status === 'finished' ? FINISHED_TTL : ACTIVE_TTL;
    return this.now() - room.updatedAt > ttl;
  }

  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const files = await readdir(this.directory);
    for (const file of files) {
      if (!/^[A-Z2-9]{7}\.json$/.test(file)) continue;
      try {
        const room = JSON.parse(await readFile(join(this.directory, file), 'utf8'));
        if (room.code !== file.slice(0, 7) || room.version !== 1) continue;
        if (this.expired(room)) await unlink(join(this.directory, file));
        else this.rooms.set(room.code, room);
      } catch {
        // A damaged record is left on disk for operator inspection, not loaded.
      }
    }
  }

  generateCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 100; attempt++) {
      const bytes = randomBytes(7);
      const code = [...bytes].map(byte => alphabet[byte % alphabet.length]).join('');
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('暂时无法生成房间码');
  }

  get(code) {
    const room = this.rooms.get(code);
    if (!room || this.expired(room)) return null;
    return room;
  }

  activeCount() {
    let count = 0;
    for (const room of this.rooms.values()) if (!this.expired(room) && room.status !== 'finished') count++;
    return count;
  }

  async save(room) {
    const target = join(this.directory, `${room.code}.json`);
    const temporary = join(this.directory, `.${room.code}.${randomBytes(8).toString('hex')}.tmp`);
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(room));
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temporary, target);
      // File and rename are durable across normal process restarts. Directory
      // sync is best effort because some filesystems do not permit it.
      try {
        const directoryHandle = await open(this.directory, 'r');
        await directoryHandle.sync();
        await directoryHandle.close();
      } catch { /* best effort */ }
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await unlink(temporary).catch(() => {});
      throw error;
    }
    this.rooms.set(room.code, room);
  }

  async create(factory, guard = () => {}, committed = () => {}) {
    // Serialize allocation so parallel requests cannot bypass the room cap or
    // per-IP quota before the first write has completed.
    const current = this.createQueue.catch(() => {}).then(async () => {
      await this.cleanup();
      guard();
      const code = this.generateCode();
      const room = factory(code);
      await this.save(room);
      committed(room);
      return room;
    });
    this.createQueue = current;
    return current;
  }

  async transact(code, update) {
    const previous = this.queues.get(code) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      const room = this.get(code);
      if (!room) return null;
      const next = update(room);
      await this.save(next);
      return next;
    });
    this.queues.set(code, current);
    try { return await current; }
    finally { if (this.queues.get(code) === current) this.queues.delete(code); }
  }

  async cleanup() {
    for (const [code, room] of this.rooms) {
      if (!this.expired(room)) continue;
      // Avoid racing an in-flight action for this room.
      if (this.queues.has(code)) continue;
      this.rooms.delete(code);
      await unlink(join(this.directory, `${code}.json`)).catch(() => {});
    }
  }
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRedis } from './redis.js';

/*
 * Простое key-value хранилище для данных пользователей (избранное, подписки,
 * блок-лист) и статистики канала. Значения — любые JSON-данные.
 *
 *   get(key) → value | null
 *   set(key, value, { ttlSeconds })
 *   del(key)
 */

/** Всё в одном JSON-файле — для постоянно работающего сервера. */
export class FileStore {
    constructor(file) {
        this.file = file;
        this.data = {};
        this.writing = Promise.resolve();
    }

    async load() {
        try {
            this.data = JSON.parse(await fs.readFile(this.file, 'utf8')) || {};
        } catch {
            this.data = {};
        }
        const now = Date.now();
        for (const [key, entry] of Object.entries(this.data)) {
            if (entry?.exp && entry.exp < now) delete this.data[key];
        }
    }

    async get(key) {
        const entry = this.data[key];
        if (!entry) return null;
        if (entry.exp && entry.exp < Date.now()) {
            delete this.data[key];
            return null;
        }
        return structuredClone(entry.v);
    }

    async set(key, value, { ttlSeconds } = {}) {
        this.data[key] = { v: structuredClone(value), ...(ttlSeconds ? { exp: Date.now() + ttlSeconds * 1000 } : {}) };
        return this.save();
    }

    async del(key) {
        delete this.data[key];
        return this.save();
    }

    save() {
        this.writing = this.writing
            .then(async () => {
                await fs.mkdir(path.dirname(this.file), { recursive: true });
                const tmp = `${this.file}.tmp`;
                await fs.writeFile(tmp, JSON.stringify(this.data));
                await fs.rename(tmp, this.file);
            })
            .catch(error => console.error('⚠️ Не удалось сохранить данные:', error.message));
        return this.writing;
    }
}

/** Upstash Redis — для Vercel. */
export class RedisStore {
    constructor({ url, token, prefix = 'danbooru:' }) {
        this.command = createRedis({ url, token });
        this.prefix = prefix;
    }

    async load() {}

    async get(key) {
        const raw = await this.command('GET', this.prefix + key);
        if (raw == null) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    async set(key, value, { ttlSeconds } = {}) {
        const args = ['SET', this.prefix + key, JSON.stringify(value)];
        if (ttlSeconds) args.push('EX', ttlSeconds);
        await this.command(...args);
    }

    async del(key) {
        await this.command('DEL', this.prefix + key);
    }
}

/** В памяти — для тестов и как запасной вариант. */
export class MemoryStore {
    constructor() {
        this.data = new Map();
    }

    async load() {}

    async get(key) {
        const entry = this.data.get(key);
        if (!entry) return null;
        if (entry.exp && entry.exp < Date.now()) {
            this.data.delete(key);
            return null;
        }
        return structuredClone(entry.v);
    }

    async set(key, value, { ttlSeconds } = {}) {
        this.data.set(key, { v: structuredClone(value), exp: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0 });
    }

    async del(key) {
        this.data.delete(key);
    }
}

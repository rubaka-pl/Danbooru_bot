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

/**
 * Кэш в памяти поверх медленного хранилища (Redis) для постоянно работающего сервера:
 * чтения — из памяти, записи — пачкой раз в flushMs. Экономит команды бесплатного Upstash.
 * В serverless не используется: там несколько инстансов и кэш был бы несогласованным.
 */
export class CachedStore {
    constructor(inner, { flushMs = 30_000 } = {}) {
        this.inner = inner;
        this.flushMs = flushMs;
        this.cache = new Map();
        this.dirty = new Set();
        this.timer = null;
    }

    async load() {
        await this.inner.load();
    }

    async get(key) {
        const entry = this.cache.get(key);
        if (entry) {
            if (entry.exp && entry.exp < Date.now()) {
                this.cache.delete(key);
                return null;
            }
            return structuredClone(entry.v);
        }
        const value = await this.inner.get(key);
        this.cache.set(key, { v: value, exp: 0 });
        return structuredClone(value);
    }

    async set(key, value, { ttlSeconds } = {}) {
        this.cache.set(key, { v: structuredClone(value), exp: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0 });
        this.dirty.add(key);
        this.schedule();
    }

    async del(key) {
        this.cache.set(key, { v: null, exp: 0 });
        this.dirty.delete(key);
        await this.inner.del(key);
    }

    schedule() {
        if (this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.save().catch(error => console.error('⚠️ Не удалось сохранить данные:', error.message));
        }, this.flushMs);
        this.timer.unref?.();
    }

    /** Записывает накопленные изменения. */
    async save() {
        const keys = [...this.dirty];
        this.dirty.clear();
        for (const key of keys) {
            const entry = this.cache.get(key);
            if (!entry) continue;
            const ttlSeconds = entry.exp ? Math.max(1, Math.ceil((entry.exp - Date.now()) / 1000)) : undefined;
            try {
                await this.inner.set(key, entry.v, { ttlSeconds });
            } catch (error) {
                this.dirty.add(key); // попробуем в следующий раз
                throw error;
            }
        }
    }
}

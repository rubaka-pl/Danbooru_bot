import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * История отправленных в канал картинок (md5) в JSON-файле.
 * Подходит для постоянно работающего сервера (Render, VPS).
 */
export class FileHistory {
    constructor(file, limit = 5000) {
        this.file = file;
        this.limit = limit;
        this.items = new Set();
        this.writing = Promise.resolve();
    }

    async load() {
        try {
            const data = JSON.parse(await fs.readFile(this.file, 'utf8'));
            if (Array.isArray(data)) data.slice(-this.limit).forEach(md5 => this.items.add(md5));
            console.log(`📚 История загружена: ${this.items.size} записей`);
        } catch {
            console.log('📚 История пуста — создаю новую');
        }
    }

    async has(md5) {
        return this.items.has(md5);
    }

    async add(md5) {
        if (!md5) return;
        this.items.delete(md5);
        this.items.add(md5);
        while (this.items.size > this.limit) {
            this.items.delete(this.items.values().next().value);
        }
        await this.save();
    }

    // Записи выполняются последовательно, чтобы файл не побился.
    save() {
        this.writing = this.writing
            .then(async () => {
                await fs.mkdir(path.dirname(this.file), { recursive: true });
                const tmp = `${this.file}.tmp`;
                await fs.writeFile(tmp, JSON.stringify([...this.items]));
                await fs.rename(tmp, this.file);
            })
            .catch(error => console.error('⚠️ Не удалось сохранить историю:', error.message));
        return this.writing;
    }
}

/**
 * История в Upstash Redis (REST API) — для serverless (Vercel), где нет диска.
 * Каждая запись живёт ttlDays дней.
 */
export class RedisHistory {
    constructor({ url, token, prefix = 'danbooru:sent:', ttlDays = 90 }) {
        this.url = url.replace(/\/$/, '');
        this.token = token;
        this.prefix = prefix;
        this.ttl = ttlDays * 24 * 60 * 60;
    }

    async load() {}

    async command(...args) {
        const res = await fetch(this.url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(args),
            signal: AbortSignal.timeout(5000)
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.error) throw new Error(body.error || `Redis HTTP ${res.status}`);
        return body.result;
    }

    async has(md5) {
        try {
            return (await this.command('EXISTS', this.prefix + md5)) === 1;
        } catch (error) {
            console.error('⚠️ Redis:', error.message);
            return false;
        }
    }

    async add(md5) {
        if (!md5) return;
        try {
            await this.command('SET', this.prefix + md5, '1', 'EX', String(this.ttl));
        } catch (error) {
            console.error('⚠️ Redis:', error.message);
        }
    }
}

/** Память без сохранения — запасной вариант. */
export class MemoryHistory {
    constructor(limit = 5000) {
        this.limit = limit;
        this.items = new Set();
    }

    async load() {}

    async has(md5) {
        return this.items.has(md5);
    }

    async add(md5) {
        this.items.add(md5);
        if (this.items.size > this.limit) this.items.delete(this.items.values().next().value);
    }
}

const toMinutes = (hhmm) => {
    const [h, m = '0'] = String(hhmm).split(':');
    return Number(h) * 60 + Number(m);
};

/** Минуты с начала суток в заданном часовом поясе. */
export function minutesInZone(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date);
    const get = (type) => Number(parts.find(p => p.type === type)?.value ?? 0);
    return get('hour') * 60 + get('minute');
}

/**
 * Попадает ли момент в "тихие часы" (интервал может переходить через полночь,
 * например 23:30–06:00).
 */
export function isQuietTime(date, { start, end, timeZone }) {
    if (!start || !end) return false;
    const now = minutesInZone(date, timeZone);
    const from = toMinutes(start);
    const to = toMinutes(end);
    if (from === to) return false;
    return from < to ? now >= from && now < to : now >= from || now < to;
}

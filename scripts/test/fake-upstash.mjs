import http from 'node:http';

const portArg = process.argv.indexOf('--port');
const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 43129;
const store = new Map();

function now() { return Date.now(); }
function getEntry(key) {
  const entry = store.get(String(key));
  if (entry?.expiresAt && entry.expiresAt <= now()) {
    store.delete(String(key));
    return undefined;
  }
  return entry;
}
function setString(key, value, ttlMs) {
  store.set(String(key), { type: 'string', value: String(value), expiresAt: ttlMs ? now() + ttlMs : null });
}
function wildcard(pattern) {
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.');
  return new RegExp(`^${escaped}$`);
}
function liveKeys(pattern = '*') {
  const re = wildcard(pattern);
  return [...store.keys()].filter((key) => getEntry(key) && re.test(key));
}
function encode(value) {
  if (typeof value === 'string' && value !== 'OK') return Buffer.from(value).toString('base64');
  if (Array.isArray(value)) return value.map(encode);
  return value;
}
function numberAt(key) {
  const entry = getEntry(key);
  return entry ? Number(entry.value) || 0 : 0;
}

function runEval(command) {
  const script = String(command[1]);
  const keyCount = Number(command[2]);
  const keys = command.slice(3, 3 + keyCount).map(String);
  const args = command.slice(3 + keyCount);

  if (script.includes("local pattern = KEYS[1]")) {
    for (const key of liveKeys(keys[0])) store.delete(key);
    return null;
  }

  if (script.includes('local currentKey') && script.includes('local previousKey')) {
    const [currentKey, previousKey] = keys;
    const limit = Number(args[0]);
    const timestamp = Number(args[1]);
    const windowMs = Number(args[2]);
    const current = numberAt(currentKey);
    const previous = Math.floor((1 - ((timestamp % windowMs) / windowMs)) * numberAt(previousKey));

    if (script.includes('local incrementBy')) {
      const increment = Number(args[3]);
      if (increment > 0 && current + previous >= limit) return [-1, limit];
      const next = current + increment;
      setString(currentKey, next, windowMs * 2 + 1000);
      return [limit - (next + previous), limit];
    }
    return [limit - (current + previous), limit];
  }

  throw new Error('Desteklenmeyen test Lua betiği');
}

function run(command) {
  const [rawName, ...args] = command;
  const name = String(rawName).toLowerCase();

  if (name === 'evalsha' || name === 'evalsha_ro') {
    return { error: 'NOSCRIPT No matching script. Please use EVAL.' };
  }
  if (name === 'eval' || name === 'eval_ro') return { result: runEval(command) };
  if (name === 'get' || name === 'getdel') {
    const key = String(args[0]);
    const entry = getEntry(key);
    const value = entry?.type === 'string' ? entry.value : null;
    if (name === 'getdel') store.delete(key);
    return { result: value };
  }
  if (name === 'set') {
    const key = String(args[0]);
    const old = getEntry(key);
    const opts = args.slice(2).map((value) => String(value).toLowerCase());
    if (opts.includes('nx') && old) return { result: null };
    if (opts.includes('xx') && !old) return { result: null };
    let ttlMs = null;
    const ex = opts.indexOf('ex');
    const px = opts.indexOf('px');
    if (ex >= 0) ttlMs = Number(args[2 + ex + 1]) * 1000;
    if (px >= 0) ttlMs = Number(args[2 + px + 1]);
    setString(key, args[1], ttlMs);
    return { result: opts.includes('get') ? old?.value ?? null : 'OK' };
  }
  if (name === 'del') {
    let count = 0;
    for (const key of args) if (store.delete(String(key))) count++;
    return { result: count };
  }
  if (name === 'exists') return { result: args.filter((key) => getEntry(String(key))).length };
  if (name === 'incr' || name === 'incrby') {
    const key = String(args[0]);
    const value = numberAt(key) + (name === 'incr' ? 1 : Number(args[1]));
    setString(key, value, null);
    return { result: value };
  }
  if (name === 'expire' || name === 'pexpire') {
    const entry = getEntry(String(args[0]));
    if (!entry) return { result: 0 };
    entry.expiresAt = now() + Number(args[1]) * (name === 'expire' ? 1000 : 1);
    return { result: 1 };
  }
  if (['sadd', 'srem', 'sismember', 'smembers', 'scard'].includes(name)) {
    const key = String(args[0]);
    let entry = getEntry(key);
    if (!entry && name === 'sadd') {
      entry = { type: 'set', value: new Set(), expiresAt: null };
      store.set(key, entry);
    }
    const values = entry?.type === 'set' ? entry.value : new Set();
    if (name === 'sadd') {
      let added = 0;
      for (const value of args.slice(1).map(String)) if (!values.has(value)) { values.add(value); added++; }
      return { result: added };
    }
    if (name === 'srem') {
      let removed = 0;
      for (const value of args.slice(1).map(String)) if (values.delete(value)) removed++;
      return { result: removed };
    }
    if (name === 'sismember') return { result: values.has(String(args[1])) ? 1 : 0 };
    if (name === 'smembers') return { result: [...values] };
    return { result: values.size };
  }
  if (name === 'keys') return { result: liveKeys(args[0]) };
  if (name === 'scan') {
    const lower = args.map((value) => String(value).toLowerCase());
    const matchIndex = lower.indexOf('match');
    const pattern = matchIndex >= 0 ? args[matchIndex + 1] : '*';
    return { result: ['0', liveKeys(pattern)] };
  }
  if (name === 'flushdb') {
    store.clear();
    return { result: 'OK' };
  }
  return { error: `Fake Upstash desteklemiyor: ${name}` };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const commands = req.url?.includes('pipeline') ? body : [body];
    const results = commands.map((command) => {
      try { return run(command); } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
    }).map(({ result, error }) => error ? { error } : { result: encode(result) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url?.includes('pipeline') ? results : results[0]));
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

server.listen(port, '127.0.0.1', () => console.log(`[fake-upstash] 127.0.0.1:${port}`));

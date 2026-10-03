// Set RELAY_SECRET as a Worker secret; never put the pairing key in source.
const EXPIRED = 604800;
const reply = (body, status = 200) => Response.json(body, {status});

export default {
  async fetch(request, env) {
    if (!env.RELAY_SECRET ||
        request.headers.get('Authorization') !== `Bearer ${env.RELAY_SECRET}`) {
      return reply({error: 'unauthorized'}, 401);
    }
    const url = new URL(request.url);
    const kv = env.RELAY_KV;
    if (request.method === 'GET' && url.pathname === '/poll') {
      const since = Number(url.searchParams.get('since') || 0);
      if (!Number.isSafeInteger(since) || since < 0) return reply({error: 'cursor'}, 400);
      const q = await kv.get('q', 'json') || [];
      return reply({commands: q.filter(c => c.i > since),
        cursor: q.length ? q[q.length - 1].i : since});
    }
    if (request.method === 'GET' && url.pathname === '/inbox') {
      // Phone-initiated messages (bubble replies, STOP) land here via /res
      // but are never in the agent's outstanding-command map, so the agent
      // polls this index instead of guessing result ids.
      const idx = await kv.get('rindex', 'json') || [];
      return reply({results: idx});
    }
    if (request.method === 'GET' && url.pathname === '/result') {
      const id = url.searchParams.get('id');
      if (!id) return reply({error: 'id'}, 400);
      const blob = await kv.get(`r:${id}`);
      return blob === null ? reply({error: 'missing'}, 404) : reply({blob});
    }
    if (request.method === 'POST' && ['/cmd', '/res'].includes(url.pathname)) {
      let body;
      try { body = await request.json(); }
      catch { return reply({error: 'json'}, 400); }
      if (!body || typeof body.id !== 'string' || !body.id ||
          typeof body.blob !== 'string') return reply({error: 'envelope'}, 400);
      if (url.pathname === '/res') {
        await kv.put(`r:${body.id}`, body.blob, {expirationTtl: EXPIRED});
        const idx = await kv.get('rindex', 'json') || [];
        idx.unshift({id: body.id, ts: Date.now()});
        await kv.put('rindex', JSON.stringify(idx.slice(0, 100)),
          {expirationTtl: EXPIRED});
      } else {
        const q = await kv.get('q', 'json') || [];
        // Retries must not insert duplicate envelopes.
        if (!q.some(c => c.id === body.id)) {
          const i = Math.max(Date.now(), (q[q.length - 1]?.i || 0) + 1);
          q.push({i, id: body.id, type: body.type, params: body.params, blob: body.blob});
          await kv.put('q', JSON.stringify(q.slice(-200)), {expirationTtl: EXPIRED});
        }
      }
      return reply({ok: true});
    }
    return reply({error: 'not found'}, 404);
  }
};

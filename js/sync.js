// Sincronização offline-first
// Regras:
// - Sempre escreve local primeiro.
// - Se offline, enfileira em syncQueue.
// - Quando volta online, processa fila e reconcilia.
// - Conflitos: last-write-wins por updatedAt.
const Sync = (() => {
  let _busy = false;
  let _scheduled = false;

  function setIndicator(state) {
    const el = document.getElementById('sync-indicator');
    el.classList.remove('offline', 'syncing');
    const label = el.querySelector('.label');
    if (state === 'online') { el.classList.remove('offline','syncing'); label.textContent = 'Online'; }
    else if (state === 'offline') { el.classList.add('offline'); label.textContent = 'Offline'; }
    else if (state === 'syncing') { el.classList.add('syncing'); label.textContent = 'Sincronizando'; }
  }

  // Chamado quando um registro é criado/atualizado localmente
  async function markAndEnqueue(ev, op = 'upsert') {
    ev.syncStatus = 'pending';
    ev.updatedAt = Utils.now();
    await DB.putEvent(ev);
    await DB.enqueue({ op, id: ev.id, ts: Utils.now() });
    schedule();
  }

  async function markDeletedLocal(id) {
    const ev = await DB.getEvent(id);
    if (!ev) return;
    ev.deleted = true;
    ev.syncStatus = 'pending';
    ev.updatedAt = Utils.now();
    await DB.putEvent(ev);
    await DB.enqueue({ op: 'delete', id, ts: Utils.now() });
    schedule();
  }

  function schedule() {
    if (_scheduled) return;
    _scheduled = true;
    setTimeout(() => { _scheduled = false; run(); }, 800);
  }

  async function run() {
    if (_busy) return;
    if (!navigator.onLine) { setIndicator('offline'); return; }
    if (!Firebase.isConfigured() || !Firebase.userId()) { setIndicator('online'); return; }

    _busy = true;
    setIndicator('syncing');
    try {
      // 1) Processa fila local -> Firebase
      const queue = await DB.allQueue();
      // ordena por ts
      queue.sort((a,b) => a.ts - b.ts);
      for (const item of queue) {
        try {
          if (item.op === 'delete') {
            await Firebase.removeEvent(item.id);
          } else {
            const ev = await DB.getEvent(item.id);
            if (ev) await Firebase.pushEvent(ev);
          }
          await DB.dequeue(item.id);
        } catch (err) {
          console.warn('Sync item failed:', err);
          break; // tenta de novo depois
        }
      }

      // 2) Traz remoto -> local (reconciliação last-write-wins)
      const remote = await Firebase.fetchAllRemote();
      for (const r of remote) {
        const local = await DB.getEvent(r.id);
        if (!local) {
          r.syncStatus = 'synced';
          await DB.putEvent(r);
        } else if (r.updatedAt > local.updatedAt) {
          r.syncStatus = 'synced';
          await DB.putEvent(r);
        } else if (r.updatedAt < local.updatedAt) {
          // local é mais recente — empurra de volta
          await Firebase.pushEvent(local);
        }
        // se iguais, nada a fazer
      }

      // marca locais como synced
      const pending = await DB.pendingSyncEvents();
      for (const p of pending) {
        p.syncStatus = 'synced';
        await DB.putEvent(p);
      }

      await DB.setMeta('lastSync', Utils.now());
      setIndicator('online');
      document.dispatchEvent(new Event('sync:done'));
    } catch (err) {
      console.error('Sync error:', err);
      setIndicator(navigator.onLine ? 'online' : 'offline');
    } finally {
      _busy = false;
    }
  }

  function init() {
    window.addEventListener('online', () => { setIndicator('online'); schedule(); });
    window.addEventListener('offline', () => setIndicator('offline'));
    setIndicator(navigator.onLine ? 'online' : 'offline');
    // sincronização periódica suave
    setInterval(() => { if (navigator.onLine) schedule(); }, 60_000);
  }

  return { init, schedule, markAndEnqueue, markDeletedLocal, setIndicator };
})();
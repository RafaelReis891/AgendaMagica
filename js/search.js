// Pesquisa e filtros no IndexedDB
const Search = (() => {
  function normalize(s) {
    return (s || '').toString().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  async function query({ text = '', type = 'all', status = 'all', priority = 'all',
                          dateFrom = null, dateTo = null, limit = 200 } = {}) {
    const userId = Firebase.userId() || 'local';
    let events = await DB.allEvents();
    events = events.filter((e) => e.userId === userId && !e.deleted);

    if (dateFrom) events = events.filter((e) => e.date >= dateFrom);
    if (dateTo)   events = events.filter((e) => e.date <= dateTo);
    if (type !== 'all') events = events.filter((e) => e.type === type);
    if (priority !== 'all') events = events.filter((e) => e.priority === priority);

    if (status === 'done') events = events.filter((e) => e.completed);
    else if (status === 'pending') events = events.filter((e) => !e.completed);
    else if (status === 'late') {
      const nowTs = Utils.now();
      events = events.filter((e) => {
        const ts = Utils.combineDateTime(e.date, e.time);
        return ts && ts < nowTs && !e.completed;
      });
    }

    if (text) {
      const t = normalize(text);
      events = events.filter((e) => {
        const hay = [
          e.title, e.description, e.category,
          (e.tags || []).join(' '),
          (e.checklist || []).map(i => i.text).join(' ')
        ].join(' ');
        return normalize(hay).includes(t);
      });
    }

    events.sort((a,b) => {
      const ta = Utils.combineDateTime(a.date, a.time) || 0;
      const tb = Utils.combineDateTime(b.date, b.time) || 0;
      return ta - tb;
    });

    return events.slice(0, limit);
  }

  return { query };
})();
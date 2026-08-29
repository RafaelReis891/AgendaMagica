// Calendário (mês) com indicadores de eventos
const Calendar = (() => {
  let _cursor = new Date(); // mês em exibição
  let _selected = null;

  function setCursor(d) { _cursor = new Date(d); }
  function getCursor() { return new Date(_cursor); }

  async function render(container, onSelect) {
    container.innerHTML = '';
    container.hidden = false;

    const year = _cursor.getFullYear();
    const month = _cursor.getMonth();
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const startDow = first.getDay(); // 0=dom
    const daysInMonth = last.getDate();

    const header = document.createElement('div');
    header.className = 'cal-header';
    header.innerHTML = `
      <button class="icon-btn" aria-label="Mês anterior">←</button>
      <h3>${first.toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}</h3>
      <button class="icon-btn" aria-label="Próximo mês">→</button>
    `;
    header.children[0].onclick = () => { _cursor.setMonth(_cursor.getMonth()-1); render(container, onSelect); };
    header.children[2].onclick = () => { _cursor.setMonth(_cursor.getMonth()+1); render(container, onSelect); };
    container.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'cal-grid';
    ['D','S','T','Q','Q','S','S'].forEach((d, i) => {
      const el = document.createElement('div');
      el.className = 'cal-dow';
      el.textContent = ['D','S','T','Q','Q','S','S'][i];
      grid.appendChild(el);
    });

    // carrega eventos do mês
    const userId = Firebase.userId() || 'local';
    const startISO = Utils.toISODate(first);
    const endISO = Utils.toISODate(last);
    const events = await DB.eventsByDateRange(startISO, endISO, userId);
    const byDate = {};
    events.forEach((e) => {
      if (!byDate[e.date]) byDate[e.date] = [];
      byDate[e.date].push(e);
    });

    const todayISO = Utils.todayISO();

    // dias anteriores do mês anterior
    for (let i = 0; i < startDow; i++) {
      const d = new Date(year, month, - (startDow - i - 1));
      grid.appendChild(buildDay(d, true, [], todayISO, onSelect));
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month, day);
      const iso = Utils.toISODate(d);
      grid.appendChild(buildDay(d, false, byDate[iso] || [], todayISO, onSelect));
    }
    // completa a última semana
    const totalCells = startDow + daysInMonth;
    const trailing = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= trailing; i++) {
      const d = new Date(year, month + 1, i);
      grid.appendChild(buildDay(d, true, [], todayISO, onSelect));
    }

    container.appendChild(grid);
  }

  function buildDay(d, other, events, todayISO, onSelect) {
    const iso = Utils.toISODate(d);
    const el = document.createElement('div');
    el.className = 'cal-day' + (other ? ' other' : '') + (iso === todayISO ? ' today' : '');
    el.innerHTML = `<span>${d.getDate()}</span>`;
    if (events.length) {
      const dots = document.createElement('div');
      dots.className = 'dots';
      const n = Math.min(events.length, 3);
      for (let i = 0; i < n; i++) dots.appendChild(document.createElement('span'));
      el.appendChild(dots);
    }
    el.onclick = () => { if (onSelect) onSelect(iso); };
    return el;
  }

  return { render, setCursor, getCursor };
})();
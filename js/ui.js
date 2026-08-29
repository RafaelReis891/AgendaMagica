// Renderização da interface — linha do tempo, highlights, modais
const UI = (() => {
  let _currentDate = new Date(); // dia em exibição
  let _currentView = 'today'; // today | calendar | history | search
  let _activeRecordId = null;

  function setCurrentDate(d) { _currentDate = new Date(d); }
  function getCurrentDate() { return new Date(_currentDate); }

  function updateDateHeader() {
    const d = _currentDate;
    document.querySelector('#date-display .weekday').textContent = Utils.formatWeekday(d);
    document.querySelector('#date-display .full-date').textContent = Utils.formatFullDate(d);
  }

  async function renderTimeline() {
    const tl = document.getElementById('timeline');
    tl.innerHTML = '';
    const userId = Firebase.userId() || 'local';
    const iso = Utils.toISODate(_currentDate);
    let events = await DB.eventsByDateRange(iso, iso, userId);

    // aplica filtros
    const type = document.getElementById('filter-type').value;
    const status = document.getElementById('filter-status').value;
    const prio = document.getElementById('filter-priority').value;
    if (type !== 'all') events = events.filter((e) => e.type === type);
    if (prio !== 'all') events = events.filter((e) => e.priority === prio);

    events.sort((a,b) => {
      const ta = Utils.combineDateTime(a.date, a.time) || Infinity;
      const tb = Utils.combineDateTime(b.date, b.time) || Infinity;
      return ta - tb;
    });

    if (status === 'done') events = events.filter(e => e.completed);
    else if (status === 'pending') events = events.filter(e => !e.completed);
    else if (status === 'late') {
      const nowTs = Utils.now();
      events = events.filter(e => {
        const ts = Utils.combineDateTime(e.date, e.time);
        return ts && ts < nowTs && !e.completed;
      });
    }

    if (!events.length) {
      tl.innerHTML = '<div class="tl-empty">Nada agendado para este dia ✨</div>';
      updateSummary([]);
      updateHighlights([]);
      return;
    }

    const nowTs = Utils.now();
    const isToday = iso === Utils.todayISO();

    events.forEach((ev) => {
      const ts = Utils.combineDateTime(ev.date, ev.time);
      let state = 'future';
      if (ev.completed) state = 'done';
      else if (ts && ts < nowTs) state = 'late';
      else if (ts && isToday && Math.abs(ts - nowTs) < 30 * 60_000) state = 'now';

      // Linha do "agora" — inserida antes do primeiro evento futuro
      if (isToday && ts && ts > nowTs && !tl.querySelector('.now-line-inserted')) {
        const line = document.createElement('div');
        line.className = 'now-line';
        line.dataset.time = Utils.formatTimeHM(nowTs);
        tl.appendChild(line);
        tl.appendChild(document.createElement('div')).className = 'now-line-inserted';
      }

      const item = document.createElement('article');
      item.className = 'tl-item';
      item.innerHTML = `
        <div class="tl-time">${ev.time || '—'}</div>
        <div class="tl-dot"></div>
        <div class="tl-card ${state} ${ev.priority === 'high' ? 'high' : ''}" data-id="${ev.id}" tabindex="0" role="button">
          <div class="tl-head">
            <span class="tl-type">${Utils.typeIcon(ev.type)}</span>
            <span class="tl-title ${ev.completed ? 'done' : ''}">${Utils.escapeHTML(ev.title)}</span>
            ${ev.alert ? '<span class="tl-alert" aria-label="Alerta ativo">🔔</span>' : ''}
            ${state === 'late' ? '<span class="tl-late-badge">⚠ Atrasado</span>' : ''}
          </div>
          ${ev.description ? `<div class="tl-desc">${Utils.escapeHTML(ev.description)}</div>` : ''}
          ${renderChecklist(ev)}
          ${(ev.tags && ev.tags.length) ? `<div class="tl-tags">${ev.tags.map(t=>`<span class="tag">#${Utils.escapeHTML(t)}</span>`).join('')}</div>` : ''}
        </div>
      `;
      tl.appendChild(item);
    });

    bindTimelineEvents();
    updateSummary(events);
    updateHighlights(events);
  }

  function renderChecklist(ev) {
    if (ev.type !== 'checklist' || !ev.checklist || !ev.checklist.length) return '';
    return `<div class="tl-checklist">${ev.checklist.map((it, i) => `
      <label>
        <input type="checkbox" data-ev="${ev.id}" data-idx="${i}" ${it.done ? 'checked' : ''} />
        <span style="${it.done ? 'text-decoration:line-through;color:var(--muted)' : ''}">${Utils.escapeHTML(it.text)}</span>
      </label>`).join('')}
    </div>`;
  }

  function bindTimelineEvents() {
    document.querySelectorAll('.tl-card').forEach((card) => {
      let pressTimer;
      const id = card.dataset.id;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.tl-checklist')) return;
        openActions(id);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openActions(id); }
      });
      card.addEventListener('pointerdown', () => {
        pressTimer = setTimeout(() => openActions(id), 500);
      });
      card.addEventListener('pointerup', () => clearTimeout(pressTimer));
      card.addEventListener('pointerleave', () => clearTimeout(pressTimer));
    });

    document.querySelectorAll('.tl-checklist input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', async (e) => {
        const evId = cb.dataset.ev;
        const idx = Number(cb.dataset.idx);
        const ev = await DB.getEvent(evId);
        if (!ev) return;
        ev.checklist[idx].done = cb.checked;
        // se todos marcados, conclui o checklist
        if (ev.checklist.every(i => i.done)) {
          ev.completed = true;
          ev.completedAt = Utils.now();
        }
        await Sync.markAndEnqueue(ev);
        Utils.toast('Checklist atualizado');
        renderTimeline();
      });
    });
  }

  async function updateSummary(events) {
    const total = events.length;
    const done = events.filter(e => e.completed).length;
    const pending = events.filter(e => !e.completed && e.type !== 'note').length;
    const notes = events.filter(e => e.type === 'note').length;
    document.getElementById('sum-total').textContent = total;
    document.getElementById('sum-done').textContent = done;
    document.getElementById('sum-pending').textContent = pending;
    document.getElementById('sum-notes').textContent = notes;
  }

  async function updateHighlights(events) {
    const nowTs = Utils.now();
    const sorted = [...events].sort((a,b) => {
      const ta = Utils.combineDateTime(a.date, a.time) || Infinity;
      const tb = Utils.combineDateTime(b.date, b.time) || Infinity;
      return ta - tb;
    });
    const nowCard = document.getElementById('now-card');
    const nextCard = document.getElementById('next-card');
    const pendingCard = document.getElementById('pending-card');

    // AGORA: evento em andamento (started e not finished)
    const nowEv = sorted.find((e) => {
      if (e.completed || !e.time) return false;
      const start = Utils.combineDateTime(e.date, e.time);
      const end = e.endTime ? Utils.combineDateTime(e.date, e.endTime) : start + 60*60_000;
      return nowTs >= start && nowTs <= end;
    });
    document.getElementById('now-content').innerHTML = nowEv
      ? `<span class="hl-time">${nowEv.time}</span><strong>${Utils.escapeHTML(nowEv.title)}</strong>`
      : '<span style="color:var(--muted)">Nada em andamento</span>';
    nowCard.classList.toggle('now', !!nowEv);

    // PRÓXIMO
    const nextEv = sorted.find((e) => {
      if (e.completed) return false;
      const ts = Utils.combineDateTime(e.date, e.time);
      return ts && ts > nowTs;
    });
    document.getElementById('next-content').innerHTML = nextEv
      ? `<span class="hl-time">${nextEv.time} · ${Utils.typeIcon(nextEv.type)}</span><strong>${Utils.escapeHTML(nextEv.title)}</strong>`
      : '<span style="color:var(--muted)">Sem próximos eventos</span>';

    // PENDÊNCIAS
    const late = sorted.filter((e) => {
      if (e.completed || e.type === 'note') return false;
      const ts = Utils.combineDateTime(e.date, e.time);
      return ts && ts < nowTs;
    });
    if (late.length) {
      pendingCard.hidden = false;
      document.getElementById('pending-content').innerHTML =
        `<strong>${late.length}</strong> ${late.length === 1 ? 'atividade passou do horário' : 'atividades passaram do horário'}.`;
    } else {
      pendingCard.hidden = true;
    }
  }

  // ====== Modais ======
  function openTypeModal() { document.getElementById('modal-type').showModal(); }
  function closeAllModals() {
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  }

  function openFormModal(type = 'task', existing = null) {
    const form = document.getElementById('record-form');
    form.reset();
    document.getElementById('form-title').textContent = existing ? 'Editar registro' : `Novo ${type}`;
    form.dataset.type = type;
    form.dataset.id = existing ? existing.id : '';

    document.getElementById('checklist-wrap').hidden = type !== 'checklist';

    if (existing) {
      form.title.value = existing.title || '';
      form.description.value = existing.description || '';
      form.date.value = existing.date || Utils.todayISO();
      form.time.value = existing.time || '';
      form.endTime.value = existing.endTime || '';
      form.category.value = existing.category || '';
      form.priority.value = existing.priority || 'normal';
      form.tags.value = (existing.tags || []).join(', ');
      form.alert.checked = !!existing.alert;
      form.alertMinutesBefore.value = existing.alertMinutesBefore ?? 10;
      if (type === 'checklist') {
        form.checklist.value = (existing.checklist || []).map(i => i.text).join('\n');
      }
    } else {
      form.date.value = Utils.toISODate(_currentDate);
    }

    document.getElementById('alert-options').hidden = !form.alert.checked;
    document.getElementById('modal-form').showModal();
  }

  async function saveRecord(form) {
    const type = form.dataset.type;
    const id = form.dataset.id || Utils.uuid();
    const userId = Firebase.userId() || 'local';
    const existing = form.dataset.id ? await DB.getEvent(id) : null;

    const data = {
      id,
      userId,
      type,
      title: form.title.value.trim(),
      description: form.description.value.trim(),
      date: form.date.value,
      time: form.time.value || null,
      endTime: form.endTime.value || null,
      alert: form.alert.checked,
      alertMinutesBefore: Number(form.alertMinutesBefore.value) || 0,
      completed: existing ? existing.completed : false,
      completedAt: existing ? existing.completedAt : null,
      priority: form.priority.value,
      category: form.category.value.trim(),
      tags: form.tags.value.split(',').map(t => t.trim()).filter(Boolean),
      checklist: type === 'checklist'
        ? form.checklist.value.split('\n').map(t => t.trim()).filter(Boolean).map(t => ({ text: t, done: false }))
        : [],
      createdAt: existing ? existing.createdAt : Utils.now(),
      updatedAt: Utils.now(),
      deleted: false,
      syncStatus: 'pending'
    };

    await Sync.markAndEnqueue(data);
    Alerts.scheduleFor(data);
    Utils.toast('Salvo ✓');
    closeAllModals();
    renderTimeline();
  }

  function openActions(id) {
    _activeRecordId = id;
    document.getElementById('actions-title').textContent = 'Ações';
    document.getElementById('modal-actions').showModal();
  }

  async function executeAction(action) {
    const id = _activeRecordId;
    if (!id) return;
    const ev = await DB.getEvent(id);
    if (!ev) return;
    closeAllModals();

    switch (action) {
      case 'edit':
        openFormModal(ev.type, ev);
        break;
      case 'toggle':
        ev.completed = !ev.completed;
        ev.completedAt = ev.completed ? Utils.now() : null;
        await Sync.markAndEnqueue(ev);
        Utils.toast(ev.completed ? 'Concluído ✓' : 'Reaberto');
        renderTimeline();
        break;
      case 'delete':
        if (!confirm('Excluir este registro?')) return;
        await Sync.markDeletedLocal(id);
        Utils.toast('Excluído');
        renderTimeline();
        break;
      case 'duplicate': {
        const copy = { ...ev, id: Utils.uuid(), title: ev.title + ' (cópia)', completed: false, completedAt: null, createdAt: Utils.now(), updatedAt: Utils.now(), syncStatus: 'pending' };
        await Sync.markAndEnqueue(copy);
        Utils.toast('Duplicado');
        renderTimeline();
        break;
      }
      case 'postpone':
        document.getElementById('modal-postpone').dataset.eventId = id;
        document.getElementById('modal-postpone').showModal();
        break;
      case 'share': {
        const text = `${Utils.typeIcon(ev.type)} ${ev.title}${ev.time ? ' às ' + ev.time : ''}${ev.date ? ' — ' + ev.date : ''}`;
        if (navigator.share) {
          try { await navigator.share({ title: ev.title, text }); } catch(e) {}
        } else {
          await navigator.clipboard.writeText(text);
          Utils.toast('Copiado para a área de transferência');
        }
        break;
      }
      case 'alert':
        ev.alert = !ev.alert;
        await Sync.markAndEnqueue(ev);
        Alerts.scheduleFor(ev);
        Utils.toast(ev.alert ? 'Alerta ativado 🔔' : 'Alerta desativado');
        renderTimeline();
        break;
    }
  }

  async function postponeTo(minutesOrWhen) {
    const id = document.getElementById('modal-postpone').dataset.eventId;
    const ev = await DB.getEvent(id);
    if (!ev) return;
    let newTs;
    if (typeof minutesOrWhen === 'number') {
      newTs = Utils.now() + minutesOrWhen * 60_000;
    } else if (minutesOrWhen === 'tomorrow') {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      t.setHours(9, 0, 0, 0);
      newTs = t.getTime();
    } else {
      newTs = new Date(minutesOrWhen).getTime();
    }
    const d = new Date(newTs);
    ev.date = Utils.toISODate(d);
    ev.time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    await Sync.markAndEnqueue(ev);
    Alerts.scheduleFor(ev);
    closeAllModals();
    Utils.toast('Adiado ⏰');
    renderTimeline();
  }

  // ====== Search ======
  async function renderSearch(text) {
    const container = document.getElementById('search-results');
    if (!text) { container.hidden = true; container.innerHTML = ''; return; }
    const results = await Search.query({ text });
    container.hidden = false;
    if (!results.length) {
      container.innerHTML = '<div class="tl-empty">Nenhum resultado encontrado</div>';
      return;
    }
    const t = text.toLowerCase();
    container.innerHTML = results.map((e) => {
      const snippet = (e.description || '').slice(0, 120);
      return `<div class="sr-item" data-id="${e.id}">
        <div class="sr-date">${e.date} · ${Utils.typeIcon(e.type)} ${e.type}</div>
        <div class="sr-title">${Utils.escapeHTML(e.title)}</div>
        ${snippet ? `<div class="sr-match">${Utils.escapeHTML(snippet)}</div>` : ''}
      </div>`;
    }).join('');
    container.querySelectorAll('.sr-item').forEach((el) => {
      el.onclick = () => {
        const id = el.dataset.id;
        DB.getEvent(id).then((ev) => {
          if (!ev) return;
          _currentDate = Utils.parseDate(ev.date);
          updateDateHeader();
          setView('today');
          renderTimeline().then(() => {
            setTimeout(() => {
              const card = document.querySelector(`.tl-card[data-id="${id}"]`);
              if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
          });
        });
      };
    });
  }

  // ====== Views ======
  function setView(view) {
    _currentView = view;
    ['timeline', 'highlights', 'day-summary', 'filters', 'search-results', 'calendar-view', 'history-view']
      .forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (view === 'today') el.hidden = (id === 'calendar-view' || id === 'history-view' || id === 'search-results');
        else if (view === 'calendar') el.hidden = id !== 'calendar-view';
        else if (view === 'history') el.hidden = id !== 'history-view';
        else if (view === 'search') el.hidden = id !== 'search-results';
      });
    document.getElementById('date-nav').style.display = (view === 'today') ? '' : 'none';
    if (view === 'calendar') {
      Calendar.render(document.getElementById('calendar-view'), (iso) => {
        _currentDate = Utils.parseDate(iso);
        updateDateHeader();
        setView('today');
        renderTimeline();
      });
    }
    if (view === 'history') renderHistory();
  }

  async function renderHistory() {
    const container = document.getElementById('history-view');
    container.hidden = false;
    container.innerHTML = `
      <div class="period-picker">
        <button data-days="1">Ontem</button>
        <button data-days="7">7 dias</button>
        <button data-days="30" class="active">30 dias</button>
        <button data-days="90">90 dias</button>
        <button data-days="365">1 ano</button>
      </div>
      <div id="history-list"></div>
    `;
    const buttons = container.querySelectorAll('.period-picker button');
    buttons.forEach((b) => b.onclick = () => {
      buttons.forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      loadHistory(Number(b.dataset.days));
    });
    loadHistory(30);
  }

  async function loadHistory(days) {
    const end = Utils.todayISO();
    const start = Utils.toISODate(new Date(Utils.addDays(Utils.now(), -days)));
    const userId = Firebase.userId() || 'local';
    const events = await DB.eventsByDateRange(start, end, userId);
    events.sort((a,b) => b.date.localeCompare(a.date));
    const list = document.getElementById('history-list');
    if (!events.length) {
      list.innerHTML = '<div class="tl-empty">Nada neste período</div>';
      return;
    }
    list.innerHTML = events.map((e) => `
      <div class="sr-item" data-id="${e.id}">
        <div class="sr-date">${e.date} · ${Utils.typeIcon(e.type)} ${e.type}</div>
        <div class="sr-title ${e.completed ? 'done' : ''}">${Utils.escapeHTML(e.title)}</div>
        ${e.description ? `<div class="sr-match">${Utils.escapeHTML(e.description).slice(0,140)}</div>` : ''}
      </div>
    `).join('');
    list.querySelectorAll('.sr-item').forEach((el) => {
      el.onclick = () => openActions(el.dataset.id);
    });
  }

  return {
    setCurrentDate, getCurrentDate,
    updateDateHeader, renderTimeline,
    openTypeModal, openFormModal, saveRecord, closeAllModals,
    openActions, executeAction, postponeTo,
    renderSearch, setView
  };
})();
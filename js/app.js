// Bootstrapping da aplicação
(async function main() {
  'use strict';

  // 1) Service Worker
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (e) { console.warn('SW failed:', e); }
  }

  // 2) IndexedDB
  await DB.open();

  // 3) Tema
  const savedTheme = await DB.getSetting('theme');
  if (savedTheme === 'dark' || (!savedTheme && matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.dataset.theme = 'dark';
    document.getElementById('theme-toggle').checked = true;
  }

  // 4) Firebase (lazy) — não bloqueia o uso offline
  try { await Firebase.init(); } catch (e) { console.warn('Firebase init failed:', e); }

  // 5) Sync
  Sync.init();

  // 6) Data inicial = hoje
  UI.setCurrentDate(new Date());
  UI.updateDateHeader();
  await UI.renderTimeline();

  // 7) Permissão de notificação (não bloqueante)
  Alerts.requestPermission().catch(() => {});
  Alerts.rescheduleAll();

  // 8) Atualiza a linha do "agora" a cada minuto
  setInterval(() => {
    if (UI.getCurrentDate().toDateString() === new Date().toDateString()) {
      UI.renderTimeline();
    }
  }, 60_000);

  // 9) Reagenda alertas quando dados mudam
  document.addEventListener('sync:done', () => {
    Alerts.rescheduleAll();
    UI.renderTimeline();
  });

  // ============ EVENTOS DE UI ============

  // FAB
  document.getElementById('fab-add').onclick = () => UI.openTypeModal();

  // Tipo -> abre formulário
  document.querySelectorAll('#modal-type .type-btn').forEach((b) => {
    b.onclick = () => {
      UI.closeAllModals();
      UI.openFormModal(b.dataset.type);
    };
  });

  // Nota rápida
  document.getElementById('btn-quick-note').onclick = async () => {
    UI.closeAllModals();
    const title = prompt('Digite sua anotação rápida:');
    if (!title || !title.trim()) return;
    const ev = {
      id: Utils.uuid(),
      userId: Firebase.userId() || 'local',
      type: 'note',
      title: title.trim(),
      description: '',
      date: Utils.todayISO(),
      time: null, endTime: null,
      alert: false, alertMinutesBefore: 0,
      completed: false, completedAt: null,
      priority: 'normal', category: '', tags: [], checklist: [],
      createdAt: Utils.now(), updatedAt: Utils.now(),
      deleted: false, syncStatus: 'pending'
    };
    await Sync.markAndEnqueue(ev);
    Utils.toast('Nota rápida salva 📝');
    UI.renderTimeline();
  };

  // Fechar modais
  document.querySelectorAll('[data-close]').forEach((b) => {
    b.onclick = () => UI.closeAllModals();
  });

  // Formulário de registro
  const form = document.getElementById('record-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    UI.saveRecord(form);
  });
  form.alert.addEventListener('change', () => {
    document.getElementById('alert-options').hidden = !form.alert.checked;
  });

  // Ações
  document.querySelectorAll('#modal-actions [data-action]').forEach((b) => {
    b.onclick = () => UI.executeAction(b.dataset.action);
  });

  // Adiar
  document.querySelectorAll('#modal-postpone [data-minutes]').forEach((b) => {
    b.onclick = () => UI.postponeTo(Number(b.dataset.minutes));
  });
  document.querySelector('#modal-postpone [data-when="tomorrow"]').onclick = () => UI.postponeTo('tomorrow');

  // Alert modal
  document.getElementById('alert-done').onclick = async () => {
    const id = document.getElementById('modal-alert').dataset.eventId;
    const ev = await DB.getEvent(id);
    if (ev) {
      ev.completed = true;
      ev.completedAt = Utils.now();
      await Sync.markAndEnqueue(ev);
      UI.renderTimeline();
    }
    UI.closeAllModals();
  };
  document.getElementById('alert-postpone').onclick = () => {
    const id = document.getElementById('modal-alert').dataset.eventId;
    UI.closeAllModals();
    document.getElementById('modal-postpone').dataset.eventId = id;
    document.getElementById('modal-postpone').showModal();
  };
  document.getElementById('alert-open').onclick = () => {
    const id = document.getElementById('modal-alert').dataset.eventId;
    UI.closeAllModals();
    UI.openActions(id);
  };

  // Navegação de dia
  document.getElementById('btn-prev-day').onclick = () => changeDay(-1);
  document.getElementById('btn-next-day').onclick = () => changeDay(1);
  document.getElementById('btn-today').onclick = () => {
    UI.setCurrentDate(new Date());
    UI.updateDateHeader();
    UI.renderTimeline();
  };

  function changeDay(delta) {
    const d = UI.getCurrentDate();
    d.setDate(d.getDate() + delta);
    UI.setCurrentDate(d);
    UI.updateDateHeader();
    UI.renderTimeline();
  }

  // Filtros
  ['filter-type','filter-status','filter-priority'].forEach((id) => {
    document.getElementById(id).addEventListener('change', () => UI.renderTimeline());
  });

  // Pesquisa
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', Utils.debounce(() => {
    const v = searchInput.value.trim();
    if (v) {
      UI.setView('search');
      UI.renderSearch(v);
    } else {
      UI.setView('today');
    }
  }, 250));

  // Menu lateral
  const sideMenu = document.getElementById('side-menu');
  document.getElementById('btn-menu').onclick = () => { sideMenu.hidden = false; };
  document.getElementById('btn-close-menu').onclick = () => { sideMenu.hidden = true; };
  document.querySelectorAll('.side-nav button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.side-nav button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      UI.setView(b.dataset.view);
      sideMenu.hidden = true;
    };
  });

  // Tema
  document.getElementById('theme-toggle').addEventListener('change', async (e) => {
    const dark = e.target.checked;
    document.documentElement.dataset.theme = dark ? 'dark' : '';
    await DB.setSetting('theme', dark ? 'dark' : 'light');
  });

  // Login
  document.getElementById('btn-login').onclick = () => {
    document.getElementById('modal-login').showModal();
  };
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const mode = e.submitter?.value || 'login';
    try {
      if (mode === 'register') await Firebase.register(fd.get('email'), fd.get('password'));
      else await Firebase.login(fd.get('email'), fd.get('password'));
      Utils.toast('Conectado ✓');
      UI.closeAllModals();
      Sync.schedule();
    } catch (err) {
      Utils.toast('Falha: ' + (err.message || err));
    }
  });
  document.getElementById('btn-logout').onclick = async () => {
    await Firebase.logout();
    Utils.toast('Desconectado');
  };

  document.addEventListener('auth:change', (e) => {
    const user = e.detail.user;
    const info = document.getElementById('user-info');
    const btnLogin = document.getElementById('btn-login');
    const btnLogout = document.getElementById('btn-logout');
    if (user) {
      info.textContent = user.email;
      btnLogin.hidden = true;
      btnLogout.hidden = false;
    } else {
      info.textContent = '';
      btnLogin.hidden = false;
      btnLogout.hidden = true;
    }
    UI.renderTimeline();
  });

  // Gestos swipe para mudar de dia
  let touchStartX = 0;
  const main = document.getElementById('app-main');
  main.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
  main.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 80) changeDay(dx < 0 ? 1 : -1);
  });

  // Mensagens do Service Worker (abrir evento a partir de notificação)
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'OPEN_EVENT' && e.data.id) {
      UI.openActions(e.data.id);
    }
  });

  // Prompt de instalação PWA
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Poderia mostrar um botão "Instalar aplicativo" aqui
  });

  // Primeira carga — feedback
  Utils.toast('✨ Mágica está pronta para funcionar offline', 3000);

})();
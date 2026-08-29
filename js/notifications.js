// Sistema de alertas: Notification API, vibração, som.
// Limitação: navegadores não garantem alarmes em segundo plano quando a aba está fechada.
// Em PWA instalado no Android, as notificações push funcionam melhor.
const Alerts = (() => {
  let _timers = new Map(); // id -> timeoutId
  let _audioCtx = null;

  async function requestPermission() {
    if (!('Notification' in window)) return 'denied';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    return await Notification.requestPermission();
  }

// Padrão de alerta: 10 repetições a cada 0.5s
function beep() {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Toca 10 beeps com intervalo de 0.5s
    for (let i = 0; i < 10; i++) {
      setTimeout(() => {
        const o = _audioCtx.createOscillator();
        const g = _audioCtx.createGain();
        o.type = 'sine';
        o.frequency.value = 880; // tom agudo característico
        g.gain.value = 0.2;
        o.connect(g);
        g.connect(_audioCtx.destination);
        o.start();
        setTimeout(() => o.stop(), 200); // cada beep dura 200ms
      }, i * 500); // 500ms entre cada beep
    }
  } catch (e) {
    console.warn('Áudio não suportado:', e);
  }
}

function vibrate() {
  if ('vibrate' in navigator) {
    try {
      // Padrão: 10 vibrações de 200ms com 300ms de pausa
      const pattern = [];
      for (let i = 0; i < 10; i++) {
        pattern.push(200); // vibra 200ms
        if (i < 9) pattern.push(300); // pausa 300ms (exceto no último)
      }
      navigator.vibrate(pattern);
    } catch(e) {
      console.warn('Vibração não suportada:', e);
    }
  }
}

  function showLocal(ev) {
    beep();
    vibrate();
    const modal = document.getElementById('modal-alert');
    document.getElementById('alert-title').textContent = 'Hora do compromisso';
    document.getElementById('alert-body').textContent = ev.title;
    modal.dataset.eventId = ev.id;
    modal.showModal();
  }

  function notifyBrowser(ev) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      new Notification('🔔 ' + ev.title, {
        body: ev.description || 'Compromisso agendado',
        tag: ev.id,
        data: { id: ev.id },
        icon: 'icons/icon-192.png'
      });
    } catch (e) { /* fallback handled by showLocal */ }
  }

  function fire(ev) {
    notifyBrowser(ev);
    showLocal(ev);
  }

  function scheduleFor(ev) {
    cancelFor(ev.id);
    if (!ev.alert || ev.completed || ev.deleted) return;
    const triggerTs = Utils.combineDateTime(ev.date, ev.time) - (ev.alertMinutesBefore || 0) * 60_000;
    const delay = triggerTs - Utils.now();
    if (delay <= 0) return; // já passou
    const t = setTimeout(() => fire(ev), delay);
    _timers.set(ev.id, t);
  }

  function cancelFor(id) {
    if (_timers.has(id)) {
      clearTimeout(_timers.get(id));
      _timers.delete(id);
    }
  }

  async function rescheduleAll() {
    const today = Utils.todayISO();
    const future = Utils.toISODate(new Date(Utils.addDays(Utils.now(), 3)));
    const userId = Firebase.userId() || 'local';
    const events = await DB.eventsByDateRange(today, future, userId);
    events.forEach(scheduleFor);
  }

  return { requestPermission, fire, scheduleFor, cancelFor, rescheduleAll };
})();

function scheduleNotification(ev) {
  if (!('serviceWorker' in navigator) || !ev.alert) return;
  
  const triggerTs = Utils.combineDateTime(ev.date, ev.time) - (ev.alertMinutesBefore || 0) * 60_000;
  const delay = triggerTs - Date.now();
  
  if (delay <= 0) return; // já passou
  
  // Envia para o Service Worker agendar
  navigator.serviceWorker.ready.then(registration => {
    registration.active.postMessage({
      type: 'SCHEDULE_NOTIFICATION',
      id: ev.id,
      title: ev.title,
      body: ev.description || '',
      triggerAt: triggerTs
    });
  });
}

// Modifique a função scheduleFor para usar ambos:
function scheduleFor(ev) {
  cancelFor(ev.id);
  if (!ev.alert || ev.completed || ev.deleted) return;
  
  // Agenda no Service Worker (funciona em background)
  scheduleNotification(ev);
  
  // Agenda também no app (para quando estiver aberto)
  const triggerTs = Utils.combineDateTime(ev.date, ev.time) - (ev.alertMinutesBefore || 0) * 60_000;
  const delay = triggerTs - Utils.now();
  if (delay <= 0) return;
  const t = setTimeout(() => fire(ev), delay);
  _timers.set(ev.id, t);
}
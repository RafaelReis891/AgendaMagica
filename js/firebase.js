// Firebase — configuração e operações remotas
// IMPORTANTE: substitua FIREBASE_CONFIG pelas suas credenciais reais.
const Firebase = (() => {
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDswGi_UmMiCddQ0Fq_xggkDMsPORtiClc",
    authDomain: "pdc-monthly.firebaseapp.com",
    databaseURL: "https://pdc-monthly-default-rtdb.firebaseio.com/",
    projectId: "pdc-monthly",
    storageBucket: "pdc-monthly.firebasestorage.app",
    messagingSenderId: "405073422956",
    appId: "1:405073422956:web:e77b330bb8a9e02c538649"
  };

  let _app = null;
  let _db = null;
  let _auth = null;
  let _userId = null;
  let _listeners = [];
  let _configured = false;

  async function init() {
    if (_configured) return;
    // Carrega Firebase via CDN dinamicamente (compat)
    await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js');

    _app = firebase.initializeApp(FIREBASE_CONFIG);
    _auth = firebase.auth();
    _db = firebase.database();

    _auth.onAuthStateChanged((user) => {
      _userId = user ? user.uid : null;
      document.dispatchEvent(new CustomEvent('auth:change', { detail: { user } }));
      if (user) Sync.schedule();
    });

    _configured = true;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function isConfigured() {
    return FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== 'SUA_API_KEY';
  }

  function userId() { return _userId; }
  function isOnline() { return navigator.onLine; }

  async function login(email, password) {
    await init();
    try {
      const cred = await _auth.signInWithEmailAndPassword(email, password);
      return cred.user;
    } catch (error) {
      console.error("Erro Firebase Login:", error.code, error.message);
      throw new Error(error.message); // Exibe o erro real do Firebase na tela
    }
  }

  async function register(email, password) {
    await init();
    try {
      const cred = await _auth.createUserWithEmailAndPassword(email, password);
      return cred.user;
    } catch (error) {
      console.error("Erro Firebase Registro:", error.code, error.message);
      throw new Error(error.message); // Exibe o erro real do Firebase na tela
    }
  }
  async function logout() {
    if (_auth) await _auth.signOut();
  }

  function userPath(uid) { return `users/${uid}/events`; }

  // PUT (upsert) — last-write-wins
  async function pushEvent(ev) {
    if (!_userId) return;
    const ref = _db.ref(`${userPath(_userId)}/${ev.id}`);
    await ref.set(ev);
  }

  async function removeEvent(id) {
    if (!_userId) return;
    await _db.ref(`${userPath(_userId)}/${id}`).remove();
  }

  // Busca eventos remotos em um range de datas
  async function fetchEventsByDateRange(startISO, endISO) {
    if (!_userId) return [];
    const ref = _db.ref(userPath(_userId))
      .orderByChild('date')
      .startAt(startISO)
      .endAt(endISO);
    const snap = await ref.once('value');
    const val = snap.val() || {};
    return Object.values(val);
  }

  async function fetchAllRemote() {
    if (!_userId) return [];
    const snap = await _db.ref(userPath(_userId)).once('value');
    const val = snap.val() || {};
    return Object.values(val);
  }

  // Listener em tempo real para o usuário atual
  function subscribeRemote(onChange) {
    if (!_userId) return () => {};
    const ref = _db.ref(userPath(_userId));
    const handler = (snap) => {
      const val = snap.val() || {};
      onChange(Object.values(val));
    };
    ref.on('value', handler);
    const unsub = () => ref.off('value', handler);
    _listeners.push(unsub);
    return unsub;
  }

  function unsubscribeAll() {
    _listeners.forEach((u) => u());
    _listeners = [];
  }

  return {
    init, isConfigured, userId, isOnline,
    login, register, logout,
    pushEvent, removeEvent,
    fetchEventsByDateRange, fetchAllRemote,
    subscribeRemote, unsubscribeAll
  };
})();
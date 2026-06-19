// ─── Firebase (SDK modular v12.15.0 vía CDN) ──────────────────────────────────
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBecjbXUb3SsBPCsmKTLDfBzh4SG0ti400",
  authDomain: "plazadonadolfo.firebaseapp.com",
  projectId: "plazadonadolfo",
  storageBucket: "plazadonadolfo.firebasestorage.app",
  messagingSenderId: "218835417788",
  appId: "1:218835417788:web:2000cd6831dae8d99d47b9"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// Instancia secundaria: crear cuentas (createUserWithEmailAndPassword) SIN cerrar
// la sesión del admin/locatario que está usando la instancia principal.
// Usa el mismo firebaseConfig público (no hay secretos en el cliente).
const secondaryApp  = initializeApp(firebaseConfig, 'secondary');
const secondaryAuth = getAuth(secondaryApp);

// URL de la app para el mensaje de WhatsApp con el acceso del nuevo usuario.
const APP_URL = "http://localhost:8000/"; // TODO: cambiar a la URL pública al publicar.

// Datos del usuario SOLO en memoria, para decidir qué muestra la UI.
// La seguridad real (quién puede leer/abrir) vive en las reglas de Firestore
// y en el Worker. No se expone en window ni en variables globales.
let sessionUser = null;

// ─── Navegación de pantallas ──────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ─── Referencias DOM (login + principal) ──────────────────────────────────────
const emailInput    = document.getElementById('email');
const passInput     = document.getElementById('password');
const btnLogin      = document.getElementById('btn-login');
const loginError    = document.getElementById('login-error');
const btnLogout     = document.getElementById('btn-logout');
const btnAdmin      = document.getElementById('btn-admin');
const btnMisAlumnos = document.getElementById('btn-misalumnos');
const btnPuerta     = document.getElementById('btn-puerta');
const rowPorton     = document.getElementById('btn-porton');
const rowAlarma     = document.getElementById('row-alarma');

function setLoginError(msg) { loginError.textContent = msg || ''; }

// Traduce el código de error de Firebase Auth a un mensaje claro para el usuario.
function authErrorMessage(code) {
  switch (code) {
    case 'auth/invalid-email':
      return 'El correo no tiene un formato válido.';
    case 'auth/email-already-in-use':
      return 'Ese correo ya está registrado.';
    case 'auth/weak-password':
      return 'La contraseña es muy débil (mínimo 6 caracteres).';
    case 'auth/user-disabled':
      return 'Esta cuenta está deshabilitada.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Correo o contraseña incorrectos.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos fallidos. Espera un momento e inténtalo de nuevo.';
    case 'auth/network-request-failed':
      return 'Sin conexión. Revisa tu internet e inténtalo de nuevo.';
    default:
      return 'No se pudo completar la operación. Inténtalo de nuevo.';
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────
async function handleLogin() {
  const email = emailInput.value.trim();
  const password = passInput.value;
  setLoginError('');

  if (!email || !password) {
    setLoginError('Ingresa correo y contraseña.');
    return;
  }

  btnLogin.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged se encarga de verificar el rol y navegar.
  } catch (err) {
    setLoginError(authErrorMessage(err.code));
    btnLogin.disabled = false;
  } finally {
    // La contraseña ya se usó: no la conservamos en ningún lado.
    passInput.value = '';
  }
}

btnLogin.addEventListener('click', handleLogin);
[emailInput, passInput].forEach(input => {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleLogin(); }
  });
});

// ─── Logout ───────────────────────────────────────────────────────────────────
btnLogout.addEventListener('click', () => { signOut(auth); });

// ─── Visibilidad por permisos (SOLO UI) ───────────────────────────────────────
function applyRole(user) {
  const esMA = (user.rol === 'master' || user.rol === 'admin');
  // master/admin SIEMPRE ven los tres accesos (la alarma queda deshabilitada).
  btnPuerta.hidden = !(esMA || user.permisoPuerta === true);
  rowPorton.hidden = !(esMA || user.permisoPorton === true);
  rowAlarma.hidden = !(esMA || user.permisoAlarma === true);
  // Accesos a paneles de gestión.
  btnAdmin.hidden      = !esMA;
  btnMisAlumnos.hidden = !(user.rol === 'locatario');
}

// ─── Estado de autenticación ──────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    sessionUser = null;
    stopAdminListener();
    stopAlumnosListener();
    closeAllModals();
    btnLogin.disabled = false;
    showScreen('screen-login');
    return;
  }

  try {
    const snap = await getDoc(doc(db, 'usuarios', user.uid));

    if (!snap.exists()) {
      setLoginError('Tu usuario no está dado de alta. Contacta al administrador.');
      await signOut(auth);
      return;
    }

    const data = snap.data();
    if (data.suspendido === true) {
      setLoginError('Tu acceso está suspendido.');
      await signOut(auth);
      return;
    }

    // Vigencia: si tiene fecha de vencimiento y ya pasó, no dejamos entrar.
    if (data.vigencia && typeof data.vigencia.toMillis === 'function'
        && data.vigencia.toMillis() < Date.now()) {
      setLoginError('Tu acceso ha vencido.');
      await signOut(auth);
      return;
    }

    sessionUser = {
      uid: user.uid,
      rol: data.rol,
      nombre: data.nombre,
      permisoPuerta: data.permisoPuerta === true,
      permisoPorton: data.permisoPorton === true,
      permisoAlarma: data.permisoAlarma === true,
      puedeInvitarPorton: data.puedeInvitarPorton === true
    };

    setLoginError('');
    applyRole(sessionUser);
    showScreen('screen-main');
  } catch (err) {
    // Falla de lectura (reglas / red): no dejamos pasar.
    setLoginError('No se pudo verificar tu acceso. Intenta de nuevo.');
    await signOut(auth);
  }
});

// ─── Mantener presionado (3 s) ────────────────────────────────────────────────
const HOLD_MS = 3000;
const CIRCUMFERENCE = 2 * Math.PI * 19; // r=19 → 119.38

class HoldButton {
  constructor(el) {
    this.el = el;
    this.ring = el.querySelector('.ring-progress');
    this.startTime = null;
    this.raf = null;

    this.ring.style.strokeDasharray = CIRCUMFERENCE;
    this.ring.style.strokeDashoffset = CIRCUMFERENCE;

    el.addEventListener('mousedown',   ()  => this._start());
    el.addEventListener('touchstart',  (e) => { e.preventDefault(); this._start(); }, { passive: false });
    el.addEventListener('mouseup',     ()  => this._cancel());
    el.addEventListener('mouseleave',  ()  => this._cancel());
    el.addEventListener('touchend',    ()  => this._cancel());
    el.addEventListener('touchcancel', ()  => this._cancel());
  }

  _start() {
    if (this.startTime !== null) return;
    this.startTime = performance.now();
    this.el.classList.add('holding');
    this._tick();
  }

  _tick() {
    const progress = Math.min((performance.now() - this.startTime) / HOLD_MS, 1);
    this.ring.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress);

    if (progress < 1) {
      this.raf = requestAnimationFrame(() => this._tick());
    } else {
      this._complete();
    }
  }

  _cancel() {
    if (this.startTime === null) return;
    cancelAnimationFrame(this.raf);
    this.el.classList.remove('holding');
    this.ring.style.strokeDashoffset = CIRCUMFERENCE;
    this.startTime = null;
    this.raf = null;
  }

  _complete() {
    cancelAnimationFrame(this.raf);
    this.el.classList.remove('holding');
    this.ring.style.strokeDashoffset = CIRCUMFERENCE;
    this.startTime = null;
    this.raf = null;

    // TODO: el siguiente paso reemplaza esta alerta por la llamada al Worker
    // (que valida permisos + suspensión en el servidor antes de disparar el relé).
    const label = this.el.dataset.label || 'Abriendo...';
    setTimeout(() => alert(label), 50);
  }
}

new HoldButton(document.getElementById('btn-puerta'));
new HoldButton(document.getElementById('btn-porton'));

// ══════════════════════════════════════════════════════════════════════════════
// GESTIÓN — Panel admin (master/admin) y "Mis alumnos" (locatario)
// ══════════════════════════════════════════════════════════════════════════════

const ROLE_LABELS = {
  master:    'Master',
  admin:     'Admin',
  locatario: 'Locatario',
  alumno:    'Alumno'
};

// Qué roles puede crear cada quien desde el panel de administración.
const ROLES_POR_CREADOR = {
  master: ['admin', 'locatario', 'alumno'],
  admin:  ['locatario', 'alumno']
};

// ─── Refs: pantalla admin ──────────────────────────────────────────────────────
const btnAdminBack    = document.getElementById('btn-admin-back');
const btnCrearUsuario = document.getElementById('btn-crear-usuario');
const userListEl      = document.getElementById('user-list');

// ─── Refs: pantalla "Mis alumnos" ──────────────────────────────────────────────
const btnAlumnosBack = document.getElementById('btn-alumnos-back');
const btnCrearAlumno = document.getElementById('btn-crear-alumno');
const alumnoListEl   = document.getElementById('alumno-list');

// ─── Refs: modal crear usuario (admin) ─────────────────────────────────────────
const modalCrear   = document.getElementById('modal-crear');
const nuNombre     = document.getElementById('nu-nombre');
const nuEmail      = document.getElementById('nu-email');
const nuPass       = document.getElementById('nu-pass');
const nuGen        = document.getElementById('nu-gen');
const nuRol        = document.getElementById('nu-rol');
const nuLocPerms   = document.getElementById('nu-locatario-perms');
const swPuerta     = document.getElementById('sw-puerta');
const swPorton     = document.getElementById('sw-porton');
const swAlarma     = document.getElementById('sw-alarma');
const swInvitar    = document.getElementById('sw-invitar');
const nuPadreGroup = document.getElementById('nu-padre-group');
const nuPadre      = document.getElementById('nu-padre');
const nuVigencia   = document.getElementById('nu-vigencia');
const nuError      = document.getElementById('nu-error');
const nuCancelar   = document.getElementById('nu-cancelar');
const nuCrear      = document.getElementById('nu-crear');

// ─── Refs: modal crear alumno (locatario) ──────────────────────────────────────
const modalAlumno   = document.getElementById('modal-crear-alumno');
const alNombre      = document.getElementById('al-nombre');
const alEmail       = document.getElementById('al-email');
const alPass        = document.getElementById('al-pass');
const alGen         = document.getElementById('al-gen');
const alPortonGroup = document.getElementById('al-porton-group');
const swAlPorton    = document.getElementById('sw-al-porton');
const alVigencia    = document.getElementById('al-vigencia');
const alError       = document.getElementById('al-error');
const alCancelar    = document.getElementById('al-cancelar');
const alCrear       = document.getElementById('al-crear');

// ─── Refs: modal éxito (compartido) ────────────────────────────────────────────
const modalExito  = document.getElementById('modal-exito');
const exitoText   = document.getElementById('exito-text');
const exitoEmail  = document.getElementById('exito-email');
const exitoPass   = document.getElementById('exito-pass');
const exitoWa     = document.getElementById('exito-wa');
const exitoCerrar = document.getElementById('exito-cerrar');

// ─── Refs: modal vigencia (compartido) ─────────────────────────────────────────
const modalVigencia = document.getElementById('modal-vigencia');
const vigNombre     = document.getElementById('vig-nombre');
const vigFecha      = document.getElementById('vig-fecha');
const vigError      = document.getElementById('vig-error');
const vigGuardar    = document.getElementById('vig-guardar');
const vigQuitar     = document.getElementById('vig-quitar');
const vigCancelar   = document.getElementById('vig-cancelar');

// ─── Helpers de modales ─────────────────────────────────────────────────────────
function openModal(el)  { if (el) el.hidden = false; }
function closeModal(el) { if (el) el.hidden = true; }
function closeAllModals() {
  [modalCrear, modalAlumno, modalExito, modalVigencia].forEach(m => { if (m) m.hidden = true; });
}

// ─── Helpers varios ─────────────────────────────────────────────────────────────
function formatVigencia(ts) {
  if (!ts || typeof ts.toDate !== 'function') return 'Sin vigencia';
  return ts.toDate().toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

// 'YYYY-MM-DD' → Timestamp al final de ese día (acceso válido durante toda la fecha).
function dateInputToTimestamp(value) {
  const [y, m, d] = value.split('-').map(Number);
  return Timestamp.fromDate(new Date(y, m - 1, d, 23, 59, 59, 999));
}

function toDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Contraseña temporal fuerte (con crypto), garantizando variedad de caracteres.
function genPassword(len = 14) {
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digit = '23456789';
  const symb  = '!@#$%*?';
  const all   = lower + upper + digit + symb;
  const rnd = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  const pick = (s) => s[rnd(s.length)];
  const chars = [pick(lower), pick(upper), pick(digit), pick(symb)];
  while (chars.length < len) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) { const j = rnd(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

function buildWaLink(nombre, email, pass) {
  const msg =
    `Hola ${nombre}! 👋\n\n` +
    `Tu acceso a *Plaza Don Adolfo* ya está activo.\n\n` +
    `🔗 App: ${APP_URL}\n` +
    `📧 Usuario: ${email}\n` +
    `🔑 Contraseña temporal: ${pass}\n\n` +
    `Por seguridad, entra y cambia tu contraseña.`;
  return 'https://wa.me/?text=' + encodeURIComponent(msg);
}

function showExito(nombre, email, pass) {
  exitoText.textContent = `Comparte estos datos con ${nombre}. La contraseña es temporal.`;
  exitoEmail.textContent = email;
  exitoPass.textContent = pass;
  exitoWa.href = buildWaLink(nombre, email, pass);
  openModal(modalExito);
}

async function safeUpdate(uid, patch) {
  try {
    await updateDoc(doc(db, 'usuarios', uid), patch);
    // onSnapshot refresca la lista automáticamente.
  } catch (err) {
    alert('No se pudo aplicar el cambio: ' + (err.code || err.message));
  }
}

// ─── Badges reutilizables ───────────────────────────────────────────────────────
function makeBadge(text, cls) {
  const b = document.createElement('span');
  b.className = 'badge ' + cls;
  b.textContent = text;
  return b;
}
function estadoBadge(suspendido) {
  return makeBadge(suspendido ? 'Suspendido' : 'Activo', suspendido ? 'badge-warn' : 'badge-ok');
}

// ══ PANEL ADMIN (master/admin) ══════════════════════════════════════════════════
let unsubAdmin = null;
let usuariosCache = [];

function startAdminListener() {
  if (unsubAdmin) return;
  unsubAdmin = onSnapshot(
    collection(db, 'usuarios'),
    (snap) => {
      usuariosCache = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
      usuariosCache.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
      renderAdminList();
    },
    () => { userListEl.textContent = 'No se pudo cargar la lista de usuarios.'; }
  );
}
function stopAdminListener() {
  if (unsubAdmin) { unsubAdmin(); unsubAdmin = null; }
  usuariosCache = [];
}

function renderAdminList() {
  userListEl.innerHTML = '';
  if (usuariosCache.length === 0) {
    const p = document.createElement('p');
    p.className = 'user-empty';
    p.textContent = 'Aún no hay usuarios.';
    userListEl.appendChild(p);
    return;
  }
  usuariosCache.forEach(u => userListEl.appendChild(buildAdminCard(u)));
}

function permChip(label, on, editable, onToggle) {
  const c = document.createElement('button');
  c.type = 'button';
  c.className = 'perm-chip' + (on ? ' perm-chip--on' : '') + (editable ? '' : ' perm-chip--ro');
  c.textContent = label;
  if (editable) c.addEventListener('click', onToggle);
  else c.disabled = true;
  return c;
}

function buildAdminCard(u) {
  const me = auth.currentUser ? auth.currentUser.uid : null;
  const isSelf = u.uid === me;
  const iAmMaster = sessionUser && sessionUser.rol === 'master';
  const iAmAdmin  = sessionUser && sessionUser.rol === 'admin';
  const targetProtegido = (u.rol === 'master' || u.rol === 'admin');

  // Admin no actúa sobre master ni sobre otros admins. Master actúa sobre todos.
  const canAct = iAmMaster || (iAmAdmin && !targetProtegido);
  const showSuspend  = canAct && !isSelf;                 // nadie se suspende a sí mismo
  const showVigencia = canAct && (!isSelf || iAmMaster);
  const showDelete   = iAmMaster && !isSelf;              // borrar: solo master, nunca a sí mismo

  const card = document.createElement('div');
  card.className = 'user-card';

  // Cabecera: nombre + badges de rol y estado
  const head = document.createElement('div');
  head.className = 'user-card-head';
  const name = document.createElement('span');
  name.className = 'user-name';
  name.textContent = (u.nombre && u.nombre.trim()) ? u.nombre : '(sin nombre)';
  if (isSelf) name.textContent += ' (tú)';
  const meta = document.createElement('div');
  meta.className = 'user-meta';
  meta.append(makeBadge(ROLE_LABELS[u.rol] || u.rol || '—', 'badge-rol'), estadoBadge(u.suspendido));
  head.append(name, meta);
  card.appendChild(head);

  // Permisos como chips (toggle) solo para locatario / alumno
  if (u.rol === 'locatario' || u.rol === 'alumno') {
    const chips = document.createElement('div');
    chips.className = 'perm-chips';
    const editable = canAct;
    chips.append(
      permChip('Puerta', !!u.permisoPuerta, editable, () => safeUpdate(u.uid, { permisoPuerta: !u.permisoPuerta })),
      permChip('Portón', !!u.permisoPorton, editable, () => safeUpdate(u.uid, { permisoPorton: !u.permisoPorton })),
      permChip('Alarma', !!u.permisoAlarma, editable, () => safeUpdate(u.uid, { permisoAlarma: !u.permisoAlarma }))
    );
    if (u.rol === 'locatario') {
      chips.append(permChip('Invitar portón', !!u.puedeInvitarPorton, editable,
        () => safeUpdate(u.uid, { puedeInvitarPorton: !u.puedeInvitarPorton })));
    }
    card.appendChild(chips);
  }

  // Vigencia
  const detail = document.createElement('div');
  detail.className = 'user-detail';
  const vig = document.createElement('span');
  vig.textContent = 'Vigencia: ' + formatVigencia(u.vigencia);
  detail.appendChild(vig);
  card.appendChild(detail);

  // Acciones
  const actions = document.createElement('div');
  actions.className = 'user-actions';
  if (showSuspend) {
    const b = document.createElement('button');
    b.className = 'btn-row';
    b.textContent = u.suspendido ? 'Reactivar' : 'Suspender';
    b.addEventListener('click', () => safeUpdate(u.uid, { suspendido: !u.suspendido }));
    actions.appendChild(b);
  }
  if (showVigencia) {
    const b = document.createElement('button');
    b.className = 'btn-row btn-row--gold';
    b.textContent = 'Vigencia';
    b.addEventListener('click', () => openVigencia(u));
    actions.appendChild(b);
  }
  if (showDelete) {
    const b = document.createElement('button');
    b.className = 'btn-row btn-row--danger';
    b.textContent = 'Borrar';
    b.addEventListener('click', () => borrarUsuario(u));
    actions.appendChild(b);
  }
  if (actions.children.length) card.appendChild(actions);

  return card;
}

async function borrarUsuario(u) {
  const ok = confirm(
    `¿Borrar a ${u.nombre || 'este usuario'}?\n\n` +
    `Se elimina su ficha de Firestore. La cuenta de acceso (Auth) NO se borra ` +
    `desde aquí; si hace falta, elimínala en la consola de Firebase.`
  );
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'usuarios', u.uid));
  } catch (err) {
    alert('No se pudo borrar: ' + (err.code || err.message));
  }
}

// ─── Crear usuario (admin) ──────────────────────────────────────────────────────
function fillRolDropdown() {
  const roles = ROLES_POR_CREADOR[sessionUser.rol] || [];
  nuRol.innerHTML = '';
  roles.forEach(r => {
    const o = document.createElement('option');
    o.value = r;
    o.textContent = ROLE_LABELS[r];
    nuRol.appendChild(o);
  });
}

function fillPadreDropdown() {
  const locatarios = usuariosCache.filter(u => u.rol === 'locatario');
  nuPadre.innerHTML = '';
  const first = document.createElement('option');
  first.value = '';
  first.textContent = locatarios.length ? '— Selecciona —' : '— No hay locatarios —';
  nuPadre.appendChild(first);
  locatarios.forEach(l => {
    const o = document.createElement('option');
    o.value = l.uid;
    o.textContent = l.nombre || l.uid;
    nuPadre.appendChild(o);
  });
}

function syncCrearFields() {
  const r = nuRol.value;
  nuLocPerms.hidden = (r !== 'locatario');
  nuPadreGroup.hidden = (r !== 'alumno');
  if (r === 'alumno') fillPadreDropdown();
}

function openCrear() {
  nuNombre.value = '';
  nuEmail.value = '';
  nuPass.value = '';
  nuVigencia.value = '';
  nuError.textContent = '';
  swPuerta.checked = true;
  swPorton.checked = false;
  swAlarma.checked = false;
  swInvitar.checked = false;
  fillRolDropdown();
  syncCrearFields();
  openModal(modalCrear);
}

async function crearUsuario() {
  const nombre = nuNombre.value.trim();
  const email  = nuEmail.value.trim();
  const pass   = nuPass.value;
  const rol    = nuRol.value;
  const vigVal = nuVigencia.value;

  nuError.textContent = '';
  if (!nombre || !email || !pass) { nuError.textContent = 'Completa nombre, correo y contraseña.'; return; }
  if (pass.length < 6) { nuError.textContent = 'La contraseña debe tener al menos 6 caracteres.'; return; }
  const permitidos = ROLES_POR_CREADOR[sessionUser.rol] || [];
  if (!permitidos.includes(rol)) { nuError.textContent = 'No tienes permiso para crear ese rol.'; return; }

  // Permisos según rol
  let permisoPuerta, permisoPorton, permisoAlarma, padreUid = null, puedeInvitar = null;
  if (rol === 'locatario') {
    permisoPuerta = swPuerta.checked;
    permisoPorton = swPorton.checked;
    permisoAlarma = swAlarma.checked;
    puedeInvitar  = swInvitar.checked;
  } else if (rol === 'alumno') {
    permisoPuerta = true; permisoPorton = false; permisoAlarma = false;
    padreUid = nuPadre.value || null;
  } else { // admin (master/admin siempre ven todo por la excepción de la UI)
    permisoPuerta = true; permisoPorton = true; permisoAlarma = true;
  }

  nuCrear.disabled = true;
  let createdUid = null;
  try {
    // Cuenta en la instancia SECUNDARIA → no toca la sesión del admin.
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, pass);
    createdUid = cred.user.uid;

    const data = {
      rol,
      nombre,
      suspendido: false,
      permisoPuerta,
      permisoPorton,
      permisoAlarma,
      padreUid,
      vigencia: vigVal ? dateInputToTimestamp(vigVal) : null,
      creadoPor: auth.currentUser.uid,
      creadoEn: serverTimestamp()
    };
    if (rol === 'locatario') data.puedeInvitarPorton = puedeInvitar;

    await setDoc(doc(db, 'usuarios', createdUid), data);
    closeModal(modalCrear);
    showExito(nombre, email, pass);
  } catch (err) {
    nuError.textContent = createdUid
      ? 'La cuenta se creó pero falló al guardar la ficha (' + (err.code || err.message) + '). Bórrala en la consola y reintenta.'
      : authErrorMessage(err.code);
  } finally {
    nuCrear.disabled = false;
    try { await signOut(secondaryAuth); } catch (_) {}
  }
}

// ══ MIS ALUMNOS (locatario) ═══════════════════════════════════════════════════════
let unsubAlumnos = null;
let alumnosCache = [];

function startAlumnosListener() {
  if (unsubAlumnos) return;
  const q = query(collection(db, 'usuarios'), where('padreUid', '==', sessionUser.uid));
  unsubAlumnos = onSnapshot(
    q,
    (snap) => {
      alumnosCache = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
      alumnosCache.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
      renderAlumnoList();
    },
    () => { alumnoListEl.textContent = 'No se pudo cargar la lista de alumnos.'; }
  );
}
function stopAlumnosListener() {
  if (unsubAlumnos) { unsubAlumnos(); unsubAlumnos = null; }
  alumnosCache = [];
}

function renderAlumnoList() {
  alumnoListEl.innerHTML = '';
  if (alumnosCache.length === 0) {
    const p = document.createElement('p');
    p.className = 'user-empty';
    p.textContent = 'Aún no tienes alumnos.';
    alumnoListEl.appendChild(p);
    return;
  }
  alumnosCache.forEach(u => alumnoListEl.appendChild(buildAlumnoCard(u)));
}

function buildAlumnoCard(u) {
  const card = document.createElement('div');
  card.className = 'user-card';

  const head = document.createElement('div');
  head.className = 'user-card-head';
  const name = document.createElement('span');
  name.className = 'user-name';
  name.textContent = (u.nombre && u.nombre.trim()) ? u.nombre : '(sin nombre)';
  const meta = document.createElement('div');
  meta.className = 'user-meta';
  meta.appendChild(estadoBadge(u.suspendido));
  head.append(name, meta);
  card.appendChild(head);

  const detail = document.createElement('div');
  detail.className = 'user-detail';
  const porton = document.createElement('span');
  porton.textContent = 'Portón: ' + (u.permisoPorton ? 'Sí' : 'No');
  const vig = document.createElement('span');
  vig.textContent = 'Vigencia: ' + formatVigencia(u.vigencia);
  detail.append(porton, vig);
  card.appendChild(detail);

  const actions = document.createElement('div');
  actions.className = 'user-actions';
  const bSusp = document.createElement('button');
  bSusp.className = 'btn-row';
  bSusp.textContent = u.suspendido ? 'Reactivar' : 'Suspender';
  bSusp.addEventListener('click', () => safeUpdate(u.uid, { suspendido: !u.suspendido }));
  const bVig = document.createElement('button');
  bVig.className = 'btn-row btn-row--gold';
  bVig.textContent = 'Vigencia';
  bVig.addEventListener('click', () => openVigencia(u));
  actions.append(bSusp, bVig);
  card.appendChild(actions);

  return card;
}

// ─── Crear alumno (locatario) ───────────────────────────────────────────────────
function openCrearAlumno() {
  alNombre.value = '';
  alEmail.value = '';
  alPass.value = '';
  alVigencia.value = '';
  alError.textContent = '';
  swAlPorton.checked = false;
  // El switch de portón solo aparece si el locatario puede invitar al portón.
  alPortonGroup.hidden = !(sessionUser && sessionUser.puedeInvitarPorton);
  openModal(modalAlumno);
}

async function crearAlumno() {
  const nombre = alNombre.value.trim();
  const email  = alEmail.value.trim();
  const pass   = alPass.value;
  const vigVal = alVigencia.value;

  alError.textContent = '';
  if (!nombre || !email || !pass) { alError.textContent = 'Completa nombre, correo y contraseña.'; return; }
  if (pass.length < 6) { alError.textContent = 'La contraseña debe tener al menos 6 caracteres.'; return; }

  // Portón solo si el locatario tiene permiso de invitar; si no, queda en false.
  const permisoPorton = sessionUser.puedeInvitarPorton ? swAlPorton.checked : false;

  alCrear.disabled = true;
  let createdUid = null;
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, pass);
    createdUid = cred.user.uid;

    await setDoc(doc(db, 'usuarios', createdUid), {
      rol: 'alumno',
      nombre,
      suspendido: false,
      permisoPuerta: true,   // forzado
      permisoPorton,         // a elección solo si puedeInvitarPorton
      permisoAlarma: false,  // forzado
      padreUid: sessionUser.uid,
      vigencia: vigVal ? dateInputToTimestamp(vigVal) : null,
      creadoPor: auth.currentUser.uid,
      creadoEn: serverTimestamp()
    });

    closeModal(modalAlumno);
    showExito(nombre, email, pass);
  } catch (err) {
    alError.textContent = createdUid
      ? 'La cuenta se creó pero falló al guardar la ficha (' + (err.code || err.message) + '). Bórrala en la consola y reintenta.'
      : authErrorMessage(err.code);
  } finally {
    alCrear.disabled = false;
    try { await signOut(secondaryAuth); } catch (_) {}
  }
}

// ─── Vigencia (modal compartido por admin y locatario) ──────────────────────────
let vigTargetUid = null;

function openVigencia(u) {
  vigTargetUid = u.uid;
  vigNombre.textContent = u.nombre || '';
  vigFecha.value = (u.vigencia && typeof u.vigencia.toDate === 'function')
    ? toDateInput(u.vigencia.toDate()) : '';
  vigError.textContent = '';
  openModal(modalVigencia);
}

// ─── Navegación de paneles ──────────────────────────────────────────────────────
function enterAdmin() {
  if (!sessionUser || !(sessionUser.rol === 'master' || sessionUser.rol === 'admin')) return;
  startAdminListener();
  showScreen('screen-admin');
}
function leaveAdmin() {
  stopAdminListener();
  closeAllModals();
  showScreen('screen-main');
}
function enterAlumnos() {
  if (!sessionUser || sessionUser.rol !== 'locatario') return;
  startAlumnosListener();
  showScreen('screen-misalumnos');
}
function leaveAlumnos() {
  stopAlumnosListener();
  closeAllModals();
  showScreen('screen-main');
}

// ─── Eventos ────────────────────────────────────────────────────────────────────
btnAdmin.addEventListener('click', enterAdmin);
btnAdminBack.addEventListener('click', leaveAdmin);
btnMisAlumnos.addEventListener('click', enterAlumnos);
btnAlumnosBack.addEventListener('click', leaveAlumnos);

btnCrearUsuario.addEventListener('click', openCrear);
nuGen.addEventListener('click', () => { nuPass.value = genPassword(); });
nuRol.addEventListener('change', syncCrearFields);
nuCancelar.addEventListener('click', () => closeModal(modalCrear));
nuCrear.addEventListener('click', crearUsuario);
modalCrear.addEventListener('click', (e) => { if (e.target === modalCrear) closeModal(modalCrear); });

btnCrearAlumno.addEventListener('click', openCrearAlumno);
alGen.addEventListener('click', () => { alPass.value = genPassword(); });
alCancelar.addEventListener('click', () => closeModal(modalAlumno));
alCrear.addEventListener('click', crearAlumno);
modalAlumno.addEventListener('click', (e) => { if (e.target === modalAlumno) closeModal(modalAlumno); });

exitoCerrar.addEventListener('click', () => closeModal(modalExito));

vigGuardar.addEventListener('click', async () => {
  if (!vigFecha.value) { vigError.textContent = 'Elige una fecha o usa "Quitar vigencia".'; return; }
  try {
    await updateDoc(doc(db, 'usuarios', vigTargetUid), { vigencia: dateInputToTimestamp(vigFecha.value) });
    closeModal(modalVigencia);
  } catch (err) {
    vigError.textContent = 'No se pudo guardar: ' + (err.code || err.message);
  }
});
vigQuitar.addEventListener('click', async () => {
  try {
    await updateDoc(doc(db, 'usuarios', vigTargetUid), { vigencia: null });
    closeModal(modalVigencia);
  } catch (err) {
    vigError.textContent = 'No se pudo quitar: ' + (err.code || err.message);
  }
});
vigCancelar.addEventListener('click', () => closeModal(modalVigencia));
modalVigencia.addEventListener('click', (e) => { if (e.target === modalVigencia) closeModal(modalVigencia); });

/* ──────────────────────────────────────────────────────────────
   Mi calendario · sincronizado con Google Calendar
   Web estática: no hay servidor. Google Calendar es la única
   fuente de datos, así que todo cambio aparece al instante en
   la app de Google y viceversa (con refresco periódico).
   ────────────────────────────────────────────────────────────── */
(() => {
  'use strict';

  // ── Configuración ───────────────────────────────────────────
  const CFG = Object.assign(
    { CLIENT_ID: '', DEFAULT_CALENDAR_ID: 'primary', REFRESH_SECONDS: 60 },
    window.APP_CONFIG || {}
  );
  const SCOPES = [
    'https://www.googleapis.com/auth/calendar.events',   // leer y escribir eventos
    'https://www.googleapis.com/auth/calendar.readonly', // listar tus calendarios
  ];
  const API = 'https://www.googleapis.com/calendar/v3';
  const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const LS = {
    token: 'mical.token',
    consent: 'mical.consent',
    calendar: 'mical.calendar',
  };

  // Paleta oficial de colores de evento de Google Calendar (colorId 1–11)
  const GOOGLE_COLORS = {
    1: { name: 'Lavanda', bg: '#7986cb' },
    2: { name: 'Salvia', bg: '#33b679' },
    3: { name: 'Uva', bg: '#8e24aa' },
    4: { name: 'Flamenco', bg: '#e67c73' },
    5: { name: 'Plátano', bg: '#f6bf26' },
    6: { name: 'Mandarina', bg: '#f4511e' },
    7: { name: 'Pavo real', bg: '#039be5' },
    8: { name: 'Grafito', bg: '#616161' },
    9: { name: 'Arándano', bg: '#3f51b5' },
    10: { name: 'Albahaca', bg: '#0b8043' },
    11: { name: 'Tomate', bg: '#d50000' },
  };

  // ── Estado ─────────────────────────────────────────────────
  let tokenClient = null;
  let accessToken = null;
  let tokenExpiry = 0;
  let pendingToken = [];
  let pendingSince = 0;
  let expiryTimer = null;

  let calendar = null;          // instancia de FullCalendar
  let calendars = [];           // lista de calendarios de Google
  let currentCalendarId = localStorage.getItem(LS.calendar) || CFG.DEFAULT_CALENDAR_ID;
  let calendarWritable = true;
  let calendarColor = '#039be5';

  let editing = null;           // { fcEvent, google } o null si es nuevo
  let deleteArmed = false;

  // ── Utilidades DOM ──────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const els = {
    loginScreen: $('#login-screen'),
    loginBtn: $('#login-btn'),
    loginMsg: $('#login-msg'),
    app: $('#app'),
    calSelect: $('#calendar-select'),
    calDot: $('#cal-dot'),
    syncStatus: $('#sync-status'),
    refreshBtn: $('#refresh-btn'),
    newBtn: $('#new-btn'),
    logoutBtn: $('#logout-btn'),
    reconnectBar: $('#reconnect-bar'),
    reconnectBtn: $('#reconnect-btn'),
    dialog: $('#event-dialog'),
    form: $('#event-form'),
    dialogTitle: $('#dialog-title'),
    readonlyNote: $('#readonly-note'),
    recurringNote: $('#recurring-note'),
    repeatField: $('#repeat-field'),
    seriesField: $('#series-field'),
    colorOptions: $('#color-options'),
    openInGoogle: $('#open-in-google'),
    deleteBtn: $('#delete-btn'),
    saveBtn: $('#save-btn'),
    toast: $('#toast'),
  };
  const f = els.form.elements;

  let toastTimer = null;
  function toast(msg, type = 'ok') {
    els.toast.textContent = msg;
    els.toast.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (els.toast.className = 'toast'), type === 'error' ? 6000 : 2800);
  }

  function setSync(state) {
    const map = {
      loading: ['Sincronizando…', 'loading'],
      ok: [`Sincronizado ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`, 'ok'],
      error: ['Error de sincronización', 'error'],
      offline: ['Sin conexión con Google', 'error'],
    };
    const [text, cls] = map[state] || ['', ''];
    els.syncStatus.textContent = text;
    els.syncStatus.className = `sync-status ${cls}`;
  }

  // ── Fechas ─────────────────────────────────────────────────
  const pad = (n) => String(n).padStart(2, '0');
  const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const addMinutes = (d, n) => new Date(d.getTime() + n * 60000);
  const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

  // ── Autenticación (Google Identity Services) ───────────────
  class AuthError extends Error {
    constructor(msg = 'Sesión de Google no válida') { super(msg); this.name = 'AuthError'; }
  }

  const tokenValid = () => !!accessToken && Date.now() < tokenExpiry - 30_000;

  function storeToken(token, expiresIn) {
    accessToken = token;
    tokenExpiry = Date.now() + Number(expiresIn || 3600) * 1000;
    try {
      localStorage.setItem(LS.token, JSON.stringify({ token, expiry: tokenExpiry }));
      localStorage.setItem(LS.consent, '1');
    } catch { /* almacenamiento no disponible */ }
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(showReconnect, Math.max(0, tokenExpiry - Date.now() - 30_000));
  }

  function loadStoredToken() {
    try {
      const t = JSON.parse(localStorage.getItem(LS.token) || 'null');
      if (t && t.expiry > Date.now() + 60_000) {
        accessToken = t.token;
        tokenExpiry = t.expiry;
        clearTimeout(expiryTimer);
        expiryTimer = setTimeout(showReconnect, Math.max(0, tokenExpiry - Date.now() - 30_000));
        return true;
      }
    } catch { /* ignorar */ }
    return false;
  }

  function clearToken() {
    accessToken = null;
    tokenExpiry = 0;
    clearTimeout(expiryTimer);
    try { localStorage.removeItem(LS.token); } catch { /* ignorar */ }
  }

  function settleToken(err, token) {
    const waiting = pendingToken;
    pendingToken = [];
    waiting.forEach(({ resolve, reject }) => (err ? reject(err) : resolve(token)));
  }

  function waitForGoogle(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function check() {
        if (window.google?.accounts?.oauth2) return resolve();
        if (Date.now() - t0 > timeoutMs) return reject(new Error('No se pudo cargar el inicio de sesión de Google. ¿Algún bloqueador de anuncios?'));
        setTimeout(check, 100);
      })();
    });
  }

  function initTokenClient() {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CFG.CLIENT_ID,
      scope: SCOPES.join(' '),
      callback: (resp) => {
        if (resp.error) return settleToken(new AuthError(resp.error_description || resp.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(resp, ...SCOPES)) {
          return settleToken(new AuthError('Necesito los dos permisos de Google Calendar. Vuelve a conectar y marca ambas casillas.'));
        }
        storeToken(resp.access_token, resp.expires_in);
        hideReconnect();
        settleToken(null, resp.access_token);
      },
      error_callback: (err) => {
        const msg = err?.type === 'popup_closed' ? 'Has cerrado la ventana de Google.'
          : err?.type === 'popup_failed_to_open' ? 'El navegador bloqueó la ventana emergente de Google. Permite pop-ups para esta web.'
          : 'No se pudo conectar con Google.';
        settleToken(new AuthError(msg));
      },
    });
  }

  /**
   * Devuelve un token válido. Si ha caducado y `interactive` es true,
   * abre la ventana de Google. IMPORTANTE: llamar antes de cualquier
   * `await` dentro de un clic, para que el navegador no bloquee el pop-up.
   */
  function ensureToken(interactive = true) {
    if (tokenValid()) return Promise.resolve(accessToken);
    if (!interactive || !tokenClient) {
      showReconnect();
      return Promise.reject(new AuthError());
    }
    // Si una petición anterior se quedó colgada (p. ej. pop-up bloqueado sin aviso), la descartamos.
    if (pendingToken.length && Date.now() - pendingSince > 60_000) settleToken(new AuthError('Tiempo de espera agotado.'));
    return new Promise((resolve, reject) => {
      pendingToken.push({ resolve, reject });
      if (pendingToken.length === 1) {
        pendingSince = Date.now();
        const consented = localStorage.getItem(LS.consent) === '1';
        tokenClient.requestAccessToken({ prompt: consented ? '' : 'consent' });
      }
    });
  }

  function showReconnect() {
    if (!els.app.hidden) els.reconnectBar.hidden = false;
  }
  function hideReconnect() {
    els.reconnectBar.hidden = true;
  }

  // ── Cliente de la API de Google Calendar ───────────────────
  async function api(path, { method = 'GET', query, body, interactive = true } = {}) {
    const token = await ensureToken(interactive);
    const url = new URL(API + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
      }
    }
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('Sin conexión. Revisa tu internet.');
    }
    if (res.status === 401) {
      clearToken();
      showReconnect();
      throw new AuthError();
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const reason = data?.error?.errors?.[0]?.reason;
      let msg = data?.error?.message || `Error ${res.status}`;
      if (res.status === 403 && reason === 'forbiddenForNonOrganizer') msg = 'Solo el organizador puede modificar este evento.';
      if (res.status === 403 && reason === 'accessNotConfigured') msg = 'La API de Google Calendar no está activada en tu proyecto de Google Cloud.';
      if (res.status === 410) msg = 'Este evento ya no existe (se borró en otro dispositivo).';
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const calPath = () => `/calendars/${encodeURIComponent(currentCalendarId)}/events`;
  const eventPath = (id) => `${calPath()}/${encodeURIComponent(id)}`;

  async function listEvents(start, end) {
    const items = [];
    let pageToken;
    do {
      const data = await api(calPath(), {
        interactive: false,
        query: {
          timeMin: start.toISOString(),
          timeMax: end.toISOString(),
          singleEvents: 'true',   // expande eventos periódicos en repeticiones
          orderBy: 'startTime',
          maxResults: 2500,
          pageToken,
        },
      });
      items.push(...(data.items || []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return items.filter((e) => e.status !== 'cancelled');
  }

  async function loadCalendars() {
    const data = await api('/users/me/calendarList', { query: { minAccessRole: 'reader' } });
    calendars = (data.items || []).sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0)
      || (a.summaryOverride || a.summary).localeCompare(b.summaryOverride || b.summary));

    const primary = calendars.find((c) => c.primary);
    if (currentCalendarId === 'primary' && primary) currentCalendarId = primary.id;
    if (!calendars.some((c) => c.id === currentCalendarId)) currentCalendarId = primary?.id || calendars[0]?.id || 'primary';

    els.calSelect.innerHTML = '';
    for (const c of calendars) {
      const opt = document.createElement('option');
      opt.value = c.id;
      const ro = !['owner', 'writer'].includes(c.accessRole) ? ' (solo lectura)' : '';
      opt.textContent = (c.summaryOverride || c.summary) + ro;
      els.calSelect.appendChild(opt);
    }
    els.calSelect.value = currentCalendarId;
    applyCalendarSettings();
  }

  function applyCalendarSettings() {
    const c = calendars.find((x) => x.id === currentCalendarId);
    calendarWritable = c ? ['owner', 'writer'].includes(c.accessRole) : true;
    calendarColor = c?.backgroundColor || '#039be5';
    els.calDot.style.background = calendarColor;
    els.newBtn.disabled = !calendarWritable;
    try { localStorage.setItem(LS.calendar, currentCalendarId); } catch { /* ignorar */ }
    if (calendar) {
      calendar.setOption('eventColor', calendarColor);
      calendar.setOption('selectable', calendarWritable);
    }
  }

  // ── Conversión Google ⇄ FullCalendar ───────────────────────
  function isEditable(g) {
    if (!calendarWritable) return false;
    if (g.eventType && g.eventType !== 'default') return false; // cumpleaños, Gmail, fuera de oficina…
    const isOrganizer = !g.organizer || g.organizer.self === true;
    return isOrganizer || g.guestsCanModify === true;
  }

  function toFcEvent(g) {
    const allDay = !!g.start?.date;
    const color = g.colorId ? GOOGLE_COLORS[g.colorId]?.bg : undefined;
    return {
      id: g.id,
      title: g.summary || '(Sin título)',
      start: allDay ? g.start.date : g.start.dateTime,
      end: allDay ? g.end?.date : g.end?.dateTime,
      allDay,
      backgroundColor: color,
      borderColor: color,
      editable: isEditable(g),
      classNames: g.recurringEventId ? ['is-recurring'] : [],
      extendedProps: { google: g },
    };
  }

  /** Construye start/end en formato Google. Incluye `null` explícitos para
   *  que un PATCH pueda pasar de evento con hora a evento de día completo. */
  function googleTimes({ start, end, allDay }) {
    if (allDay) {
      return {
        start: { date: fmtDate(start), dateTime: null, timeZone: null },
        end: { date: fmtDate(end), dateTime: null, timeZone: null },
      };
    }
    return {
      start: { dateTime: start.toISOString(), timeZone: TZ, date: null },
      end: { dateTime: end.toISOString(), timeZone: TZ, date: null },
    };
  }

  const stripNulls = (obj) => JSON.parse(JSON.stringify(obj, (k, v) => (v === null ? undefined : v)));

  // ── Formulario ─────────────────────────────────────────────
  function buildColorOptions() {
    const add = (value, bg, title) => {
      const label = document.createElement('label');
      label.className = 'swatch';
      label.title = title;
      label.innerHTML = `<input type="radio" name="color" value="${value}"><span style="background:${bg}"></span>`;
      els.colorOptions.appendChild(label);
    };
    add('', 'var(--cal-color)', 'Color del calendario');
    for (const [id, c] of Object.entries(GOOGLE_COLORS)) add(id, c.bg, c.name);
  }

  function syncTimeInputs() {
    const allDay = f.allDay.checked;
    els.form.classList.toggle('all-day', allDay);
    f.startTime.required = !allDay;
    f.endTime.required = !allDay;
  }

  function setFormDisabled(disabled) {
    for (const el of els.form.elements) {
      if (el.matches('[data-close]')) continue;
      el.disabled = disabled;
    }
  }

  /**
   * Abre el formulario.
   *  - Nuevo: openDialog({ start, end, allDay })
   *  - Editar: openDialog({ fcEvent })
   */
  function openDialog({ fcEvent = null, start, end, allDay = false } = {}) {
    els.form.reset();
    deleteArmed = false;
    els.deleteBtn.textContent = 'Eliminar';
    els.colorOptions.style.setProperty('--cal-color', calendarColor);

    const g = fcEvent?.extendedProps.google || null;
    editing = fcEvent ? { fcEvent, google: g } : null;

    if (fcEvent) {
      allDay = fcEvent.allDay;
      start = fcEvent.start;
      end = fcEvent.end || (allDay ? addDays(start, 1) : addMinutes(start, 60));
    } else {
      start = start || roundToNextHalfHour(new Date());
      end = end || (allDay ? addDays(start, 1) : addMinutes(start, 60));
    }

    // En Google el fin de un evento de día completo es exclusivo: en el
    // formulario mostramos el último día incluido.
    const endShown = allDay ? addDays(end, -1) : end;

    f.title.value = g?.summary || '';
    f.allDay.checked = allDay;
    f.startDate.value = fmtDate(start);
    f.endDate.value = fmtDate(endShown < start ? start : endShown);
    f.startTime.value = allDay ? '09:00' : fmtTime(start);
    f.endTime.value = allDay ? '10:00' : fmtTime(end);
    f.location.value = g?.location || '';
    f.description.value = g?.description || '';
    const colorInput = els.form.querySelector(`input[name="color"][value="${g?.colorId || ''}"]`);
    if (colorInput) colorInput.checked = true;

    const isInstance = !!g?.recurringEventId;
    const isSeriesMaster = !!g?.recurrence;
    const editable = fcEvent ? isEditable(g) : calendarWritable;

    els.dialogTitle.textContent = !fcEvent ? 'Nuevo evento' : editable ? 'Editar evento' : 'Detalles del evento';
    els.readonlyNote.hidden = !fcEvent || editable;
    els.recurringNote.hidden = !isInstance;
    els.repeatField.hidden = isInstance || isSeriesMaster;
    els.seriesField.hidden = !isInstance || !editable;
    els.deleteBtn.hidden = !fcEvent || !editable;
    els.saveBtn.hidden = !editable;
    els.openInGoogle.hidden = !g?.htmlLink;
    if (g?.htmlLink) els.openInGoogle.href = g.htmlLink;

    setFormDisabled(!editable);
    syncTimeInputs();
    els.dialog.showModal();
    if (editable) setTimeout(() => f.title.focus(), 30);
  }

  function closeDialog() {
    els.dialog.close();
    editing = null;
    calendar?.unselect();
  }

  function roundToNextHalfHour(d) {
    const x = new Date(d);
    x.setSeconds(0, 0);
    x.setMinutes(x.getMinutes() <= 30 ? 30 : 60);
    return x;
  }

  /** Lee y valida el formulario. Devuelve el cuerpo para la API o lanza un error. */
  function readForm() {
    const allDay = f.allDay.checked;
    if (!f.startDate.value || !f.endDate.value) throw new Error('Indica la fecha de inicio y de fin.');

    let start, end;
    if (allDay) {
      start = parseDate(f.startDate.value);
      const lastDay = parseDate(f.endDate.value);
      if (lastDay < start) throw new Error('La fecha de fin no puede ser anterior a la de inicio.');
      end = addDays(lastDay, 1);
    } else {
      if (!f.startTime.value || !f.endTime.value) throw new Error('Indica la hora de inicio y de fin.');
      start = new Date(`${f.startDate.value}T${f.startTime.value}`);
      end = new Date(`${f.endDate.value}T${f.endTime.value}`);
      if (end <= start) throw new Error('El fin tiene que ser posterior al inicio.');
    }

    const body = {
      summary: f.title.value.trim() || '(Sin título)',
      location: f.location.value.trim(),
      description: f.description.value.trim(),
      colorId: els.form.querySelector('input[name="color"]:checked')?.value || null,
      ...googleTimes({ start, end, allDay }),
    };
    if (!els.repeatField.hidden && f.repeat.value) {
      body.recurrence = [`RRULE:FREQ=${f.repeat.value}`];
    }
    return body;
  }

  function setBusy(busy) {
    els.saveBtn.disabled = busy;
    els.deleteBtn.disabled = busy;
    els.saveBtn.textContent = busy ? 'Guardando…' : 'Guardar';
  }

  function handleError(err) {
    console.error(err);
    if (err instanceof AuthError) {
      toast(err.message === 'Sesión de Google no válida' ? 'Sesión caducada: pulsa «Reconectar» y vuelve a intentarlo.' : err.message, 'error');
    } else {
      toast(err.message || 'Algo ha fallado.', 'error');
    }
  }

  // Crear / guardar
  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    let body;
    try { body = readForm(); } catch (err) { return toast(err.message, 'error'); }

    // Pedir el token AQUÍ, sincrónicamente dentro del clic (evita bloqueo del pop-up).
    const tokenReady = ensureToken(true);
    setBusy(true);
    (async () => {
      try {
        await tokenReady;
        if (editing) {
          await api(eventPath(editing.google.id), { method: 'PATCH', body });
          toast('Evento actualizado');
        } else {
          await api(calPath(), { method: 'POST', body: stripNulls(body) });
          toast('Evento creado');
        }
        closeDialog();
        calendar.refetchEvents();
      } catch (err) {
        handleError(err);
      } finally {
        setBusy(false);
      }
    })();
  });

  // Eliminar (pide confirmación con un segundo clic)
  els.deleteBtn.addEventListener('click', () => {
    if (!editing) return;
    if (!deleteArmed) {
      deleteArmed = true;
      els.deleteBtn.textContent = '¿Seguro? Pulsa otra vez';
      return;
    }
    const g = editing.google;
    const id = f.deleteSeries.checked && g.recurringEventId ? g.recurringEventId : g.id;
    const tokenReady = ensureToken(true);
    setBusy(true);
    (async () => {
      try {
        await tokenReady;
        await api(eventPath(id), { method: 'DELETE' });
        toast(id === g.id ? 'Evento eliminado' : 'Serie eliminada');
        closeDialog();
        calendar.refetchEvents();
      } catch (err) {
        if (err.status === 410) { closeDialog(); calendar.refetchEvents(); }
        handleError(err);
      } finally {
        setBusy(false);
      }
    })();
  });

  els.form.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeDialog));
  els.dialog.addEventListener('cancel', () => { editing = null; calendar?.unselect(); });
  els.dialog.addEventListener('click', (e) => { if (e.target === els.dialog) closeDialog(); });
  f.allDay.addEventListener('change', syncTimeInputs);
  f.startDate.addEventListener('change', () => {
    if (f.endDate.value < f.startDate.value) f.endDate.value = f.startDate.value;
  });

  // ── Arrastrar y redimensionar ──────────────────────────────
  function onMoveOrResize(info) {
    const ev = info.event;
    const allDay = ev.allDay;
    const start = ev.start;
    const end = ev.end || (allDay ? addDays(start, 1) : addMinutes(start, 60));
    const tokenReady = ensureToken(true);
    (async () => {
      try {
        await tokenReady;
        await api(eventPath(ev.id), { method: 'PATCH', body: googleTimes({ start, end, allDay }) });
        toast(info.event.extendedProps.google?.recurringEventId ? 'Repetición movida' : 'Evento movido');
        calendar.refetchEvents();
      } catch (err) {
        info.revert();
        handleError(err);
      }
    })();
  }

  // ── Calendario (FullCalendar) ──────────────────────────────
  function createCalendar() {
    const narrow = window.matchMedia('(max-width: 700px)').matches;
    calendar = new FullCalendar.Calendar(document.getElementById('calendar'), {
      locale: 'es',
      firstDay: 1,
      timeZone: 'local',
      height: '100%',
      initialView: narrow ? 'listWeek' : 'dayGridMonth',
      headerToolbar: narrow
        ? { left: 'prev,next', center: 'title', right: 'today' }
        : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' },
      footerToolbar: narrow ? { center: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' } : false,
      nowIndicator: true,
      navLinks: true,
      dayMaxEvents: true,
      selectable: calendarWritable,
      selectMirror: true,
      editable: true,
      eventColor: calendarColor,
      scrollTime: '08:00:00',
      eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },

      events: async (info, success, failure) => {
        setSync('loading');
        try {
          const items = await listEvents(info.start, info.end);
          success(items.map(toFcEvent));
          setSync('ok');
        } catch (err) {
          failure(err);
          setSync(err instanceof AuthError ? 'offline' : 'error');
          if (!(err instanceof AuthError)) handleError(err);
        }
      },

      select: (info) => {
        let { start, end } = info;
        // Un clic en la vista semana/día selecciona 30 min: lo ampliamos a 1 h.
        if (!info.allDay && end - start <= 30 * 60000) end = addMinutes(start, 60);
        openDialog({ start, end, allDay: info.allDay });
      },
      eventClick: (info) => {
        info.jsEvent.preventDefault();
        openDialog({ fcEvent: info.event });
      },
      eventDrop: onMoveOrResize,
      eventResize: onMoveOrResize,
    });
    calendar.render();
  }

  // ── Arranque y sesión ──────────────────────────────────────
  async function enterApp() {
    els.loginScreen.hidden = true;
    els.app.hidden = false;
    hideReconnect();
    try {
      await loadCalendars();
    } catch (err) {
      handleError(err);
    }
    if (!calendar) createCalendar();
    else { applyCalendarSettings(); calendar.refetchEvents(); }
  }

  function showLogin(msg = '') {
    els.app.hidden = true;
    els.loginScreen.hidden = false;
    els.loginMsg.textContent = msg;
  }

  els.loginBtn.addEventListener('click', () => {
    els.loginMsg.textContent = '';
    ensureToken(true).then(enterApp).catch((err) => {
      els.loginMsg.textContent = err.message;
    });
  });

  els.reconnectBtn.addEventListener('click', () => {
    ensureToken(true).then(() => {
      hideReconnect();
      calendar?.refetchEvents();
      toast('Reconectado');
    }).catch(handleError);
  });

  els.logoutBtn.addEventListener('click', () => {
    const token = accessToken;
    clearToken();
    try { localStorage.removeItem(LS.consent); } catch { /* ignorar */ }
    if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
    calendar?.removeAllEvents();
    showLogin('Has cerrado la sesión.');
  });

  els.calSelect.addEventListener('change', () => {
    currentCalendarId = els.calSelect.value;
    applyCalendarSettings();
    calendar?.refetchEvents();
  });

  els.refreshBtn.addEventListener('click', () => {
    if (!tokenValid()) {
      ensureToken(true).then(() => calendar?.refetchEvents()).catch(handleError);
    } else {
      calendar?.refetchEvents();
    }
  });

  els.newBtn.addEventListener('click', () => openDialog());

  // Tecla N = nuevo evento
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (els.dialog.open || els.app.hidden || !calendarWritable) return;
    if (/^(input|textarea|select)$/i.test(document.activeElement?.tagName)) return;
    e.preventDefault();
    openDialog();
  });

  // Refresco automático: trae cambios hechos desde otros dispositivos
  function autoRefresh() {
    if (!calendar || els.app.hidden || els.dialog.open) return;
    if (document.visibilityState !== 'visible') return;
    if (!tokenValid()) return showReconnect();
    calendar.refetchEvents();
  }
  setInterval(autoRefresh, Math.max(15, Number(CFG.REFRESH_SECONDS) || 60) * 1000);
  document.addEventListener('visibilitychange', autoRefresh);

  async function boot() {
    buildColorOptions();

    if (!CFG.CLIENT_ID || CFG.CLIENT_ID.startsWith('TU_CLIENT_ID')) {
      showLogin('Falta configurar el CLIENT_ID en config.js (mira el README).');
      return;
    }
    if (location.protocol === 'file:') {
      showLogin('Abre la página desde un servidor (GitHub Pages o «python3 -m http.server»), no como archivo.');
      return;
    }

    try {
      await waitForGoogle();
      initTokenClient();
      els.loginBtn.disabled = false;
    } catch (err) {
      showLogin(err.message);
      return;
    }

    if (loadStoredToken()) enterApp();
    else showLogin();
  }

  boot();
})();

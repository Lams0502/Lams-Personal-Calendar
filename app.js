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
    shiftNote: $('#shift-note'),
    shiftsBtn: $('#shifts-btn'),
    shiftsDialog: $('#shifts-dialog'),
    shiftsBody: $('#shifts-body'),
    shiftsConfirm: $('#shifts-confirm'),
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
      err.reason = reason;
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
    els.shiftsBtn.disabled = !calendarWritable;
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
    els.shiftNote.hidden = g?.extendedProperties?.private?.turnosSync !== '1';
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

  // ── Sincronización de turnos de trabajo ────────────────────
  //  Lee la planificación (CSV publicado), coge SOLO la fila del operador
  //  configurado y la refleja en el calendario: crea los turnos nuevos,
  //  corrige los cambiados y borra los que ya no están en el cuadrante.
  //  Cada turno lleva una marca privada (turnosSync) para no tocar nunca
  //  tus otros eventos ni duplicar turnos al sincronizar varias veces.
  const SHIFT_TYPES = {
    MA: { label: 'Mañana', place: 'Arteixo', start: '07:00', end: '15:00', colorId: '5' },
    ML: { label: 'Mañana', place: 'Laracha', start: '07:00', end: '15:00', colorId: '5' },
    TA: { label: 'Tarde', place: 'Arteixo', start: '15:00', end: '23:00', colorId: '6' },
    TL: { label: 'Tarde', place: 'Laracha', start: '15:00', end: '23:00', colorId: '6' },
    NA: { label: 'Noche', place: 'Arteixo', start: '23:00', end: '07:00', colorId: '9' },
    NL: { label: 'Noche', place: 'Laracha', start: '23:00', end: '07:00', colorId: '9' },
  };
  const MONTHS_ES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
  const SHIFT_TAG = 'turnosSync';
  const normName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const fmtHuman = (iso) => parseDate(iso).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  let shiftPlan = null;

  /** Formato del CSV: fila 1 = año + meses, fila 2 = días de la semana,
   *  fila 3 = número de día, resto = una fila por operador con códigos. */
  function parseShiftsCsv(text, operator) {
    const rows = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.split(';'));
    if (rows.length < 4) throw new Error('El archivo de turnos no tiene el formato esperado.');
    const monthRow = rows[0];
    const dayRow = rows[2];
    let year = parseInt(monthRow[0], 10) || new Date().getFullYear();
    let month = -1;
    const colDate = {};
    for (let c = 1; c < monthRow.length; c++) {
      const mi = MONTHS_ES.indexOf((monthRow[c] || '').trim().toUpperCase());
      if (mi >= 0) {
        if (month >= 0 && mi < month) year++; // diciembre → enero
        month = mi;
      }
      const day = parseInt(dayRow[c], 10);
      if (month >= 0 && day >= 1 && day <= 31) colDate[c] = `${year}-${pad(month + 1)}-${pad(day)}`;
    }

    const row = rows.find((r) => normName(r[0]) === normName(operator));
    if (!row) throw new Error(`No encuentro al operador «${operator}» en la planificación.`);

    const shifts = [];
    const unknown = new Set();
    let undated = 0;
    for (let c = 1; c < row.length; c++) {
      const code = (row[c] || '').trim().toUpperCase();
      if (!code) continue;
      if (!colDate[c]) { undated++; continue; }
      if (!SHIFT_TYPES[code]) { unknown.add(code); continue; }
      shifts.push({ date: colDate[c], code });
    }
    return { shifts, unknown: [...unknown], undated };
  }

  function shiftEventBody(s, tz) {
    const t = SHIFT_TYPES[s.code];
    const endDate = t.end <= t.start ? fmtDate(addDays(parseDate(s.date), 1)) : s.date; // noche: acaba al día siguiente
    return {
      summary: `Turno ${t.label} · ${t.place}`,
      location: t.place,
      description: `Turno ${s.code}: ${t.label} ${t.place}, de ${t.start} a ${t.end}.\nSincronizado desde la planificación de operaciones. Si lo cambias a mano, la próxima sincronización puede sobrescribirlo.`,
      colorId: t.colorId,
      start: { dateTime: `${s.date}T${t.start}:00`, timeZone: tz },
      end: { dateTime: `${endDate}T${t.end}:00`, timeZone: tz },
      extendedProperties: {
        private: { [SHIFT_TAG]: '1', turnoDate: s.date, turnoCode: s.code, turnoOperador: CFG.TURNOS.OPERADOR },
      },
    };
  }

  async function listSyncedShiftEvents(fromDate) {
    const items = [];
    let pageToken;
    do {
      const data = await api(calPath(), {
        query: {
          privateExtendedProperty: `${SHIFT_TAG}=1`,
          timeMin: fromDate ? addDays(parseDate(fromDate), -1).toISOString() : undefined,
          singleEvents: 'true',
          maxResults: 2500,
          pageToken,
        },
      });
      items.push(...(data.items || []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return items.filter((e) => {
      const d = e.extendedProperties?.private?.turnoDate || '';
      return e.status !== 'cancelled' && (!fromDate || d >= fromDate);
    });
  }

  async function buildShiftPlan() {
    const T = CFG.TURNOS;
    let text;
    try {
      const url = T.CSV_URL + (T.CSV_URL.includes('?') ? '&' : '?') + 't=' + Date.now();
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error();
      text = await res.text();
    } catch {
      throw new Error('No he podido leer la planificación de turnos. Comprueba la dirección en config.js o tu conexión.');
    }
    const parsed = parseShiftsCsv(text, T.OPERADOR);
    const fromDate = T.SOLO_DESDE_HOY === false ? null : fmtDate(new Date());
    const wanted = parsed.shifts.filter((s) => !fromDate || s.date >= fromDate);
    const existing = await listSyncedShiftEvents(fromDate);

    const byDate = new Map();
    for (const e of existing) {
      const d = e.extendedProperties.private.turnoDate;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(e);
    }

    const tz = T.ZONA_HORARIA || 'Europe/Madrid';
    const plan = { create: [], update: [], remove: [], same: 0, wanted, fromDate, ...parsed };
    for (const s of wanted) {
      const [first, ...dups] = byDate.get(s.date) || [];
      byDate.delete(s.date);
      plan.remove.push(...dups);
      const body = shiftEventBody(s, tz);
      if (!first) plan.create.push(body);
      else if (first.extendedProperties.private.turnoCode !== s.code) plan.update.push({ id: first.id, body });
      else plan.same++;
    }
    for (const list of byDate.values()) plan.remove.push(...list); // ya no están en el cuadrante
    return plan;
  }

  function renderShiftPlan(plan) {
    const calName = els.calSelect.selectedOptions[0]?.textContent || 'tu calendario';
    const nothing = !plan.create.length && !plan.update.length && !plan.remove.length;
    const next = plan.wanted.slice(0, 6).map((s) => {
      const t = SHIFT_TYPES[s.code];
      return `<li><strong>${esc(fmtHuman(s.date))}</strong> · ${t.label} ${t.place} <span class="muted">(${t.start}–${t.end})</span></li>`;
    }).join('');
    els.shiftsBody.innerHTML = `
      <p>Operador: <strong>${esc(CFG.TURNOS.OPERADOR)}</strong><br>Calendario: <strong>${esc(calName)}</strong></p>
      <p class="muted">${plan.fromDate ? 'Turnos de hoy en adelante' : 'Todos los turnos'} en el cuadrante: <strong>${plan.wanted.length}</strong></p>
      <ul class="plan-list">
        <li><span>Nuevos</span><strong>${plan.create.length}</strong></li>
        <li><span>Cambiados en el cuadrante</span><strong>${plan.update.length}</strong></li>
        <li><span>Ya no están en el cuadrante (se borran)</span><strong>${plan.remove.length}</strong></li>
        <li><span>Sin cambios</span><strong>${plan.same}</strong></li>
      </ul>
      ${next ? `<p class="muted">Próximos turnos:</p><ul class="next-list">${next}</ul>` : ''}
      ${plan.unknown.length ? `<p class="note">Códigos que no reconozco y se ignoran: ${esc(plan.unknown.join(', '))}</p>` : ''}
      ${plan.undated ? `<p class="note">${plan.undated} turno(s) al final del cuadrante no tienen fecha en el archivo y no se importan.</p>` : ''}
      ${nothing ? '<p class="note">Todo está al día: no hay nada que cambiar.</p>' : ''}`;
    els.shiftsConfirm.disabled = nothing;
    els.shiftsConfirm.textContent = 'Sincronizar';
  }

  async function withRetry(fn, tries = 4) {
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (err) {
        const retryable = err.status === 429 || err.status >= 500 || (err.status === 403 && /rateLimit/i.test(err.reason || ''));
        if (!retryable || i >= tries - 1) throw err;
        await new Promise((r) => setTimeout(r, 800 * 2 ** i));
      }
    }
  }

  async function applyShiftPlan(plan) {
    const ops = [
      ...plan.remove.map((e) => () => api(eventPath(e.id), { method: 'DELETE' })
        .catch((err) => { if (err.status !== 404 && err.status !== 410) throw err; })),
      ...plan.update.map((u) => () => api(eventPath(u.id), { method: 'PATCH', body: u.body })),
      ...plan.create.map((b) => () => api(calPath(), { method: 'POST', body: b })),
    ];
    const total = ops.length;
    let done = 0;
    let failed = 0;
    const worker = async () => {
      while (ops.length) {
        const op = ops.shift();
        try {
          await withRetry(op);
        } catch (err) {
          if (err instanceof AuthError) throw err;
          failed++;
          console.error(err);
        }
        done++;
        els.shiftsConfirm.textContent = `Sincronizando ${done}/${total}…`;
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return { total, failed };
  }

  els.shiftsBtn.addEventListener('click', () => {
    const tokenReady = ensureToken(true); // dentro del clic: evita bloqueo del pop-up
    shiftPlan = null;
    els.shiftsBody.innerHTML = '<p class="muted">Leyendo la planificación y tu calendario…</p>';
    els.shiftsConfirm.disabled = true;
    els.shiftsConfirm.textContent = 'Sincronizar';
    els.shiftsDialog.showModal();
    (async () => {
      try {
        await tokenReady;
        shiftPlan = await buildShiftPlan();
        renderShiftPlan(shiftPlan);
      } catch (err) {
        console.error(err);
        els.shiftsBody.innerHTML = `<p class="note error-note">${esc(err instanceof AuthError ? 'Sesión caducada: pulsa «Reconectar» y vuelve a intentarlo.' : err.message)}</p>`;
      }
    })();
  });

  els.shiftsConfirm.addEventListener('click', () => {
    if (!shiftPlan) return;
    const plan = shiftPlan;
    shiftPlan = null;
    const tokenReady = ensureToken(true);
    els.shiftsConfirm.disabled = true;
    (async () => {
      try {
        await tokenReady;
        const { total, failed } = await applyShiftPlan(plan);
        els.shiftsDialog.close();
        toast(failed
          ? `Turnos sincronizados, pero ${failed} cambio(s) fallaron. Pulsa «Turnos» otra vez para completarlo.`
          : `Turnos sincronizados (${total} cambio${total === 1 ? '' : 's'}).`, failed ? 'error' : 'ok');
      } catch (err) {
        els.shiftsDialog.close();
        handleError(err);
      } finally {
        calendar?.refetchEvents();
      }
    })();
  });

  els.shiftsDialog.querySelectorAll('[data-close-shifts]').forEach((b) => b.addEventListener('click', () => els.shiftsDialog.close()));
  els.shiftsDialog.addEventListener('click', (e) => { if (e.target === els.shiftsDialog) els.shiftsDialog.close(); });

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
    if (!calendar || els.app.hidden || els.dialog.open || els.shiftsDialog.open) return;
    if (document.visibilityState !== 'visible') return;
    if (!tokenValid()) return showReconnect();
    calendar.refetchEvents();
  }
  setInterval(autoRefresh, Math.max(15, Number(CFG.REFRESH_SECONDS) || 60) * 1000);
  document.addEventListener('visibilitychange', autoRefresh);

  async function boot() {
    buildColorOptions();
    els.shiftsBtn.hidden = !(CFG.TURNOS && CFG.TURNOS.CSV_URL && CFG.TURNOS.OPERADOR);

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

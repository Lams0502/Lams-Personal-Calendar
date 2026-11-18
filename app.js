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
  let lastViewType = null;
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
    pop: $('#event-pop'),
    meetBtn: $('#meet-btn'),
    nextShift: $('#next-shift'),
    meetLink: $('#meet-link'),
    notifyField: $('#notify-field'),
    routineBtn: $('#routine-btn'),
    routineDialog: $('#routine-dialog'),
    routineBody: $('#routine-body'),
    routineConfirm: $('#routine-confirm'),
    bottomNav: $('#bottom-nav'),
    fab: $('#fab'),
    moreBtn: $('#more-btn'),
    moreMenu: $('#more-menu'),
    calSelectMobile: $('#calendar-select-mobile'),
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
    els.calSelectMobile.innerHTML = els.calSelect.innerHTML;
    els.calSelectMobile.value = currentCalendarId;
    applyCalendarSettings();
  }

  function applyCalendarSettings() {
    const c = calendars.find((x) => x.id === currentCalendarId);
    calendarWritable = c ? ['owner', 'writer'].includes(c.accessRole) : true;
    calendarColor = c?.backgroundColor || '#039be5';
    els.calDot.style.background = calendarColor;
    els.newBtn.disabled = !calendarWritable;
    els.shiftsBtn.disabled = !calendarWritable;
    els.meetBtn.disabled = !calendarWritable;
    els.routineBtn.disabled = !calendarWritable;
    els.fab.disabled = !calendarWritable;
    try { localStorage.setItem(LS.calendar, currentCalendarId); } catch { /* ignorar */ }
    if (calendar) {
      calendar.setOption('eventColor', calendarColor);
      calendar.setOption('selectable', calendarWritable);
    }
  }

  // ── Conversión Google ⇄ FullCalendar ───────────────────────
  const isInvite = (g) => !!g.organizer && g.organizer.self !== true;
  const selfAttendee = (g) => (g.attendees || []).find((a) => a.self);
  const shiftOf = (g) => SHIFT_TYPES[g?.extendedProperties?.private?.turnoCode] || null;

  /**
   * Qué puedes hacer con un evento:
   *  'full'    → editar todo, mover y eliminar (eres el organizador)
   *  'limited' → quitarlo de tu calendario y responder (invitaciones, eventos de Gmail…)
   *  'none'    → solo ver (calendario de solo lectura, cumpleaños)
   */
  function permission(g) {
    if (!calendarWritable || g.eventType === 'birthday') return 'none';
    const isDefault = !g.eventType || g.eventType === 'default';
    if (isDefault && (!isInvite(g) || g.guestsCanModify === true)) return 'full';
    return 'limited';
  }
  const isEditable = (g) => permission(g) === 'full';

  function toFcEvent(g) {
    const allDay = !!g.start?.date;
    const shift = shiftOf(g);
    const color = !shift && !routineKind(g) && g.colorId ? GOOGLE_COLORS[g.colorId]?.bg : undefined;
    const me = selfAttendee(g);
    return {
      id: g.id,
      title: g.summary || '(Sin título)',
      start: allDay ? g.start.date : g.start.dateTime,
      end: allDay ? g.end?.date : g.end?.dateTime,
      allDay,
      backgroundColor: color,
      borderColor: color,
      editable: isEditable(g),
      classNames: [
        g.recurringEventId && 'is-recurring',
        shift && `shift shift-${shift.kind}`,
        routineKind(g) && `routine routine-${routineKind(g)}`,
        g.hangoutLink && 'has-meet',
        isInvite(g) && 'is-invite',
        me?.responseStatus === 'declined' && 'is-declined',
        me?.responseStatus === 'needsAction' && 'is-pending',
      ].filter(Boolean),
      extendedProps: { google: g },
    };
  }

  /** Contenido visual de cada evento (icono + hora + título). */
  function renderEventContent(arg) {
    const g = arg.event.extendedProps.google || {};
    const shift = shiftOf(g);
    const icon = shift ? shift.icon : g.hangoutLink ? '🎥' : '';
    const iconHtml = icon ? `<span class="ev-ico">${icon}</span>` : '';
    const title = esc(shift ? `${shift.label} · ${shift.place}` : arg.event.title);
    const time = arg.timeText ? `<span class="ev-time">${esc(arg.timeText)}</span>` : '';
    const type = arg.view.type;
    if (type.startsWith('list')) return { html: `${iconHtml}<span class="ev-title">${title}</span>` };
    const mins = arg.event.end ? (arg.event.end - arg.event.start) / 60000 : 60;
    if (type.startsWith('timeGrid') && mins <= 40) {
      return { html: `<div class="ev ev-compact">${iconHtml}<span class="ev-title">${title}</span>${time}</div>` };
    }
    if (type.startsWith('timeGrid')) {
      const sub = shift ? `${shift.start}–${shift.end}` : esc(g.location || '');
      return { html: `<div class="ev ev-tg"><div class="ev-title">${iconHtml}${title}</div>${time}${sub && !shift ? `<div class="ev-sub">${sub}</div>` : ''}</div>` };
    }
    return { html: `<div class="ev">${iconHtml}${time}<span class="ev-title">${title}</span></div>` };
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
  function openDialog({ fcEvent = null, start, end, allDay = false, meet = false, title = '' } = {}) {
    closePopover();
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

    f.title.value = g?.summary || title;
    f.meet.checked = g ? !!(g.hangoutLink || g.conferenceData) : meet;
    f.guests.value = (g?.attendees || []).filter((a) => !a.self && !a.resource).map((a) => a.email).join(', ');
    f.notify.checked = true;
    const meetA = els.meetLink.querySelector('a');
    els.meetLink.hidden = !g?.hangoutLink;
    if (g?.hangoutLink) { meetA.href = g.hangoutLink; meetA.textContent = g.hangoutLink.replace(/^https?:\/\//, ''); }
    syncNotifyField();
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

    els.dialogTitle.textContent = !fcEvent ? (meet ? 'Nueva reunión de Google Meet' : 'Nuevo evento') : editable ? 'Editar evento' : 'Detalles del evento';
    els.readonlyNote.hidden = !fcEvent || editable;
    els.recurringNote.hidden = !isInstance;
    const isRoutine = !!routineKind(g);
    els.shiftNote.hidden = g?.extendedProperties?.private?.turnosSync !== '1' && !isRoutine;
    els.shiftNote.textContent = isRoutine
      ? 'Bloque de tu rutina. Si lo cambias a mano, la próxima vez que pulses «Rutina» puede recolocarse.'
      : 'Turno sincronizado desde el cuadrante. Si lo cambias a mano, la próxima sincronización puede sobrescribirlo.';
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

    // Invitados: conserva las respuestas de los que ya estaban.
    const orig = editing?.google || null;
    const emails = [...new Set(f.guests.value.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
    const bad = emails.find((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (bad) throw new Error(`Este email no es válido: ${bad}`);
    const prev = new Map((orig?.attendees || []).map((a) => [a.email.toLowerCase(), a]));
    const keep = (orig?.attendees || []).filter((a) => a.self || a.resource);
    const attendees = [...keep, ...emails.filter((e) => !keep.some((k) => k.email.toLowerCase() === e)).map((e) => prev.get(e) || { email: e })];
    if (emails.length || orig?.attendees?.length) body.attendees = attendees;

    // Google Meet
    const hadMeet = !!(orig?.hangoutLink || orig?.conferenceData);
    if (f.meet.checked && !hadMeet) {
      body.conferenceData = { createRequest: { requestId: uuid(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
    } else if (!f.meet.checked && hadMeet) {
      body.conferenceData = null;
    }

    const notify = emails.length > 0 && f.notify.checked;
    return { body, query: { conferenceDataVersion: 1, sendUpdates: notify ? 'all' : 'none' }, withMeet: f.meet.checked && !hadMeet };
  }

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  function syncNotifyField() {
    els.notifyField.hidden = !f.guests.value.trim();
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
    let form;
    try { form = readForm(); } catch (err) { return toast(err.message, 'error'); }
    const { body, query, withMeet } = form;

    // Pedir el token AQUÍ, sincrónicamente dentro del clic (evita bloqueo del pop-up).
    const tokenReady = ensureToken(true);
    setBusy(true);
    (async () => {
      try {
        await tokenReady;
        let saved;
        if (editing) {
          saved = await api(eventPath(editing.google.id), { method: 'PATCH', body, query });
        } else {
          saved = await api(calPath(), { method: 'POST', body: stripNulls(body), query });
        }
        const invited = query.sendUpdates === 'all' ? ' · invitaciones enviadas' : '';
        toast(withMeet && saved?.hangoutLink
          ? `Reunión de Meet lista${invited}`
          : `${editing ? 'Evento actualizado' : 'Evento creado'}${invited}`);
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
    const scope = f.deleteSeries.checked && g.recurringEventId ? 'series' : 'one';
    const done = deleteEvent(g, scope); // dentro del clic
    setBusy(true);
    (async () => {
      try {
        const res = await done;
        toast(res === 'declined' ? 'Invitación rechazada' : scope === 'series' ? 'Serie eliminada' : 'Evento eliminado');
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
  f.guests.addEventListener('input', syncNotifyField);
  els.form.querySelector('[data-copy-meet]').addEventListener('click', () => {
    copyText(els.meetLink.querySelector('a').href);
  });

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Enlace copiado'); }
    catch { toast('No se pudo copiar el enlace', 'error'); }
  }
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
        const g = ev.extendedProps.google || {};
        const hasGuests = (g.attendees || []).some((a) => !a.self && !a.resource);
        await api(eventPath(ev.id), { method: 'PATCH', body: googleTimes({ start, end, allDay }), query: { sendUpdates: hasGuests ? 'all' : 'none' } });
        toast(info.event.extendedProps.google?.recurringEventId ? 'Repetición movida' : 'Evento movido');
        calendar.refetchEvents();
      } catch (err) {
        info.revert();
        handleError(err);
      }
    })();
  }

  // ── Calendario (FullCalendar) ──────────────────────────────
  const mqMobile = window.matchMedia('(max-width: 700px)');
  const isMobile = () => mqMobile.matches;
  const DESKTOP_TOOLBAR = { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' };
  const MOBILE_TOOLBAR = { left: 'today', center: 'title', right: 'prev,next' };
  // Vistas equivalentes al cambiar entre móvil y escritorio
  const TO_MOBILE = { timeGridWeek: 'timeGrid3Day', listWeek: 'listTwoWeeks' };
  const TO_DESKTOP = { timeGrid3Day: 'timeGridWeek', listTwoWeeks: 'listWeek' };

  function createCalendar() {
    const narrow = isMobile();
    document.body.classList.toggle('is-mobile', narrow);
    calendar = new FullCalendar.Calendar(document.getElementById('calendar'), {
      locale: 'es',
      firstDay: 1,
      timeZone: 'local',
      height: '100%',
      initialView: narrow ? 'listTwoWeeks' : 'dayGridMonth',
      headerToolbar: narrow ? MOBILE_TOOLBAR : DESKTOP_TOOLBAR,
      footerToolbar: false,
      views: {
        timeGrid3Day: { type: 'timeGrid', duration: { days: 3 }, buttonText: '3 días', dayHeaderFormat: { weekday: 'short', day: 'numeric' } },
        listTwoWeeks: { type: 'list', duration: { days: 14 }, buttonText: 'Agenda' },
        timeGridDay: { dayHeaderFormat: { weekday: 'long', day: 'numeric', month: 'long' }, titleFormat: { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } },
        dayGridMonth: { dayHeaderFormat: { weekday: narrow ? 'narrow' : 'short' } },
      },
      longPressDelay: 350,
      selectLongPressDelay: 350,
      eventLongPressDelay: 450,
      dateClick: (info) => {
        // En el móvil, tocar un día del mes abre ese día (mantener pulsado crea un evento).
        if (isMobile() && info.view.type === 'dayGridMonth') calendar.changeView('timeGridDay', info.date);
      },
      nowIndicator: true,
      navLinks: true,
      dayMaxEvents: true, fixedWeekCount: false,
      selectable: calendarWritable,
      selectMirror: true,
      editable: true,
      eventColor: calendarColor,
      eventDisplay: 'block',
      // Un evento que acaba antes de las 09:00 del día siguiente (p. ej. un
      // turno de noche 23:00–07:00) se pinta solo en el día en que empieza.
      nextDayThreshold: '09:00:00',
      scrollTime: '07:00:00',
      slotDuration: '00:30:00',
      expandRows: true,
      eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      eventContent: renderEventContent,
      eventMinHeight: 20,
      eventDidMount: (arg) => {
        arg.el.title = arg.event.title;
        arg.el.style.setProperty('--evc', eventColor(arg.event));
        // En la agenda, un turno de noche mostraría "23:00 - 00:00": ponemos el horario real.
        const { start, end, allDay } = arg.event;
        const cell = arg.el.querySelector('.fc-list-event-time');
        if (cell && !allDay) {
          const e = end || addMinutes(start, 60);
          cell.innerHTML = `<span class="t1">${fmtClock(start)}</span><span class="t2">${fmtClock(e)}</span>`;
        }
      },
      datesSet: (info) => {
        closePopover();
        // En la vista de mes se ocultan sueño, meditación y lectura: al cambiar de vista se recargan.
        if (lastViewType && lastViewType !== info.view.type && (lastViewType === 'dayGridMonth' || info.view.type === 'dayGridMonth')) {
          setTimeout(() => calendar.refetchEvents(), 0);
        }
        lastViewType = info.view.type;
        updateBottomNav(info.view.type);
      },

      events: async (info, success, failure) => {
        setSync('loading');
        try {
          const items = await listEvents(info.start, info.end);
          const monthView = calendar?.view?.type === 'dayGridMonth';
          const minor = new Set(['sleep', 'nap', 'meditate', 'read']);
          success(items.filter((g) => !(monthView && minor.has(routineKind(g)))).map(toFcEvent));
          setSync('ok');
          updateNextShift();
        } catch (err) {
          failure(err);
          setSync(err instanceof AuthError ? 'offline' : 'error');
          if (!(err instanceof AuthError)) handleError(err);
        }
      },

      select: (info) => {
        // Un clic fuera de la tarjeta solo la cierra (como en Google Calendar).
        if (!els.pop.hidden || Date.now() - lastPopClose < 500) { closePopover(); calendar.unselect(); return; }
        let { start, end } = info;
        // Un clic en la vista semana/día selecciona 30 min: lo ampliamos a 1 h.
        if (!info.allDay && end - start <= 30 * 60000) end = addMinutes(start, 60);
        openDialog({ start, end, allDay: info.allDay });
      },
      eventClick: (info) => {
        info.jsEvent.preventDefault();
        info.jsEvent.stopPropagation();
        openPopover(info.event, info.el);
      },
      eventDrop: onMoveOrResize,
      eventResize: onMoveOrResize,
    });
    calendar.render();
  }

  // ── Tarjeta de evento (popover) ────────────────────────────
  let popEvent = null;
  let lastPopClose = 0;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const fmtClock = (d) => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  function fmtRange(ev) {
    const s = ev.start;
    const long = { weekday: 'long', day: 'numeric', month: 'long' };
    if (ev.allDay) {
      const last = ev.end ? addDays(ev.end, -1) : s;
      return fmtDate(last) === fmtDate(s)
        ? `${cap(s.toLocaleDateString('es-ES', long))} · Todo el día`
        : `${cap(s.toLocaleDateString('es-ES', long))} – ${last.toLocaleDateString('es-ES', long)}`;
    }
    const e = ev.end || addMinutes(s, 60);
    const nextDay = fmtDate(s) !== fmtDate(e) ? ` <span class="muted">(${e.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' })})</span>` : '';
    return `${cap(s.toLocaleDateString('es-ES', long))}<br><strong>${fmtClock(s)} – ${fmtClock(e)}</strong>${nextDay}`;
  }

  const plainText = (html) => {
    const d = document.createElement('div');
    d.innerHTML = String(html || '').replace(/<br\s*\/?>/gi, '\n');
    return d.textContent.trim();
  };

  function eventColor(fcEvent) {
    const g = fcEvent.extendedProps.google || {};
    const shift = shiftOf(g);
    if (shift) return { morning: '#f59e0b', evening: '#f97316', night: '#6366f1' }[shift.kind];
    const rk = routineKind(g);
    if (rk) return { sleep: '#a78bfa', nap: '#a78bfa', train: '#ef4444', study: '#10b981', meditate: '#14b8a6', read: '#ec4899' }[rk];
    return (g.colorId && GOOGLE_COLORS[g.colorId]?.bg) || calendarColor;
  }

  function renderPopover(confirming = false) {
    const ev = popEvent;
    const g = ev.extendedProps.google || {};
    const perm = permission(g);
    const shift = shiftOf(g);
    const me = selfAttendee(g);
    const guests = (g.attendees || []).filter((a) => !a.resource);
    const invite = isInvite(g);
    const organizerName = g.organizer?.displayName || g.organizer?.email || '';
    const desc = plainText(g.description);
    const deleteLabel = invite ? 'Quitar de mi calendario' : 'Eliminar';
    const notifyGuests = !invite && guests.some((a) => !a.self);
    const rsvp = (status, label) => `<button type="button" class="rsvp-btn${me?.responseStatus === status ? ' active' : ''}" data-rsvp="${status}">${label}</button>`;

    let actions;
    if (confirming) {
      actions = `
        <div class="pop-confirm">
          <span>${invite ? '¿Quitar este evento de tu calendario?' : notifyGuests ? '¿Eliminar y avisar a los invitados?' : '¿Eliminar este evento?'}</span>
          <div class="pop-confirm-btns">
            <button type="button" class="btn btn-ghost btn-sm" data-action="cancel-delete">Cancelar</button>
            ${g.recurringEventId && !invite ? '<button type="button" class="btn btn-danger btn-sm" data-action="confirm-delete" data-scope="series">Toda la serie</button>' : ''}
            <button type="button" class="btn btn-danger-solid btn-sm" data-action="confirm-delete" data-scope="one">${g.recurringEventId && !invite ? 'Solo este' : deleteLabel}</button>
          </div>
        </div>`;
    } else {
      actions = `
        <div class="pop-actions">
          ${perm === 'full' ? '<button type="button" class="btn btn-ghost btn-sm" data-action="edit">✏️ Editar</button>' : ''}
          ${perm !== 'none' ? `<button type="button" class="btn btn-danger btn-sm" data-action="delete">🗑️ ${deleteLabel}</button>` : ''}
          <span class="spacer"></span>
          ${g.htmlLink ? `<a class="btn btn-ghost btn-sm" href="${esc(g.htmlLink)}" target="_blank" rel="noopener" title="Abrir en Google Calendar">Google ↗</a>` : ''}
        </div>`;
    }

    els.pop.style.setProperty('--ev-color', eventColor(ev));
    els.pop.innerHTML = `
      <div class="pop-handle" aria-hidden="true"></div>
      <div class="pop-head">
        <span class="pop-badge">${shift ? shift.icon : g.hangoutLink ? '🎥' : ''}</span>
        <h3>${esc(ev.title)}</h3>
        <button type="button" class="btn btn-ghost btn-icon" data-action="close" aria-label="Cerrar">✕</button>
      </div>
      <div class="pop-body">
        <div class="pop-row"><span class="pop-ico">🕒</span><div>${fmtRange(ev)}</div></div>
        ${shift ? `<div class="pop-row"><span class="pop-ico">🏭</span><div>Turno <strong>${esc(g.extendedProperties.private.turnoCode)}</strong> · sincronizado del cuadrante</div></div>` : ''}
        ${routineKind(g) ? '<div class="pop-row"><span class="pop-ico">🧩</span><div>Bloque de tu rutina · se recoloca al pulsar «Rutina»</div></div>' : ''}
        ${g.location && !shift ? `<div class="pop-row"><span class="pop-ico">📍</span><div>${esc(g.location)}</div></div>` : ''}
        ${g.hangoutLink ? `
          <div class="pop-row pop-meet">
            <a class="btn btn-meet btn-sm" href="${esc(g.hangoutLink)}" target="_blank" rel="noopener">🎥 Unirse con Google Meet</a>
            <button type="button" class="btn btn-ghost btn-sm" data-action="copy-meet">Copiar enlace</button>
          </div>` : ''}
        ${guests.length ? `<div class="pop-row"><span class="pop-ico">👥</span><div>${guests.length} invitado${guests.length === 1 ? '' : 's'}${invite && organizerName ? ` · organiza <strong>${esc(organizerName)}</strong>` : ''}</div></div>` : ''}
        ${invite && me && perm !== 'none' ? `
          <div class="pop-rsvp"><span>¿Asistirás?</span>${rsvp('accepted', 'Sí')}${rsvp('declined', 'No')}${rsvp('tentative', 'Quizás')}</div>` : ''}
        ${desc && !shift && !routineKind(g) ? `<div class="pop-desc">${esc(desc.length > 280 ? desc.slice(0, 280) + '…' : desc)}</div>` : ''}
        ${g.eventType === 'fromGmail' ? '<p class="note">Evento creado automáticamente desde Gmail: puedes quitarlo, pero no editarlo.</p>' : ''}
      </div>
      ${actions}`;
  }

  function openPopover(fcEvent, anchor) {
    popEvent = fcEvent;
    renderPopover();
    const pop = els.pop;
    pop.hidden = false;
    pop.classList.remove('show');
    if (window.matchMedia('(max-width: 700px)').matches) {
      pop.classList.add('sheet');
      pop.style.left = pop.style.top = '';
    } else {
      pop.classList.remove('sheet');
      const r = anchor.getBoundingClientRect();
      const pw = pop.offsetWidth;
      const ph = pop.offsetHeight;
      const m = 10;
      let left = r.right + m;
      let top = r.top;
      if (left + pw > innerWidth - m) left = r.left - pw - m;
      if (left < m) { left = Math.min(Math.max(m, r.left), innerWidth - pw - m); top = r.bottom + m; }
      if (top + ph > innerHeight - m) top = Math.max(m, innerHeight - ph - m);
      pop.style.left = `${left}px`;
      pop.style.top = `${Math.max(m, top)}px`;
    }
    requestAnimationFrame(() => pop.classList.add('show'));
  }

  function closePopover() {
    if (els.pop.hidden) return;
    els.pop.hidden = true;
    els.pop.classList.remove('show');
    popEvent = null;
    lastPopClose = Date.now();
  }

  /** Elimina un evento. Si es una invitación, lo quita de tu calendario
   *  (y si Google no lo permite, la rechaza). Llamar dentro del clic. */
  function deleteEvent(g, scope = 'one') {
    const invite = isInvite(g);
    const id = scope === 'series' && g.recurringEventId ? g.recurringEventId : g.id;
    const notify = !invite && (g.attendees || []).some((a) => !a.self && !a.resource);
    return api(eventPath(id), { method: 'DELETE', query: { sendUpdates: notify ? 'all' : 'none' } })
      .then(() => 'deleted')
      .catch((err) => {
        if (err.status === 404 || err.status === 410) return 'deleted';
        if (invite && err.status === 403) return respond(g, 'declined').then(() => 'declined');
        throw err;
      });
  }

  function respond(g, status) {
    const attendees = (g.attendees || []).map((a) => (a.self ? { ...a, responseStatus: status } : a));
    return api(eventPath(g.id), { method: 'PATCH', body: { attendees }, query: { sendUpdates: 'all' } });
  }

  els.pop.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action], [data-rsvp]');
    if (!btn || !popEvent) return;
    const g = popEvent.extendedProps.google || {};
    const action = btn.dataset.action;

    if (action === 'close') return closePopover();
    if (action === 'edit') return openDialog({ fcEvent: popEvent });
    if (action === 'delete') return renderPopover(true);
    if (action === 'cancel-delete') return renderPopover(false);
    if (action === 'copy-meet') return copyText(g.hangoutLink);

    if (action === 'confirm-delete') {
      const scope = btn.dataset.scope;
      const done = deleteEvent(g, scope); // sincrónico dentro del clic
      els.pop.querySelectorAll('button').forEach((b) => (b.disabled = true));
      done.then((res) => {
        closePopover();
        toast(res === 'declined' ? 'Invitación rechazada' : scope === 'series' ? 'Serie eliminada' : isInvite(g) ? 'Quitado de tu calendario' : 'Evento eliminado');
      }).catch(handleError).finally(() => calendar.refetchEvents());
      return;
    }

    if (btn.dataset.rsvp) {
      const status = btn.dataset.rsvp;
      const done = respond(g, status);
      els.pop.querySelectorAll('.rsvp-btn').forEach((b) => b.classList.toggle('active', b === btn));
      done.then(() => {
        toast({ accepted: 'Has confirmado tu asistencia', declined: 'Has rechazado la invitación', tentative: 'Respondido: quizás' }[status]);
        calendar.refetchEvents();
      }).catch(handleError);
    }
  });

  // Cerrar la tarjeta al hacer clic fuera, con Esc o al hacer scroll del calendario
  document.addEventListener('mousedown', (e) => {
    if (els.pop.hidden || els.pop.contains(e.target) || e.target.closest('.fc-event')) return;
    closePopover();
  });
  document.addEventListener('keydown', (e) => {
    if (els.pop.hidden || els.dialog.open) return;
    if (e.key === 'Escape') closePopover();
    if ((e.key === 'Delete' || e.key === 'Backspace') && popEvent && permission(popEvent.extendedProps.google || {}) !== 'none') {
      e.preventDefault();
      renderPopover(true);
    }
  });
  window.addEventListener('resize', () => { if (!isMobile()) closePopover(); });
  document.getElementById('calendar').addEventListener('scroll', closePopover, true);

  // ── Próximo turno (chip de la cabecera) ────────────────────
  let nextShiftDate = null;
  async function updateNextShift() {
    if (!CFG.TURNOS || !tokenValid()) return;
    try {
      const data = await api(calPath(), {
        interactive: false,
        query: {
          privateExtendedProperty: 'turnosSync=1',
          timeMin: new Date().toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: 1,
        },
      });
      const g = data.items?.[0];
      const shift = shiftOf(g);
      if (!g || !shift) { els.nextShift.hidden = true; return; }
      const start = new Date(g.start.dateTime);
      const end = new Date(g.end.dateTime);
      const now = new Date();
      const today = fmtDate(now);
      const dayLabel = start <= now ? 'ahora' : fmtDate(start) === today ? 'hoy'
        : fmtDate(start) === fmtDate(addDays(now, 1)) ? 'mañana'
          : start.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
      nextShiftDate = start;
      els.nextShift.className = `next-shift shift-${shift.kind}`;
      els.nextShift.innerHTML = `<span class="ns-ico">${shift.icon}</span><span class="ns-text"><small>${start <= now ? 'En turno' : 'Próximo turno'}</small>${shift.label} ${shift.place} · ${dayLabel} ${start <= now ? `hasta ${fmtClock(end)}` : fmtClock(start)}</span>`;
      els.nextShift.hidden = false;
    } catch { /* no es crítico */ }
  }
  els.nextShift.addEventListener('click', () => {
    if (!nextShiftDate || !calendar) return;
    const target = calendar.view.type.startsWith('list') ? calendar.view.type : isMobile() ? 'timeGridDay' : 'timeGridWeek';
    calendar.changeView(target, nextShiftDate);
  });

  // ── Reunión de Google Meet ─────────────────────────────────
  els.meetBtn.addEventListener('click', () => {
    const start = roundToNextHalfHour(new Date());
    openDialog({ start, end: addMinutes(start, 30), meet: true, title: 'Reunión' });
  });

  // ── Sincronización de turnos de trabajo ────────────────────
  //  Lee la planificación (CSV publicado), coge SOLO la fila del operador
  //  configurado y la refleja en el calendario: crea los turnos nuevos,
  //  corrige los cambiados y borra los que ya no están en el cuadrante.
  //  Cada turno lleva una marca privada (turnosSync) para no tocar nunca
  //  tus otros eventos ni duplicar turnos al sincronizar varias veces.
  const SHIFT_TYPES = {
    MA: { label: 'Mañana', place: 'Arteixo', start: '07:00', end: '15:00', colorId: '5', kind: 'morning', icon: '☀️' },
    ML: { label: 'Mañana', place: 'Laracha', start: '07:00', end: '15:00', colorId: '5', kind: 'morning', icon: '☀️' },
    TA: { label: 'Tarde', place: 'Arteixo', start: '15:00', end: '23:00', colorId: '6', kind: 'evening', icon: '🌇' },
    TL: { label: 'Tarde', place: 'Laracha', start: '15:00', end: '23:00', colorId: '6', kind: 'evening', icon: '🌇' },
    NA: { label: 'Noche', place: 'Arteixo', start: '23:00', end: '07:00', colorId: '9', kind: 'night', icon: '🌙' },
    NL: { label: 'Noche', place: 'Laracha', start: '23:00', end: '07:00', colorId: '9', kind: 'night', icon: '🌙' },
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
    const lastDate = Object.values(colDate).sort().pop() || null;
    return { shifts, unknown: [...unknown], undated, lastDate };
  }

  async function fetchShiftsCsv() {
    const T = CFG.TURNOS;
    try {
      const url = T.CSV_URL + (T.CSV_URL.includes('?') ? '&' : '?') + 't=' + Date.now();
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error();
      return parseShiftsCsv(await res.text(), T.OPERADOR);
    } catch (err) {
      if (err.message && err.message.startsWith('No encuentro')) throw err;
      throw new Error('No he podido leer la planificación de turnos. Comprueba la dirección en config.js o tu conexión.');
    }
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
    const parsed = await fetchShiftsCsv();
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

  async function applyShiftPlan(plan, progressBtn = els.shiftsConfirm) {
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
        progressBtn.textContent = `Sincronizando ${done}/${total}…`;
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

  // ── Rutina personal (sueño, entreno, formación, meditación, lectura) ──
  //  Genera los bloques de cada día a partir de tus turnos y los refleja en
  //  el calendario. Cada bloque lleva una marca privada (rutinaSync) para
  //  recolocarlos sin duplicar cuando cambie el cuadrante.
  const ROUTINE_TAG = 'rutinaSync';
  const ROUTINE_KINDS = {
    sleep: { title: '😴 Sueño', colorId: '1', label: 'Sueño' },
    nap: { title: '😴 Siesta antes de la noche', colorId: '1', label: 'Siesta' },
    train: { title: '🏋️ Entrenamiento', colorId: '11', label: 'Entrenamiento' },
    study: { title: '📚 Formación', colorId: '10', label: 'Formación' },
    meditate: { title: '🧘 Meditación', colorId: '2', label: 'Meditación' },
    read: { title: '📖 Lectura', colorId: '4', label: 'Lectura' },
  };
  const routineKind = (g) => g?.extendedProperties?.private?.rutinaKind || null;
  const hm = (h, m = 0) => h * 60 + m;
  const fmtHM = (mins) => `${pad(Math.floor((((mins % 1440) + 1440) % 1440) / 60))}:${pad(((mins % 60) + 60) % 60)}`;
  const fmtHours = (mins) => `${(Math.round(mins / 6) / 10).toString().replace('.', ',')} h`;
  let routinePlan = null;

  /** Tipo de cada día: M (mañana), T (tarde), N1 (primera noche), Nc (noche
   *  seguida), P (libre tras noches) o L (libre). */
  function dayKinds(shifts, from, to) {
    const code = new Map(shifts.map((s) => [s.date, s.code]));
    const kindOf = (iso) => {
      const c = code.get(iso);
      const prev = code.get(fmtDate(addDays(parseDate(iso), -1)));
      const prevNight = !!prev && prev[0] === 'N';
      if (c) return c[0] === 'M' ? 'M' : c[0] === 'T' ? 'T' : prevNight ? 'Nc' : 'N1';
      return prevNight ? 'P' : 'L';
    };
    const days = [];
    for (let d = parseDate(from); fmtDate(d) <= to; d = addDays(d, 1)) {
      const iso = fmtDate(d);
      days.push({ date: iso, kind: kindOf(iso), next: kindOf(fmtDate(addDays(d, 1))), code: code.get(iso) || null });
    }
    return days;
  }

  /** Elige los días de entreno de cada semana (lunes a domingo). */
  function pickTrainingDays(days, perWeek) {
    const score = { L: 3, T: 2, M: 1 };
    const weeks = new Map();
    for (const d of days) {
      const dt = parseDate(d.date);
      const monday = fmtDate(addDays(dt, -((dt.getDay() + 6) % 7)));
      if (!weeks.has(monday)) weeks.set(monday, []);
      weeks.get(monday).push(d);
    }
    const chosen = new Set();
    const has = (iso, delta) => chosen.has(fmtDate(addDays(parseDate(iso), delta)));
    const neighbours = (iso) => (has(iso, -1) ? 1 : 0) + (has(iso, 1) ? 1 : 0);
    const makesTriple = (iso) => (has(iso, -1) && has(iso, 1)) || (has(iso, -1) && has(iso, -2)) || (has(iso, 1) && has(iso, 2));
    for (const list of weeks.values()) {
      const cands = list.filter((d) => score[d.kind]).sort((a, b) => score[b.kind] - score[a.kind] || a.date.localeCompare(b.date));
      let n = 0;
      // 1º sin días seguidos (también respecto a la semana anterior); 2º, si no llega, se permite un día seguido pero nunca tres.
      for (const relax of [false, true]) {
        for (const d of cands) {
          if (n >= perWeek) break;
          if (chosen.has(d.date)) continue;
          if (!relax && neighbours(d.date) > 0) continue;
          if (relax && makesTriple(d.date)) continue;
          chosen.add(d.date);
          n++;
        }
      }
    }
    return chosen;
  }

  /** Bloques de un día en minutos desde las 00:00 de ese día (pueden pasar de 1440). */
  function routineBlocks(day, train, cfg) {
    const c = cfg.commute;
    const sleepMin = cfg.sleepMin;
    const wakeOf = (k) => ({ M: hm(7) - c - 60, T: hm(7, 45), L: hm(7, 45), N1: hm(7, 45), Nc: hm(7) + c + 30 + sleepMin, P: hm(7) + c + 30 + 360 }[k]);
    const b = [];
    const add = (kind, start, end) => b.push({ kind, start, end });
    const wake = wakeOf(day.kind);
    let defaultBed = null;
    let lastEnd = 0;

    switch (day.kind) {
      case 'M': {
        const home = hm(15) + c;
        add('meditate', wake, wake + 15);
        if (train) { add('study', home + 45, home + 165); add('train', home + 175, home + 355); defaultBed = home + 390; lastEnd = home + 355; }
        else { add('study', home + 45, home + 225); defaultBed = hm(21, 45); lastEnd = home + 225; }
        break;
      }
      case 'T': {
        add('meditate', wake, wake + 15);
        if (train) { add('train', hm(8, 15), hm(11, 15)); add('study', hm(11, 30), hm(13, 30)); }
        else add('study', hm(8, 30), hm(12, 30));
        lastEnd = hm(23) + c;
        defaultBed = lastEnd + 30;
        break;
      }
      case 'L': {
        add('meditate', wake, wake + 15);
        if (train) { add('train', hm(9, 30), hm(12, 30)); add('study', hm(16), hm(19, 30)); lastEnd = hm(19, 30); }
        else { add('study', hm(9, 30), hm(13, 30)); lastEnd = hm(13, 30); }
        defaultBed = hm(23, 30);
        break;
      }
      case 'N1': {
        add('meditate', wake, wake + 15);
        add('study', hm(9, 30), hm(12, 30));
        add('nap', hm(15, 30), hm(18, 30));
        add('read', hm(20), hm(20, 30));
        break;
      }
      case 'Nc': {
        const sleepStart = hm(7) + c + 30;
        add('sleep', sleepStart, wake);
        add('meditate', wake, wake + 15);
        add('study', wake + 60, wake + 240);
        add('read', hm(20), hm(20, 30));
        break;
      }
      case 'P': {
        const sleepStart = hm(7) + c + 30;
        add('sleep', sleepStart, wake);
        add('meditate', wake, wake + 15);
        add('study', hm(16), hm(18));
        defaultBed = hm(23);
        lastEnd = hm(18);
        break;
      }
    }

    let warning = null;
    if (defaultBed !== null) {
      // Hora de acostarse: la habitual, o antes si al día siguiente madrugas,
      // pero nunca antes de terminar lo del día + la lectura.
      const readLen = day.kind === 'M' && train ? 15 : day.kind === 'T' || day.kind === 'M' ? 20 : 30;
      const nextWake = day.next === 'Nc' || day.next === 'P' ? null : wakeOf(day.next);
      let bed = defaultBed;
      if (nextWake != null) bed = Math.min(defaultBed, 1440 + nextWake - cfg.sleepTarget);
      bed = Math.max(bed, lastEnd + readLen + 10);
      const readEnd = bed - 5;
      add('read', readEnd - readLen, readEnd);
      const wakeNext = nextWake != null ? 1440 + nextWake : bed + cfg.sleepTarget;
      if (wakeNext - bed < sleepMin) warning = `${fmtHuman(day.date)}: solo ${fmtHours(wakeNext - bed)} de sueño por el cambio de turno`;
      add('sleep', bed, wakeNext);
    }
    return { blocks: b, warning };
  }

  function routineEventBody(date, blk, idx, tz) {
    const k = ROUTINE_KINDS[blk.kind];
    const toLocal = (mins) => {
      const d = addDays(parseDate(date), Math.floor(mins / 1440));
      return `${fmtDate(d)}T${fmtHM(mins)}:00`;
    };
    const body = {
      summary: k.title,
      description: 'Bloque de tu rutina, creado automáticamente según tus turnos. Si lo cambias a mano, la próxima vez que pulses «Rutina» puede recolocarse.',
      colorId: k.colorId,
      start: { dateTime: toLocal(blk.start), timeZone: tz },
      end: { dateTime: toLocal(blk.end), timeZone: tz },
      transparency: blk.kind === 'sleep' || blk.kind === 'nap' ? 'transparent' : 'opaque',
      reminders: blk.kind === 'train' ? { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] } : { useDefault: false, overrides: [] },
      extendedProperties: { private: { [ROUTINE_TAG]: '1', rutinaKey: `${date}|${blk.kind}|${idx}`, rutinaKind: blk.kind, rutinaDate: date } },
    };
    return body;
  }

  async function listRoutineEvents(fromDate) {
    const items = [];
    let pageToken;
    do {
      const data = await api(calPath(), {
        query: { privateExtendedProperty: `${ROUTINE_TAG}=1`, timeMin: addDays(parseDate(fromDate), -1).toISOString(), singleEvents: 'true', maxResults: 2500, pageToken },
      });
      items.push(...(data.items || []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return items.filter((e) => e.status !== 'cancelled' && (e.extendedProperties?.private?.rutinaDate || '') >= fromDate);
  }

  async function buildRoutinePlan() {
    const R = CFG.RUTINA || {};
    const cfg = {
      commute: Number(R.DESPLAZAMIENTO_MIN ?? 45),
      sleepTarget: Math.round(Number(R.SUENO_HORAS ?? 7.5) * 60),
      sleepMin: Math.round(Number(R.SUENO_MINIMO_HORAS ?? 7) * 60),
      perWeek: Number(R.ENTRENOS_SEMANA ?? 3),
    };
    const tz = CFG.TURNOS?.ZONA_HORARIA || 'Europe/Madrid';
    const parsed = await fetchShiftsCsv();
    const now = new Date();
    const from = fmtDate(now);
    const to = parsed.lastDate;
    if (!to || to < from) throw new Error('El cuadrante no tiene días a partir de hoy.');

    const days = dayKinds(parsed.shifts, from, to);
    const trainDays = pickTrainingDays(days, cfg.perWeek);
    const wanted = [];
    const warnings = [];
    const weeks = new Map();
    for (const day of days) {
      const { blocks, warning } = routineBlocks(day, trainDays.has(day.date), cfg);
      if (warning) warnings.push(warning);
      const dt = parseDate(day.date);
      const monday = fmtDate(addDays(dt, -((dt.getDay() + 6) % 7)));
      if (!weeks.has(monday)) weeks.set(monday, { monday, train: 0, study: 0, sleep: 0, nights: 0 });
      const w = weeks.get(monday);
      blocks.forEach((blk, i) => {
        const body = routineEventBody(day.date, blk, i, tz);
        if (new Date(body.end.dateTime) <= now) return; // ya pasado
        wanted.push(body);
        const len = blk.end - blk.start;
        if (blk.kind === 'train') w.train++;
        if (blk.kind === 'study') w.study += len;
        if (blk.kind === 'sleep') { w.sleep += len; w.nights++; }
      });
    }

    // Diferencias con lo que ya hay en el calendario
    const existing = await listRoutineEvents(from);
    const byKey = new Map();
    const plan = { create: [], update: [], remove: [], same: 0, wanted, warnings, weeks: [...weeks.values()], from, to, cfg, conflicts: [] };
    for (const e of existing) {
      const key = e.extendedProperties.private.rutinaKey;
      if (byKey.has(key)) plan.remove.push(e); else byKey.set(key, e);
    }
    const sameTime = (a, b) => new Date(a).getTime() === new Date(b).getTime();
    for (const body of wanted) {
      const key = body.extendedProperties.private.rutinaKey;
      const ex = byKey.get(key);
      byKey.delete(key);
      if (!ex) plan.create.push(body);
      else if (!sameTime(ex.start.dateTime, body.start.dateTime) || !sameTime(ex.end.dateTime, body.end.dateTime) || ex.summary !== body.summary) plan.update.push({ id: ex.id, body });
      else plan.same++;
    }
    for (const e of byKey.values()) plan.remove.push(e);

    // Coincidencias con tus otros eventos (no se tocan, solo se avisan)
    try {
      const own = (await listEvents(parseDate(from), addDays(parseDate(to), 2)))
        .filter((g) => g.start?.dateTime && !g.extendedProperties?.private?.[ROUTINE_TAG] && !g.extendedProperties?.private?.[SHIFT_TAG]);
      for (const g of own) {
        const s = new Date(g.start.dateTime), e = new Date(g.end.dateTime);
        const hit = wanted.find((w) => w.extendedProperties.private.rutinaKind !== 'sleep' && new Date(w.start.dateTime) < e && new Date(w.end.dateTime) > s);
        if (hit) plan.conflicts.push(`${fmtHuman(fmtDate(s))} ${fmtClock(s)} · ${g.summary || '(Sin título)'} ↔ ${hit.summary}`);
      }
    } catch { /* aviso opcional */ }
    return plan;
  }

  function renderRoutinePlan(plan) {
    const calName = els.calSelect.selectedOptions[0]?.textContent || 'tu calendario';
    const nothing = !plan.create.length && !plan.update.length && !plan.remove.length;
    const count = (k) => plan.wanted.filter((w) => w.extendedProperties.private.rutinaKind === k).length;
    const rows = plan.weeks.map((w) => {
      const mon = parseDate(w.monday);
      const sun = addDays(mon, 6);
      const label = `${mon.getDate()}–${sun.getDate()} ${sun.toLocaleDateString('es-ES', { month: 'short' })}`;
      const avgSleep = w.nights ? fmtHours(w.sleep / w.nights) : '—';
      return `<tr><td>${esc(label)}</td><td>${w.train}</td><td>${fmtHours(w.study)}</td><td>${avgSleep}</td></tr>`;
    }).join('');
    els.routineBody.innerHTML = `
      <p>Calendario: <strong>${esc(calName)}</strong> · del <strong>${esc(fmtHuman(plan.from))}</strong> al <strong>${esc(fmtHuman(plan.to))}</strong></p>
      <div class="routine-chips">
        <span class="rchip r-train">🏋️ ${count('train')} entrenos</span>
        <span class="rchip r-study">📚 ${count('study')} bloques de formación</span>
        <span class="rchip r-meditate">🧘 ${count('meditate')} meditaciones</span>
        <span class="rchip r-read">📖 ${count('read')} lecturas</span>
        <span class="rchip r-sleep">😴 ${count('sleep') + count('nap')} bloques de sueño</span>
      </div>
      <table class="routine-table"><thead><tr><th>Semana</th><th>Entrenos</th><th>Formación</th><th>Sueño medio</th></tr></thead><tbody>${rows}</tbody></table>
      <ul class="plan-list">
        <li><span>Bloques nuevos</span><strong>${plan.create.length}</strong></li>
        <li><span>Bloques que se recolocan</span><strong>${plan.update.length}</strong></li>
        <li><span>Bloques que sobran (se borran)</span><strong>${plan.remove.length}</strong></li>
        <li><span>Sin cambios</span><strong>${plan.same}</strong></li>
      </ul>
      ${plan.conflicts.length ? `<div class="note"><strong>Coinciden con eventos tuyos</strong> (no se tocan, revísalos):<br>${plan.conflicts.slice(0, 6).map(esc).join('<br>')}${plan.conflicts.length > 6 ? `<br>… y ${plan.conflicts.length - 6} más` : ''}</div>` : ''}
      ${plan.warnings.length ? `<div class="note error-note">${plan.warnings.map(esc).join('<br>')}</div>` : ''}
      ${nothing ? '<p class="note">Tu rutina ya está al día: no hay nada que cambiar.</p>' : ''}
      <p class="muted small">Trayecto: ${plan.cfg.commute} min · sueño objetivo ${fmtHours(plan.cfg.sleepTarget)} (mínimo ${fmtHours(plan.cfg.sleepMin)}) · ${plan.cfg.perWeek} entrenos por semana. Puedes cambiarlo en config.js.</p>`;
    els.routineConfirm.disabled = nothing;
    els.routineConfirm.textContent = 'Crear rutina';
  }

  els.routineBtn.addEventListener('click', () => {
    const tokenReady = ensureToken(true);
    routinePlan = null;
    els.routineBody.innerHTML = '<p class="muted">Leyendo tus turnos y tu calendario…</p>';
    els.routineConfirm.disabled = true;
    els.routineConfirm.textContent = 'Crear rutina';
    els.routineDialog.showModal();
    (async () => {
      try {
        await tokenReady;
        routinePlan = await buildRoutinePlan();
        renderRoutinePlan(routinePlan);
      } catch (err) {
        console.error(err);
        els.routineBody.innerHTML = `<p class="note error-note">${esc(err instanceof AuthError ? 'Sesión caducada: pulsa «Reconectar» y vuelve a intentarlo.' : err.message)}</p>`;
      }
    })();
  });

  els.routineConfirm.addEventListener('click', () => {
    if (!routinePlan) return;
    const plan = routinePlan;
    routinePlan = null;
    const tokenReady = ensureToken(true);
    els.routineConfirm.disabled = true;
    (async () => {
      try {
        await tokenReady;
        const { total, failed } = await applyShiftPlan(plan, els.routineConfirm);
        els.routineDialog.close();
        toast(failed
          ? `Rutina creada, pero ${failed} bloque(s) fallaron. Pulsa «Rutina» otra vez para completarla.`
          : `Rutina lista (${total} cambio${total === 1 ? '' : 's'}).`, failed ? 'error' : 'ok');
      } catch (err) {
        els.routineDialog.close();
        handleError(err);
      } finally {
        calendar?.refetchEvents();
      }
    })();
  });

  els.routineDialog.querySelectorAll('[data-close-routine]').forEach((b) => b.addEventListener('click', () => els.routineDialog.close()));
  els.routineDialog.addEventListener('click', (e) => { if (e.target === els.routineDialog) els.routineDialog.close(); });

  // ── Móvil: barra inferior, menú ⋯, gestos y cambio de tamaño ──
  function updateBottomNav(viewType) {
    els.bottomNav.querySelectorAll('[data-view]').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === viewType);
      b.setAttribute('aria-current', b.dataset.view === viewType ? 'page' : 'false');
    });
  }

  els.bottomNav.addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b || !calendar) return;
    calendar.changeView(b.dataset.view);
  });
  els.fab.addEventListener('click', () => openDialog());

  function openMenu() {
    els.moreMenu.hidden = false;
    requestAnimationFrame(() => els.moreMenu.classList.add('show'));
    els.moreBtn.setAttribute('aria-expanded', 'true');
  }
  function closeMenu() {
    if (els.moreMenu.hidden) return;
    els.moreMenu.classList.remove('show');
    els.moreBtn.setAttribute('aria-expanded', 'false');
    setTimeout(() => { els.moreMenu.hidden = true; }, 180);
  }
  els.moreBtn.addEventListener('click', () => (els.moreMenu.hidden ? openMenu() : closeMenu()));
  els.moreMenu.addEventListener('click', (e) => {
    if (e.target === els.moreMenu) return closeMenu();
    const item = e.target.closest('[data-proxy]');
    if (!item) return;
    closeMenu();
    // Reutiliza los botones de la cabecera (mismo clic → el pop-up de Google no se bloquea).
    const target = document.getElementById(item.dataset.proxy);
    if (target && !target.disabled) target.click();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  // Tocar un día en la vista de mes (móvil) abre ese día
  document.getElementById('calendar').addEventListener('click', (e) => {
    if (!isMobile() || !calendar || calendar.view.type !== 'dayGridMonth' || els.dialog.open) return;
    if (e.target.closest('.fc-event, .fc-daygrid-more-link, .fc-popover, .fc-toolbar')) return;
    const td = e.target.closest('td.fc-daygrid-day');
    if (td?.dataset.date) calendar.changeView('timeGridDay', td.dataset.date);
  });

  // Deslizar a izquierda/derecha para cambiar de periodo
  (() => {
    const el = document.getElementById('calendar');
    let sx = 0, sy = 0, st = 0, tracking = false;
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1 || e.target.closest('.fc-event, .fc-highlight, .fc-event-mirror')) { tracking = false; return; }
      tracking = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now();
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (!tracking || !calendar) return;
      tracking = false;
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Date.now() - st < 700 && Math.abs(dx) > 70 && Math.abs(dy) < 50) {
        el.classList.remove('swipe-left', 'swipe-right');
        void el.offsetWidth;
        el.classList.add(dx < 0 ? 'swipe-left' : 'swipe-right');
        dx < 0 ? calendar.next() : calendar.prev();
      }
    }, { passive: true });
  })();

  // Bajar la tarjeta del evento con el dedo para cerrarla (móvil)
  (() => {
    let sy = 0, dragging = false;
    els.pop.addEventListener('touchstart', (e) => {
      if (!els.pop.classList.contains('sheet') || els.pop.scrollTop > 0) return;
      dragging = true; sy = e.touches[0].clientY;
    }, { passive: true });
    els.pop.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      const dy = Math.max(0, e.touches[0].clientY - sy);
      els.pop.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    els.pop.addEventListener('touchend', (e) => {
      if (!dragging) return;
      dragging = false;
      const dy = e.changedTouches[0].clientY - sy;
      els.pop.style.transform = '';
      if (dy > 90) closePopover();
    }, { passive: true });
  })();

  function applyResponsive() {
    const m = isMobile();
    document.body.classList.toggle('is-mobile', m);
    closeMenu();
    if (!calendar) return;
    calendar.setOption('headerToolbar', m ? MOBILE_TOOLBAR : DESKTOP_TOOLBAR);
    const v = calendar.view.type;
    const map = m ? TO_MOBILE : TO_DESKTOP;
    if (map[v]) calendar.changeView(map[v]);
    updateBottomNav(calendar.view.type);
    calendar.updateSize();
  }
  mqMobile.addEventListener('change', applyResponsive);

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

  function changeCalendar(id) {
    currentCalendarId = id;
    els.calSelect.value = id;
    els.calSelectMobile.value = id;
    applyCalendarSettings();
    calendar?.refetchEvents();
  }
  els.calSelect.addEventListener('change', () => changeCalendar(els.calSelect.value));
  els.calSelectMobile.addEventListener('change', () => { changeCalendar(els.calSelectMobile.value); closeMenu(); });

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
    if (!calendar || els.app.hidden || els.dialog.open || els.shiftsDialog.open || els.routineDialog.open) return;
    if (document.visibilityState !== 'visible') return;
    if (!tokenValid()) return showReconnect();
    calendar.refetchEvents();
  }
  setInterval(autoRefresh, Math.max(15, Number(CFG.REFRESH_SECONDS) || 60) * 1000);
  document.addEventListener('visibilitychange', autoRefresh);

  async function boot() {
    buildColorOptions();
    els.shiftsBtn.hidden = !(CFG.TURNOS && CFG.TURNOS.CSV_URL && CFG.TURNOS.OPERADOR);
    els.routineBtn.hidden = els.shiftsBtn.hidden || !CFG.RUTINA;

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

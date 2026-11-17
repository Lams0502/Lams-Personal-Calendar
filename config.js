// ─────────────────────────────────────────────────────────────
//  Configuración del calendario
//  Este es el ÚNICO archivo que tienes que editar.
// ─────────────────────────────────────────────────────────────
window.APP_CONFIG = {
  // ID de cliente OAuth de Google Cloud (tipo "Aplicación web").
  // No es un secreto: es normal que esté a la vista en el repositorio.
  // Ejemplo: "1234567890-abcdefg.apps.googleusercontent.com"
  CLIENT_ID: "842310098650-84f8b1paskot9shvlagfeietfvm7i4it.apps.googleusercontent.com",

  // Calendario que se abre por defecto. "primary" = tu calendario principal.
  // Luego puedes cambiarlo desde el selector de la cabecera.
  DEFAULT_CALENDAR_ID: "primary",

  // Cada cuántos segundos se vuelve a leer Google Calendar para traer
  // cambios hechos desde el móvil u otros dispositivos.
  REFRESH_SECONDS: 60,

  // Sincronización de turnos de trabajo (botón «Turnos» de la cabecera).
  // Lee la planificación publicada y copia SOLO los turnos del operador
  // indicado a tu calendario. Bórralo entero si no lo quieres usar.
  TURNOS: {
    CSV_URL: "https://joaomgonzalezt.github.io/turnos/horarios2026.csv",
    OPERADOR: "Luis Martinez",
    // true = solo turnos de hoy en adelante; false = también los pasados.
    SOLO_DESDE_HOY: true,
    // Zona horaria de los horarios del cuadrante.
    ZONA_HORARIA: "Europe/Madrid",
  },
};

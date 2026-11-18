# 📅 Lams Personal Calendar

**Web:** https://lams0502.github.io/Lams-Personal-Calendar/

Calendario web personal alojado en **GitHub Pages** y sincronizado con **Google Calendar**.

- Crear, modificar y eliminar eventos (con hora, de día completo y periódicos).
- **Tarjeta de evento** al hacer clic: detalles, ✏️ Editar, 🗑️ Eliminar (también con la tecla Supr) y enlace a Google.
- **Invitaciones** de otras personas: responder Sí / No / Quizás o quitarlas de tu calendario. Los eventos creados por Gmail también se pueden quitar.
- **Reuniones de Google Meet** (botón 🎥 Reunión Meet): enlace de Meet automático, invitados y envío de invitaciones por email. Para unirte, botón «Unirse con Google Meet».
- Arrastrar para mover un evento y estirar para cambiar su duración (si hay invitados, se les avisa del cambio).
- Vistas de mes, semana, día y agenda. En el móvil se adapta solo.
- **Turnos de trabajo** (botón 🗓️ Turnos): copia solo los turnos de Luis Martinez del cuadrante de operaciones. Cada tipo de turno tiene su color (☀️ mañana, 🌇 tarde, 🌙 noche) y la cabecera muestra tu próximo turno.
- **Rutina personal** (botón 🧩 Rutina): organiza sueño, entreno, formación, meditación y lectura alrededor de tus turnos.
- **Descargar o compartir en PDF** (botón 📄 PDF): mes, semana o agenda. Los turnos de trabajo salen solo como «Ocupado».
- **Diseñado también para el móvil**: barra inferior con Agenda, Día, 3 días y Mes, botón ＋, menú ⋯, deslizar para cambiar de semana e icono para la pantalla de inicio.
- Selector de calendarios, modo oscuro automático y tecla **N** para crear un evento nuevo.

**Cómo funciona:** no hay servidor ni base de datos. La página habla directamente con la API de Google Calendar desde tu navegador. Tu Google Calendar es el único sitio donde se guardan los datos, así que lo que cambies aquí aparece al instante en Google (móvil, Gmail…). Los cambios que hagas en Google se ven aquí al refrescar, cuando vuelves a la pestaña o cada 60 segundos.

---

## Estructura

```
├── index.html            Página principal
├── styles.css            Estilos (escritorio, tablet y móvil)
├── config.js             ← Lo único que tienes que editar
├── app.js                Lógica: login con Google, API, calendario, turnos y rutina
├── manifest.webmanifest  Icono y nombre para la pantalla de inicio
└── icons/                Iconos de la app
```

---

## Puesta en marcha (unos 15 minutos)

### 1. Sube el código a GitHub

1. Crea un repositorio nuevo en GitHub, `Lams-Personal-Calendar` (público: GitHub Pages gratis lo requiere).
2. Sube todos estos archivos a la rama `main`, ya sea arrastrándolos en la web de GitHub o con:
   ```bash
   git init
   git add .
   git commit -m "Calendario inicial"
   git branch -M main
   git remote add origin https://github.com/Lams0502/Lams-Personal-Calendar.git
   git push -u origin main
   ```

### 2. Activa GitHub Pages

1. En el repositorio, ve a **Settings → Pages**.
2. En *Build and deployment*, en **Source** elige **Deploy from a branch**.
3. En **Branch** elige `main` y la carpeta `/ (root)`, y pulsa **Save**.
4. Al cabo de uno o dos minutos tendrás la web en:
   `https://lams0502.github.io/Lams-Personal-Calendar/`

> Apunta el **origen**, que es la parte `https://lams0502.github.io`, sin la ruta del repositorio. Lo necesitas en el paso 3.

### 3. Crea las credenciales en Google Cloud

1. Entra en [console.cloud.google.com](https://console.cloud.google.com/) con la cuenta de Google del calendario.
2. **Crea un proyecto** nuevo (arriba, selector de proyectos → *Proyecto nuevo*), por ejemplo «Mi calendario».
3. **Activa la API:** menú → *APIs y servicios* → *Biblioteca* → busca **Google Calendar API** → **Habilitar**.
4. **Configura la pantalla de consentimiento** (menú → *Google Auth Platform*, o *APIs y servicios → Pantalla de consentimiento de OAuth*):
   - **Información de la app (Branding):** pon un nombre (por ejemplo «Mi calendario») y tu email.
   - **Público (Audience):** tipo **Externo**. Deja el estado en **Prueba (Testing)**.
   - En **Usuarios de prueba**, **añade tu propio email de Gmail**. Esto es imprescindible.
   - **Acceso a datos (Data access):** añade estos dos permisos (*scopes*). Es opcional pero recomendable:
     - `.../auth/calendar.events`
     - `.../auth/calendar.readonly`
5. **Crea el ID de cliente:** *Clientes* (o *Credenciales → Crear credenciales → ID de cliente de OAuth*):
   - Tipo de aplicación: **Aplicación web**.
   - **Orígenes de JavaScript autorizados:** añade estas dos entradas:
     - `https://lams0502.github.io`
     - `http://localhost:8000` (para probar en tu ordenador)
   - **URIs de redirección:** déjalo vacío, no hace falta.
   - Pulsa **Crear** y copia el **ID de cliente**, que termina en `.apps.googleusercontent.com`.

### 4. Pega tu CLIENT_ID

Edita `config.js`:

```js
CLIENT_ID: "1234567890-abc123.apps.googleusercontent.com",
```

Haz commit y push. GitHub Pages se actualiza en uno o dos minutos.

### 5. Úsalo

Abre `https://lams0502.github.io/Lams-Personal-Calendar/` → **Conectar con Google** → elige tu cuenta.

La primera vez Google mostrará **«Google no ha verificado esta aplicación»**. Es normal, porque es tu propia app en modo prueba. Pulsa **Continuar**, marca los permisos de Calendar y acepta.

---

## Turnos de trabajo (botón 🗓️ Turnos)

El botón lee la planificación publicada en `https://joaomgonzalezt.github.io/turnos/horarios2026.csv`, coge **únicamente la fila de «Luis Martinez»** y copia esos turnos a tu calendario.

| Código | Turno | Horario | Color |
|---|---|---|---|
| MA / ML | ☀️ Mañana Arteixo / Laracha | 07:00 – 15:00 | Amarillo |
| TA / TL | 🌇 Tarde Arteixo / Laracha | 15:00 – 23:00 | Naranja |
| NA / NL | 🌙 Noche Arteixo / Laracha | 23:00 – 07:00 (día siguiente) | Violeta |

Los turnos de noche se ven solo en el día en que empiezan. En las vistas de semana y día se ven completos, hasta las 07:00 del día siguiente.

Cómo funciona:
- Antes de cambiar nada te enseña un resumen: turnos nuevos, cambiados, eliminados y sin cambios. Solo aplica los cambios si pulsas **Sincronizar**.
- Puedes pulsarlo tantas veces como quieras: **no duplica**. Si el cuadrante cambia, corrige los turnos cambiados y borra los que ya no están.
- Solo toca los eventos que creó él mismo, porque llevan una marca interna. Tus otros eventos no se tocan nunca.
- Por defecto solo sincroniza **de hoy en adelante**. Los turnos pasados se quedan como estaban.
- Los turnos se crean en el calendario que tengas seleccionado arriba.

Ajustes en `config.js` → `TURNOS`:
- `OPERADOR`: el nombre tal como aparece en el cuadrante.
- `CSV_URL`: cámbialo cuando publiquen el cuadrante de otro año, por ejemplo `horarios2027.csv`.
- `SOLO_DESDE_HOY`: ponlo a `false` para importar también los turnos pasados.

> Aviso: al final del cuadrante actual hay 3 turnos después del 31 de diciembre sin fecha en el archivo. No se importan hasta que el cuadrante tenga esas fechas.

---

## Rutina personal (botón 🧩 Rutina)

Organiza cada día según el turno que tengas, a partir del mismo cuadrante que usa el botón Turnos:

| Día | Despertar | Meditación | Entreno (3 h) | Formación | Lectura | Sueño |
|---|---|---|---|---|---|---|
| ☀️ Mañana (07–15) | 05:15 | 05:15 | 18:40–21:40 | 16:30–19:30 (2 h si entrenas) | antes de dormir | desde 21:45 (22:05 si entrenas) |
| 🌇 Tarde (15–23) | 07:45 | 07:45 | 08:15–11:15 | 08:30–12:30 (2 h si entrenas) | 23:50 | 00:15–07:45 |
| 🌙 Primera noche | 07:45 | 07:45 | — | 09:30–12:30 | 20:00 | siesta 15:30–18:30 |
| 🌙 Noches seguidas | 15:15 | 15:15 | — | 16:15–19:15 | 20:00 | 08:15–15:15 |
| Libre tras noches | 14:15 | 14:15 | — | 16:00–18:00 | antes de dormir | 08:15–14:15 y desde 23:00 |
| Libre | 07:45 | 07:45 | 09:30–12:30 | 09:30–13:30 (16:00–19:30 si entrenas) | antes de dormir | desde 23:30 |

- **Trayecto** de 45 minutos de ida y vuelta, ya descontado.
- **Sueño**: 7,5 h de objetivo y nunca menos de 7 h por la noche. Si al día siguiente madrugas, te acuestas antes.
- **Entrenos**: 3 por semana, elegidos solos. Primero días libres, luego mañanas de turno de tarde y luego tardes de turno de mañana. Nunca en días de noche ni el día de recuperación, y sin días seguidos salvo que no haya otra opción (nunca tres seguidos).
- Antes de crear nada te enseña un resumen por semana y te avisa si algún bloque coincide con eventos tuyos (esos no se tocan).
- **Sin duplicados**: si cambia el cuadrante, pulsa primero **Turnos** y luego **Rutina**, y los bloques se recolocan solos.
- En la vista de **mes** solo se ven turnos, entrenos y formación. El sueño, la meditación y la lectura aparecen en las vistas de semana, día y agenda.
- Los avisos del móvil solo están activados para los entrenos (30 min antes). El resto de bloques no te notifica.

Ajustes en `config.js` → `RUTINA`: minutos de trayecto, horas de sueño y entrenos por semana.

---

## Calendario en PDF (botón 📄 PDF)

Crea un PDF para compartir. En el móvil está en el menú ⋯.

- **Formatos**: 📅 Mes (una página por mes), 🗓️ Semana (una página por semana) o 📋 Agenda (lista día a día).
- **Fechas**: por defecto, las que estás viendo en el calendario.
- **Qué incluir**: turnos de trabajo, tus eventos y reuniones, la rutina y, si quieres, las horas de sueño.
- **Privacidad**:
  - Los turnos del cuadrante salen **solo como «Ocupado»**, con su horario pero sin el tipo de turno (mañana, tarde o noche), sin el lugar y en gris neutro, para que el color tampoco lo delate.
  - La «Siesta antes de la noche» sale solo como «Siesta».
  - Del resto de eventos solo aparecen **la hora y el asunto**: nunca descripciones, ubicaciones, enlaces de Meet, invitados ni tu email.
  - Las invitaciones que rechazaste no aparecen.
- Al terminar puedes **descargarlo** o, en el móvil, **compartirlo** directamente (WhatsApp, correo…).

El PDF se crea en tu propio navegador: tus datos no se envían a ningún servidor.

---

## En el móvil

- **Barra inferior**: 📋 Agenda (2 semanas en tarjetas), Día, 3 días y Mes, y en el centro el botón **＋** para crear un evento.
- **Menú ⋯** (arriba a la derecha): cambiar de calendario, reunión de Google Meet, sincronizar turnos, organizar la rutina, actualizar y cerrar sesión.
- **Gestos**: desliza a izquierda o derecha para ir al periodo siguiente o anterior. En la vista de mes, toca un día para abrirlo. Mantén pulsado un hueco para crear un evento a esa hora.
- **Tarjeta de evento**: sale desde abajo; para cerrarla, deslízala hacia abajo.
- **Añadir a la pantalla de inicio** (se abre con su propio icono):
  - iPhone (Safari): botón Compartir → «Añadir a pantalla de inicio».
  - Android (Chrome): menú ⋮ → «Añadir a pantalla de inicio».

  Se abre en el navegador a propósito, porque así el inicio de sesión con Google funciona siempre.

---

## Probar en local

```bash
cd Lams-Personal-Calendar
python3 -m http.server 8000
```

Abre `http://localhost:8000`. No funciona abriendo `index.html` con doble clic: Google exige un origen `http(s)`.

---

## Preguntas frecuentes

**¿Es seguro que el CLIENT_ID esté en un repositorio público?**
Sí. El ID de cliente no es un secreto: solo identifica tu app. Lo que protege tus datos es que cada persona tiene que iniciar sesión con su propia cuenta de Google, y en modo prueba **solo los usuarios de prueba que tú añadas** pueden autorizar la app. Si alguien abre tu web, no ve nada tuyo.

**¿Por qué me pide reconectar cada hora?**
Al no haber servidor, Google da un permiso de acceso que dura 1 hora. Cuando caduca aparece una barra amarilla con **Reconectar**: es un clic y no pierdes nada. Si guardas un evento con la sesión caducada, se reconecta sola en el mismo clic.

**A veces Google me vuelve a pedir permiso entero.**
Mientras la app esté en modo prueba, Google puede pedirte el consentimiento otra vez cada 7 días. Es normal y no afecta a tus eventos.

**¿Qué pasa con los eventos periódicos?**
- Puedes crear eventos que se repitan cada día, semana, mes o año.
- Al editar o arrastrar una repetición, el cambio se aplica **solo a esa repetición**.
- Al eliminar, puedes marcar **«borrar toda la serie»**.
- Para reglas más complejas (por ejemplo «cada segundo martes»), créalas en Google Calendar y aquí se verán y podrás editarlas.

**¿Por qué algunos eventos no se pueden editar?**
Los eventos en los que no eres el organizador, los cumpleaños y los eventos creados desde Gmail son de solo lectura, igual que en Google. Puedes abrirlos en Google Calendar con el enlace del formulario.

**¿Puedo usar un dominio propio?**
Sí: en *Settings → Pages → Custom domain*. Después añade ese dominio (por ejemplo `https://calendario.midominio.com`) a los **Orígenes de JavaScript autorizados** en Google Cloud.

**Error «La API de Google Calendar no está activada»**
Vuelve al paso 3.3 y habilítala en el mismo proyecto donde creaste el ID de cliente.

**Error `origin_mismatch` o `redirect_uri_mismatch` al conectar**
El origen de la web no coincide con el configurado. Revisa que en Google Cloud esté exactamente `https://lams0502.github.io`: sin barra final y sin la ruta del repositorio. Los cambios pueden tardar unos minutos en aplicarse.

**Error `access_denied`**
No te has añadido como usuario de prueba (paso 3.4).

---

## Tecnología

- [FullCalendar 6](https://fullcalendar.io/): interfaz del calendario.
- [Google Identity Services](https://developers.google.com/identity/oauth2/web/guides/use-token-model): inicio de sesión (modelo de token).
- [Google Calendar API v3](https://developers.google.com/calendar/api/v3/reference): lectura y escritura de eventos.
- HTML, CSS y JavaScript sin frameworks ni compilación.

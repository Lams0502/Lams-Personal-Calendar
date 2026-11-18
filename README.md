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
- Selector de calendarios, modo oscuro automático y tecla **N** para crear un evento nuevo.

**Cómo funciona:** no hay servidor ni base de datos. La página habla directamente con la API de Google Calendar desde tu navegador. Tu Google Calendar es el único sitio donde se guardan los datos, así que lo que cambies aquí aparece al instante en Google (móvil, Gmail…). Los cambios que hagas en Google se ven aquí al refrescar, cuando vuelves a la pestaña o cada 60 segundos.

---

## Estructura

```
├── index.html   Página principal
├── styles.css   Estilos
├── config.js    ← Lo único que tienes que editar (tu CLIENT_ID)
└── app.js       Lógica: login con Google, API, calendario
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

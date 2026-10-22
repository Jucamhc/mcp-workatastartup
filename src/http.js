import fs from "node:fs";
import { ARCHIVO_SESION, BASE, CARPETA_DATOS, USER_AGENT } from "./config.js";

export class SesionExpirada extends Error {
  constructor(mensaje = "No hay sesión de Work at a Startup o venció. Usa iniciar-sesion.") {
    super(mensaje);
    this.estado = "sesion_expirada";
  }
}

export class ErrorWaas extends Error {
  constructor(mensaje, status, datos) {
    super(mensaje);
    this.estado = status === 429 ? "limite_de_peticiones" : status === 403 ? "bloqueado" : "error";
    this.status = status;
    this.datos = datos;
  }
}

/* ---------------------------------------------------------------- sesión (cookies) */

export function leerSesion() {
  if (!fs.existsSync(ARCHIVO_SESION)) return null;
  try {
    const sesion = JSON.parse(fs.readFileSync(ARCHIVO_SESION, "utf8"));
    return sesion?.cookies && Object.keys(sesion.cookies).length ? sesion : null;
  } catch {
    return null;
  }
}

export function guardarCookies(cookies) {
  fs.mkdirSync(CARPETA_DATOS, { recursive: true });
  fs.writeFileSync(ARCHIVO_SESION, JSON.stringify({ cookies, guardada: new Date().toISOString() }, null, 2), { mode: 0o600 });
}

export function borrarSesion() {
  if (fs.existsSync(ARCHIVO_SESION)) fs.rmSync(ARCHIVO_SESION);
}

export const hayCookies = () => Boolean(leerSesion());

const cabeceraCookies = (cookies) =>
  Object.entries(cookies)
    .map(([n, v]) => `${n}=${v}`)
    .join("; ");

/** Rails rota la cookie de sesión: se guardan las que devuelva cada respuesta. */
function actualizarCookies(respuesta, sesion) {
  const nuevas = respuesta.headers.getSetCookie?.() || [];
  if (!sesion || !nuevas.length) return;
  let cambio = false;
  for (const linea of nuevas) {
    const [par, ...atributos] = linea.split(";");
    const i = par.indexOf("=");
    if (i < 1) continue;
    const nombre = par.slice(0, i).trim();
    const valor = par.slice(i + 1).trim();
    const dominio = atributos.find((a) => /^\s*domain=/i.test(a));
    if (dominio && !/workatastartup\.com/i.test(dominio)) continue;
    const vencida = atributos.some((a) => /^\s*max-age=0/i.test(a) || (/^\s*expires=/i.test(a) && Date.parse(a.split("=")[1]) < Date.now()));
    if (vencida || !valor) {
      if (nombre in sesion.cookies) {
        delete sesion.cookies[nombre];
        cambio = true;
      }
    } else if (sesion.cookies[nombre] !== valor) {
      sesion.cookies[nombre] = valor;
      cambio = true;
    }
  }
  if (cambio) guardarCookies(sesion.cookies);
}

/* ---------------------------------------------------------------- peticiones */

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const alLogin = (url) => /account\.ycombinator\.com|\/users\/sign_in|\/sign_in\b/.test(url);

/**
 * Petición a workatastartup.com. auth=true exige sesión; auth="opcional" la usa si existe.
 * Sigue las redirecciones a mano para detectar el rebote al login. Solo las lecturas se reintentan ante 429.
 */
export async function pedir(ruta, { metodo = "GET", cuerpo, auth = false, aceptar = "text/html", cabeceras = {} } = {}) {
  const sesion = auth ? leerSesion() : null;
  if (auth === true && !sesion) throw new SesionExpirada();

  let url = ruta.startsWith("http") ? ruta : `${BASE}${ruta}`;
  for (let salto = 0, intento = 0; ; ) {
    const r = await fetch(url, {
      method: metodo,
      redirect: "manual",
      headers: {
        Accept: aceptar,
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": USER_AGENT,
        ...(sesion ? { Cookie: cabeceraCookies(sesion.cookies) } : {}),
        ...(cuerpo !== undefined ? { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/` } : {}),
        ...cabeceras,
      },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    });
    actualizarCookies(r, sesion);

    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      const destino = new URL(r.headers.get("location"), url).href;
      if (alLogin(destino)) {
        if (auth === true) throw new SesionExpirada();
        return { status: 401, url: destino, texto: "", alLogin: true };
      }
      if (++salto > 5 || metodo !== "GET") return { status: r.status, url: destino, texto: await r.text() };
      url = destino;
      continue;
    }
    if (r.status === 429 && metodo === "GET" && intento++ === 0) {
      await esperar((Number(r.headers.get("retry-after")) || 5) * 1000);
      continue;
    }
    const texto = await r.text();
    if (r.status === 401 && sesion) throw new SesionExpirada();
    return { status: r.status, url, texto };
  }
}

export function parsearJson(texto) {
  try {
    return texto ? JSON.parse(texto) : null;
  } catch {
    return null;
  }
}

/** GET que devuelve JSON o lanza un error legible. */
export async function pedirJson(ruta, opciones = {}) {
  const r = await pedir(ruta, { aceptar: "application/json", ...opciones, cabeceras: { "X-Requested-With": "XMLHttpRequest", ...opciones.cabeceras } });
  const datos = parsearJson(r.texto);
  if (r.status >= 200 && r.status < 300 && datos !== null) return datos;
  throw errorHttp(r.status, datos);
}

export function errorHttp(status, datos) {
  if (status === 429) return new ErrorWaas("Work at a Startup limitó las peticiones (429). Espera un minuto antes de seguir.", status, datos);
  if (status === 403) return new ErrorWaas("Work at a Startup rechazó la petición (403): posible protección antibot o falta de permisos. No se reintenta.", status, datos);
  if (status === 404) return new ErrorWaas("No existe (404): revisa el id o la URL.", status, datos);
  const detalle = datos && typeof datos === "object" ? datos.error || datos.message || datos.errors : null;
  return new ErrorWaas(`Work at a Startup respondió ${status}${detalle ? `: ${JSON.stringify(detalle)}` : ""}.`, status, datos);
}

/* ---------------------------------------------------------------- páginas Inertia */

export function decodificarHtml(texto) {
  return String(texto ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

export function textoPlano(html) {
  return decodificarHtml(
    String(html ?? "")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|ul|ol|tr)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function leerInertia(html) {
  const m = String(html).match(/data-page="([^"]*)"/);
  return m ? parsearJson(decodificarHtml(m[1])) : null;
}

export function leerCsrf(html) {
  return String(html).match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i)?.[1] || String(html).match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf-token["']/i)?.[1] || null;
}

/** Hay sesión si la navegación ofrece "logout". */
export const conSesion = (pagina) => Boolean(pagina?.props?.nav?.paths?.logout || pagina?.props?.rails_context?.currentUser || pagina?.props?.currentUser);

/** Carga una página y devuelve su JSON de Inertia, el HTML y si la sesión está activa. */
export async function pagina(ruta, { auth = "opcional" } = {}) {
  const r = await pedir(ruta, { auth });
  if (r.status === 404) throw errorHttp(404);
  if (r.status >= 400) throw errorHttp(r.status);
  const datos = leerInertia(r.texto);
  const logueado = conSesion(datos);
  if (auth === true && !logueado) throw new SesionExpirada();
  return { datos, html: r.texto, url: r.url, logueado };
}

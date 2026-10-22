import fs from "node:fs";
import { CARPETA_DATOS, CHROME, LOGIN, PERFIL_CHROME } from "./config.js";
import { SesionExpirada, conSesion, guardarCookies, hayCookies, leerInertia, pagina } from "./http.js";
import { cupoSemanal } from "./ofertas.js";

export async function estadoDeSesion() {
  if (!hayCookies()) {
    return { estado: "sesion_expirada", sesion: false, mensaje: "No hay sesión guardada. Usa iniciar-sesion." };
  }
  try {
    const { logueado } = await pagina("/jobs", { auth: "opcional" });
    if (!logueado) return { estado: "sesion_expirada", sesion: false, mensaje: "La sesión guardada venció. Usa iniciar-sesion." };
    const cupo = await cupoSemanal().catch(() => null);
    return { estado: "ok", sesion: true, ...(cupo ? { cupo_semanal: cupo } : {}) };
  } catch (e) {
    if (e instanceof SesionExpirada) return { estado: "sesion_expirada", sesion: false, mensaje: e.message };
    throw e;
  }
}

const cookiesDeWaas = (cookies) =>
  Object.fromEntries(cookies.filter((c) => /(^|\.)workatastartup\.com$/i.test(c.domain.replace(/^\./, ""))).map((c) => [c.name, c.value]));

async function cookiesConSesion(cookies) {
  if (!Object.keys(cookies).length) return false;
  const r = await fetch("https://www.workatastartup.com/jobs", {
    redirect: "manual",
    headers: { Cookie: Object.entries(cookies).map(([n, v]) => `${n}=${v}`).join("; "), Accept: "text/html" },
  });
  return r.status === 200 && conSesion(leerInertia(await r.text()));
}

/**
 * Abre un navegador con un perfil propio del MCP para que la persona entre a mano con su cuenta de
 * Y Combinator (enlace mágico por correo, contraseña o Google). Si el perfil ya tenía la sesión,
 * se guarda en segundos y la ventana se cierra sola.
 */
export async function iniciarSesion({ esperaMaxSegundos = 300 } = {}) {
  if (!CHROME) {
    throw new Error("No encontré un navegador basado en Chromium (Chrome, Edge, Brave o Chromium). Instala uno o define CHROME_PATH con la ruta de su ejecutable.");
  }
  const puppeteer = (await import("puppeteer-core")).default;
  fs.mkdirSync(PERFIL_CHROME, { recursive: true });

  const navegador = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    userDataDir: PERFIL_CHROME,
    defaultViewport: null,
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--no-first-run", "--no-default-browser-check", "--window-size=1100,850", "--disable-blink-features=AutomationControlled"],
  });

  let cookies = null;
  try {
    const pestana = await navegador.newPage();
    await pestana.bringToFront();
    try {
      await pestana.goto(LOGIN, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (e) {
      process.stderr.write(`[workatastartup] No cargó el login automáticamente (${e.message}). Escribe ${LOGIN} en la ventana.\n`);
    }
    for (const otra of await navegador.pages()) {
      if (otra !== pestana && otra.url() === "about:blank") await otra.close().catch(() => {});
    }
    process.stderr.write("[workatastartup] Ventana de inicio de sesión abierta.\n");

    const cliente = await pestana.createCDPSession();
    const limite = Date.now() + esperaMaxSegundos * 1000;
    let ultima = "";
    while (Date.now() < limite && navegador.connected) {
      try {
        const candidatas = cookiesDeWaas((await cliente.send("Network.getAllCookies")).cookies);
        const huella = JSON.stringify(candidatas);
        if (huella !== ultima) {
          ultima = huella;
          if (await cookiesConSesion(candidatas)) {
            cookies = candidatas;
            break;
          }
        }
      } catch {
        // La página está navegando; se reintenta en la siguiente vuelta.
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  } finally {
    if (navegador.connected) await navegador.close();
  }

  if (!cookies) {
    return {
      estado: "sesion_expirada",
      sesion: false,
      mensaje: `No detecté el inicio de sesión en ${esperaMaxSegundos} s o se cerró la ventana. Vuelve a llamar a iniciar-sesion.`,
    };
  }
  guardarCookies(cookies);
  const estado = await estadoDeSesion();
  return { ...estado, mensaje: estado.sesion ? `Sesión guardada en ${CARPETA_DATOS}.` : estado.mensaje };
}

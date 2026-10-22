import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const BASE = "https://www.workatastartup.com";
export const LOGIN = `https://account.ycombinator.com/magic?continue=${encodeURIComponent(`${BASE}/jobs`)}`;
export const ALGOLIA_APP = "45BWZJ1SGC";
export const INDICES_OFERTAS = {
  relevancia: "WaaSPublicCompanyJob_production",
  recientes: "WaaSPublicCompanyJob_created_at_desc_production",
};

// Límite semanal de postulaciones dentro de la plataforma ("You've reached your limit of 5 applications per week").
// Puede variar por cuenta: WAAS_CUPO_SEMANAL lo ajusta.
export const CUPO_SEMANAL = Number(process.env.WAAS_CUPO_SEMANAL) || 5;
export const MIN_CARACTERES_MENSAJE = 50;

// Sesión y caché en la carpeta del usuario (fuera de carpetas sincronizadas).
export const CARPETA_DATOS = process.env.WAAS_DATA_DIR || path.join(os.homedir(), ".workatastartup");
export const ARCHIVO_SESION = path.join(CARPETA_DATOS, "sesion.json");
export const PERFIL_CHROME = path.join(CARPETA_DATOS, "chrome-profile");

export const PORTAL = "workatastartup";

// Cualquier navegador basado en Chromium sirve para el inicio de sesión manual.
export const CHROME =
  process.env.CHROME_PATH ||
  [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe"),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/usr/bin/microsoft-edge",
    "/usr/bin/brave-browser",
  ].find((ruta) => fs.existsSync(ruta));

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

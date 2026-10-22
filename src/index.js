#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CUPO_SEMANAL, PORTAL } from "./config.js";
import { evaluarEncaje, proponerRespuestas } from "./encaje.js";
import { ESPECIALIDADES, buscarOfertas, detalleDeEmpresa, detalleDeOferta, misPostulaciones, postularAOferta, preguntasDePostulacion, publico } from "./ofertas.js";
import { registrarHerramientasPerfilMaestro } from "./perfil-maestro.js";
import { compararPerfil, verMiPerfil } from "./perfil.js";
import { estadoDeSesion, iniciarSesion } from "./sesion.js";

const servidor = new McpServer({ name: "mcp-workatastartup", version: "0.1.0" });

function responder(datos) {
  return { content: [{ type: "text", text: JSON.stringify(datos, null, 2) }] };
}

function herramienta(nombre, descripcion, esquema, funcion) {
  servidor.registerTool(nombre, { description: descripcion, inputSchema: esquema }, async (args) => {
    try {
      return responder(await funcion(args || {}));
    } catch (e) {
      return responder({ estado: e.estado || "error", mensaje: e.message });
    }
  });
}

const oferta = z.union([z.string(), z.number()]).describe("Id numérico de la oferta o su URL (https://www.workatastartup.com/jobs/<id>).");

/* Sesión */

herramienta(
  "estado-de-sesion",
  "Indica si hay una sesión vigente de Work at a Startup y cuántas postulaciones quedan esta semana. Nunca muestra cookies ni credenciales.",
  {},
  () => estadoDeSesion()
);

herramienta(
  "iniciar-sesion",
  "Abre un navegador basado en Chromium en el login de Y Combinator para que el usuario entre a mano con su cuenta (enlace por correo, contraseña o Google). Si el navegador del MCP ya tenía la sesión, se guarda sola en segundos. Guarda las cookies en la carpeta de datos del MCP y cierra la ventana.",
  { espera_max_segundos: z.number().int().min(30).max(900).optional().describe("Tiempo máximo de espera (por defecto 300 s).") },
  ({ espera_max_segundos }) => iniciarSesion({ esperaMaxSegundos: espera_max_segundos })
);

/* Búsqueda */

herramienta(
  "buscar-ofertas",
  "Busca ofertas en Work at a Startup (startups de Y Combinator; casi todas en inglés y en EE. UU.). Con sesión busca en todas con filtros e indica si ya te postulaste; sin sesión solo ve las ~30 más recientes. Por defecto, remoto y visa salen del perfil maestro: si buscas remoto filtra ofertas con remoto, y si no vives en EE. UU. excluye las que exigen ciudadanía o visa de EE. UU.",
  {
    palabra: z.string().min(2).optional().describe('Palabra clave en inglés, p. ej. "react", "full stack", "laravel".'),
    rol: z.enum(["eng", "design", "product", "science", "sales", "marketing", "support", "operations", "recruiting", "finance", "legal"]).optional().describe("Área. eng = ingeniería."),
    especialidad: z
      .union([z.enum(ESPECIALIDADES), z.array(z.enum(ESPECIALIDADES))])
      .optional()
      .describe("Especialidad de ingeniería: fs full stack, fe frontend, be backend, android, ios, ai, ml, data_sci, devops, qa, eng_mgmt, embedded, robotics, hw."),
    remoto: z.enum(["remoto", "solo_remoto", "presencial", "todas"]).optional().describe("remoto = acepta remoto; solo_remoto = 100 % remoto. Por defecto sale de preferencias.modalidad."),
    tipo: z.enum(["fulltime", "contract", "intern"]).optional(),
    sin_visa_eeuu: z.boolean().optional().describe("true = excluye ofertas que exigen ciudadanía o visa de EE. UU. Por defecto true si datos_personales.pais no es EE. UU."),
    experiencia_max: z.number().int().min(0).max(20).optional().describe("Deja solo ofertas que piden como máximo estos años de experiencia."),
    con_salario: z.boolean().optional().describe("Solo ofertas que publican rango salarial."),
    orden: z.enum(["relevancia", "recientes"]).optional().describe("Por defecto: relevancia si hay palabra; si no, recientes."),
    pagina: z.number().int().min(1).optional(),
    por_pagina: z.number().int().min(5).max(50).optional(),
  },
  (a) => buscarOfertas(a)
);

herramienta(
  "detalle-de-oferta",
  "Devuelve la oferta completa: descripción, ubicación y modalidad (incluido si el remoto se limita a un país), salario, equity, experiencia mínima, visa, habilidades, proceso de entrevista y si tiene preguntas de postulación.",
  { oferta },
  async ({ oferta: o }) => publico(await detalleDeOferta(o))
);

herramienta(
  "detalle-de-empresa",
  "Devuelve la startup: batch de YC, descripción, tamaño, fundadores, stack, cómo contrata y todas sus ofertas abiertas.",
  { empresa: z.string().describe("Slug de la empresa (p. ej. givecampus) o su URL /companies/<slug>.") },
  ({ empresa }) => detalleDeEmpresa(empresa)
);

herramienta(
  "evaluar-encaje",
  "Compara la oferta con el perfil maestro: modalidad y país permitido para el remoto, visa de EE. UU., tipo de empleo, experiencia mínima, salario en USD (si el perfil declara preferencias.salario_minimo_usd_anual), tecnologías e inglés. Devuelve encaja, encaja_parcial o no_encaja con los motivos.",
  { oferta },
  ({ oferta: o }) => evaluarEncaje(o)
);

/* Postulación */

herramienta(
  "preguntas-de-postulacion",
  `Lee cómo se postula (requiere sesión): si ya te postulaste, el cupo semanal (${CUPO_SEMANAL} postulaciones por semana), el mensaje obligatorio a los fundadores y las preguntas de la empresa con sus opciones y límites. No envía nada.`,
  { oferta },
  ({ oferta: o }) => preguntasDePostulacion(o)
);

herramienta(
  "proponer-respuestas",
  "Propone, en inglés y a partir del perfil maestro, un borrador del mensaje a los fundadores y las respuestas a las preguntas, y las clasifica (respaldada, requiere_confirmacion, sin_respaldo). Nunca inventa datos ni envía nada.",
  { oferta },
  ({ oferta: o }) => proponerRespuestas(o)
);

herramienta(
  "postular-a-oferta",
  `Envía la postulación: el mensaje a la empresa y las respuestas a sus preguntas, en una sola petición. Gasta 1 de las ${CUPO_SEMANAL} postulaciones semanales y no se puede deshacer. Exige la confirmación explícita del usuario para ESA oferta: confirmacion debe ser exactamente "POSTULAR <id>". Una oferta a la vez, sin reintentos automáticos.`,
  {
    oferta,
    confirmacion: z.string().describe('Exactamente "POSTULAR <id numérico>", solo después de que el usuario aprobó la oferta, el mensaje y las respuestas.'),
    mensaje: z.string().describe("Mensaje a los fundadores aprobado por el usuario (mínimo 50 caracteres, en inglés)."),
    respuestas: z
      .array(
        z.object({
          pregunta_id: z.number().int(),
          respuesta: z.union([z.string(), z.array(z.string())]).describe("Texto; en preguntas de opción, el texto o id de la opción (varias en opción múltiple)."),
        })
      )
      .optional()
      .describe("Respuestas aprobadas por el usuario para las preguntas de preguntas-de-postulacion."),
    abierto_a_reubicacion: z.boolean().optional().describe("Solo si el usuario lo confirmó: marca que acepta reubicarse cuando la oferta está fuera de sus preferencias de ubicación."),
  },
  (a) => postularAOferta(a)
);

herramienta(
  "mis-postulaciones",
  "Lista las empresas a las que te postulaste en Work at a Startup, con fecha, ofertas, respuestas recibidas y el cupo semanal, y los fundadores que te escribieron primero (y si les respondiste).",
  {},
  () => misPostulaciones()
);

/* Perfil de candidato en la web (solo lectura) */

herramienta(
  "ver-mi-perfil",
  "Lee tu perfil de candidato en Work at a Startup: visibilidad, frase corta, qué buscas, rol, años de experiencia, ubicación, remoto y reubicación, autorización en EE. UU., habilidades, experiencia, formación y CV.",
  {},
  () => verMiPerfil()
);

herramienta(
  "comparar-perfil",
  "Compara tu perfil de candidato de Work at a Startup con el perfil maestro y lista lo que conviene corregir en la web (años, ciudad, remoto, reubicación, enlaces, fechas de experiencia y estudios, habilidades no declaradas). No modifica nada.",
  {},
  () => compararPerfil()
);

/* Perfil maestro (estándar compartido: construir, guardar y ver) */

registrarHerramientasPerfilMaestro(servidor, { z, portal: PORTAL });

await servidor.connect(new StdioServerTransport());

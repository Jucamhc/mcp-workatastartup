import { ALGOLIA_APP, BASE, CUPO_SEMANAL, INDICES_OFERTAS, MIN_CARACTERES_MENSAJE } from "./config.js";
import { ErrorWaas, SesionExpirada, errorHttp, hayCookies, leerCsrf, pagina, parsearJson, pedir, pedirJson, textoPlano } from "./http.js";
import { cargarPerfilMaestro, existePerfilMaestro } from "./perfil-maestro.js";

/* ---------------------------------------------------------------- utilidades */

/** Primer valor no vacío entre varias claves (la web mezcla camelCase, snake_case y "pretty_"). */
function campo(objeto, ...claves) {
  for (const clave of claves) {
    const v = objeto?.[clave];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

const nombres = (lista) => (Array.isArray(lista) ? lista.map((s) => (typeof s === "string" ? s : s?.name || s?.label)).filter(Boolean) : []);

export function idOferta(oferta) {
  const t = String(oferta ?? "").trim();
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/\/jobs\/(\d+)/);
  if (m) return Number(m[1]);
  throw new ErrorWaas(`No reconozco "${oferta}" como oferta: usa el id numérico o la URL /jobs/<id>.`);
}

export function slugEmpresa(empresa) {
  const t = String(empresa ?? "").trim();
  const m = t.match(/\/companies\/([^/?#]+)/);
  if (m) return m[1];
  if (/^[a-z0-9][a-z0-9-]*$/i.test(t)) return t;
  throw new ErrorWaas(`No reconozco "${empresa}" como empresa: usa el slug (p. ej. givecampus) o la URL /companies/<slug>.`);
}

const urlOferta = (id) => `${BASE}/jobs/${id}`;
const urlEmpresa = (slug) => (slug ? `${BASE}/companies/${slug}` : null);

/** "Remote (US)", "SF / Remote" … → remoto, híbrido o presencial, y si el remoto se limita a un país. */
export function modalidadDe(ubicacion, remoto) {
  const t = String(ubicacion || "").toLowerCase();
  const r = String(remoto ?? "").toLowerCase();
  const restriccion = t.match(/remote\s*\(([^)]+)\)/)?.[1] || null;
  const otrosLugares = t.replace(/remote\s*(\([^)]*\))?/g, "").replace(/\b(and|or|only)\b|[^a-z]/g, "").length > 0;
  let modalidad = "presencial";
  if (r === "only" || (/remote/.test(t) && !otrosLugares)) modalidad = "remoto";
  else if (r === "yes" || /remote/.test(t)) modalidad = "remoto o presencial";
  return { modalidad, remoto_restringido_a: restriccion };
}

/* ---------------------------------------------------------------- búsqueda */

let credencial = null;

/** Llave de Algolia de la sesión (la anónima no devuelve ofertas). Dura unas horas; se renueva sola. */
async function credencialAlgolia() {
  if (credencial && credencial.vence > Date.now() + 60000) return credencial;
  const { html, logueado } = await pagina("/jobs", { auth: true });
  const opts = parsearJson(html.match(/AlgoliaOpts\s*=\s*(\{.*?\});/)?.[1]);
  if (!logueado || !opts?.key || /none/.test(opts.tag_filters || "")) throw new SesionExpirada();
  credencial = { app: opts.app || ALGOLIA_APP, key: opts.key, vence: (Number(opts.valid_until) || Date.now() / 1000 + 3600) * 1000 };
  return credencial;
}

async function consultarAlgolia({ consulta = "", filtros = "", pagina: p = 0, porPagina = 20, orden = "relevancia" }) {
  const { app, key } = await credencialAlgolia();
  const params = new URLSearchParams({ query: consulta, page: String(p), hitsPerPage: String(porPagina), ...(filtros ? { filters: filtros } : {}) });
  const r = await fetch(`https://${app.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries?x-algolia-application-id=${app}&x-algolia-api-key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ indexName: INDICES_OFERTAS[orden] || INDICES_OFERTAS.relevancia, params: params.toString() }] }),
  });
  const datos = await r.json().catch(() => null);
  if (!r.ok) {
    credencial = null;
    throw errorHttp(r.status, datos);
  }
  return datos?.results?.[0] || { hits: [], nbHits: 0, nbPages: 0 };
}

const MODALIDAD_ALGOLIA = { only: "remoto", yes: "remoto o presencial", no: "presencial" };
const VISA_ALGOLIA = { none: "no exige visa de EE. UU.", possible: "patrocina visa de EE. UU.", yes: "exige ciudadanía o visa de EE. UU." };

/** Los resultados de Algolia no traen salario ni ubicación en texto: se arman con remote y locations_for_search. */
function ofertaDeAlgolia(h) {
  const id = Number(campo(h, "id", "objectID"));
  const lugares = Array.isArray(h.locations_for_search) ? h.locations_for_search : [];
  const ciudades = lugares.filter((l) => l.split(",").length === 3);
  const paises = lugares.filter((l) => !l.includes(","));
  return {
    id,
    titulo: campo(h, "title"),
    empresa: campo(h, "company_name"),
    empresa_slug: String(h.search_path || "").match(/\/companies\/([^/?#]+)/)?.[1] || null,
    empresa_id: campo(h, "company_id"),
    modalidad: MODALIDAD_ALGOLIA[h.remote] || null,
    ubicacion: ciudades.join(" / ") || paises.join(", ") || (h.remote === "only" ? "Remote" : null),
    paises: paises.length ? paises : null,
    tipo: campo(h, "job_type"),
    rol: campo(h, "role"),
    especialidad: nombres(h.eng_type).join(", ") || null,
    experiencia_minima: h.min_experience ?? null,
    visa: VISA_ALGOLIA[h.us_visa_required] || h.us_visa_required || null,
    publica_salario: h.has_salary ?? null,
    habilidades: nombres(h.skills),
    tamano_empresa: campo(h, "company_team_size"),
    sector: [h.company_parent_sector, h.company_child_sector].filter(Boolean).join(" > ") || null,
    publicada: String(h.created_at || "").slice(0, 10) || null,
    url: urlOferta(id),
  };
}

function ofertaPublica(j) {
  return {
    id: j.id,
    titulo: j.title,
    empresa: j.companyName,
    empresa_slug: j.companySlug,
    batch: j.companyBatch,
    ubicacion: j.location,
    ...modalidadDe(j.location),
    tipo: j.jobType,
    rol: j.roleType,
    salario: j.salary || null,
    url: urlOferta(j.id),
  };
}

const PAISES_EEUU = /^(estados unidos|ee\.? ?uu\.?|usa|us|united states)$/i;

/** Filtros por defecto que salen del perfil maestro (modalidad y si necesitas visa de EE. UU.). */
export function filtrosDelPerfil() {
  if (!existePerfilMaestro()) return { remoto: "todas", sin_visa_eeuu: false, origen: "sin perfil maestro" };
  const perfil = cargarPerfilMaestro();
  const modalidad = String(perfil.preferencias?.modalidad || "").toLowerCase();
  const pais = perfil.datos_personales?.pais || "";
  return {
    remoto: /remot/.test(modalidad) ? "remoto" : "todas",
    sin_visa_eeuu: Boolean(pais) && !PAISES_EEUU.test(pais.trim()),
    origen: `preferencias.modalidad (${perfil.preferencias?.modalidad || "sin dato"}) y datos_personales.pais (${pais || "sin dato"})`,
  };
}

const ROLES = ["eng", "design", "product", "science", "sales", "marketing", "support", "operations", "recruiting", "finance", "legal"];
export const ESPECIALIDADES = ["fs", "fe", "be", "android", "ios", "ai", "ml", "data_sci", "devops", "qa", "eng_mgmt", "embedded", "robotics", "hw"];

export async function buscarOfertas({ palabra, rol, especialidad, remoto, tipo, sin_visa_eeuu, experiencia_max, con_salario, orden, pagina: p = 1, por_pagina = 20 } = {}) {
  const defecto = filtrosDelPerfil();
  const remotoFinal = remoto || defecto.remoto;
  const visaFinal = sin_visa_eeuu ?? defecto.sin_visa_eeuu;

  if (!hayCookies()) return busquedaPublica({ palabra, remoto: remotoFinal });

  const partes = [];
  if (rol) partes.push(`role:${rol}`);
  const especialidades = [especialidad].flat().filter(Boolean);
  if (especialidades.length) partes.push(`(${especialidades.map((e) => `eng_type:${e}`).join(" OR ")})`);
  if (remotoFinal === "solo_remoto") partes.push(`remote:only`);
  if (remotoFinal === "remoto") partes.push(`(remote:yes OR remote:only)`);
  if (remotoFinal === "presencial") partes.push(`remote:no`);
  if (tipo) partes.push(`job_type:"${tipo}"`);
  if (visaFinal) partes.push(`(us_visa_required:none OR us_visa_required:possible)`);
  if (experiencia_max !== undefined) partes.push(`min_experience <= ${Number(experiencia_max)}`);
  if (con_salario) partes.push(`has_salary:true`);
  const filtros = partes.join(" AND ");

  const ordenFinal = orden || (palabra ? "relevancia" : "recientes");
  let resultado;
  try {
    resultado = await consultarAlgolia({ consulta: palabra || "", filtros, pagina: p - 1, porPagina: por_pagina, orden: ordenFinal });
  } catch (e) {
    if (e instanceof SesionExpirada) return { ...(await busquedaPublica({ palabra, remoto: remotoFinal })), aviso_sesion: e.message };
    throw e;
  }

  const aplicadas = await idsPostulados().catch(() => null);
  const ofertas = (resultado.hits || []).map((h) => {
    const o = ofertaDeAlgolia(h);
    if (!aplicadas) return o;
    return { ...o, ya_postulado: aplicadas.ofertas.has(o.id), ...(o.empresa_id != null && aplicadas.empresas.has(o.empresa_id) ? { ya_escribiste_a_la_empresa: true } : {}) };
  });

  return {
    fuente: "algolia (con sesión)",
    total: resultado.nbHits ?? ofertas.length,
    pagina: p,
    paginas: resultado.nbPages ?? null,
    filtros: {
      palabra: palabra || null,
      rol: rol || null,
      especialidad: especialidades.length ? especialidades : null,
      remoto: remotoFinal,
      sin_visa_eeuu: visaFinal,
      tipo: tipo || null,
      experiencia_max: experiencia_max ?? null,
      con_salario: Boolean(con_salario),
      orden: ordenFinal,
      ...(remoto === undefined || sin_visa_eeuu === undefined ? { por_defecto: defecto.origen } : {}),
    },
    ofertas,
    nota: "La lista no trae salario ni el detalle de ubicación: usa detalle-de-oferta o evaluar-encaje antes de decidir.",
  };
}

/** Sin sesión, la web solo muestra las ofertas más recientes y sin filtros. */
async function busquedaPublica({ palabra, remoto }) {
  const { datos } = await pagina("/jobs", { auth: false });
  const todas = (datos?.props?.jobs || []).map(ofertaPublica);
  const t = String(palabra || "").toLowerCase();
  const ofertas = todas.filter(
    (o) => (!t || `${o.titulo} ${o.empresa} ${o.rol}`.toLowerCase().includes(t)) && (remoto === "todas" || remoto === "presencial" ? true : o.modalidad !== "presencial")
  );
  return {
    fuente: "listado público (sin sesión)",
    total_en_la_plataforma: datos?.props?.totalJobsCount ?? null,
    ofertas,
    aviso: `Sin sesión, Work at a Startup solo muestra las ${todas.length} ofertas más recientes y no permite filtrar. Usa iniciar-sesion para buscar en todas (${datos?.props?.totalJobsCount ?? "miles de"} ofertas) con filtros.`,
  };
}

/* ---------------------------------------------------------------- detalle */

function empresaDe(c = {}) {
  return {
    id: campo(c, "id"),
    nombre: campo(c, "name"),
    slug: campo(c, "slug"),
    batch: campo(c, "batch"),
    descripcion: campo(c, "description", "one_liner", "oneLiner"),
    web: campo(c, "url", "website"),
    ubicacion: campo(c, "location"),
    tamano: campo(c, "teamSize", "team_size"),
    industria: campo(c, "industry"),
    fundadores: (c.founders || []).map((f) => campo(f, "full_name", "fullName", "name")).filter(Boolean),
  };
}

const PATRON_EXTERNA = /apply (directly )?(at|on|via|through) (our|the) (website|careers|site|ats)|apply here:|please apply (at|on|via)|greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com/i;

export async function detalleDeOferta(oferta) {
  const id = idOferta(oferta);
  const { datos, html, logueado } = await pagina(`/jobs/${id}`, { auth: "opcional" });
  const props = datos?.props || {};
  const j = props.job;
  if (!j) throw new ErrorWaas(`No encontré los datos de la oferta ${id}. Puede que ya no esté publicada o que la página haya cambiado.`);
  const empresa = empresaDe(props.company);
  empresa.id ??= props.companyFull?.id ?? null;
  const descripcion = textoPlano(campo(j, "descriptionHtml", "description_html", "description"));
  const ubicacion = campo(j, "location", "locationOrRemote", "pretty_location_or_remote");
  return {
    id,
    titulo: campo(j, "title"),
    empresa: empresa.nombre,
    empresa_slug: empresa.slug,
    empresa_id: empresa.id,
    ...(logueado
      ? {
          ya_postulado: (props.appliedJobIds || []).map(Number).includes(id),
          ya_escribiste_a_la_empresa: Boolean(props.appliedToCompany),
        }
      : {}),
    batch: empresa.batch,
    ubicacion,
    ...modalidadDe(ubicacion, j.remote),
    tipo: campo(j, "jobType", "pretty_job_type", "job_type"),
    rol: campo(j, "roleType", "pretty_role", "role"),
    salario: campo(j, "salaryRange", "pretty_salary_range", "salary_range"),
    equity: campo(j, "equityRange", "pretty_equity_range", "equity_range"),
    experiencia_minima: campo(j, "minExperience", "pretty_min_experience", "min_experience"),
    visa: campo(j, "sponsorsVisa", "pretty_sponsors_visa", "sponsors_visa"),
    habilidades: nombres(j.skills),
    descripcion,
    proceso_de_entrevista: textoPlano(campo(j, "interviewProcessHtml", "interview_process_html")) || null,
    preguntas_de_postulacion: (props.customQuestions || []).filter((q) => !q.archived_at).length,
    postulacion_externa: PATRON_EXTERNA.test(descripcion),
    elegible_por_ubicacion: props.locationEligible ?? null,
    con_sesion: logueado,
    empresa_detalle: empresa,
    url: urlOferta(id),
    _csrf: leerCsrf(html),
    _props: props,
  };
}

/** Quita los campos internos antes de devolver el detalle al asistente. */
export function publico(detalle) {
  const { _csrf, _props, ...resto } = detalle;
  return resto;
}

export async function detalleDeEmpresa(empresa) {
  const slug = slugEmpresa(empresa);
  const { datos } = await pagina(`/companies/${slug}`, { auth: "opcional" });
  const c = datos?.props?.company;
  if (!c) throw new ErrorWaas(`No encontré la empresa "${slug}".`);
  return {
    ...empresaDe(c),
    sobre_contratacion: textoPlano(campo(c, "hiringDescriptionHtml", "hiring_description_html")) || null,
    stack: textoPlano(campo(c, "techDescriptionHtml", "tech_description_html")) || null,
    ofertas: (c.jobs || []).map((j) => {
      const ubicacion = campo(j, "location", "pretty_location_or_remote", "locationOrRemote");
      return {
        id: j.id,
        titulo: j.title,
        ubicacion,
        ...modalidadDe(ubicacion, j.remote),
        tipo: campo(j, "jobType", "pretty_job_type", "job_type"),
        salario: campo(j, "salaryRange", "pretty_salary_range", "salary_range"),
        experiencia_minima: campo(j, "minExperience", "pretty_min_experience", "min_experience"),
        visa: campo(j, "sponsorsVisa", "pretty_sponsors_visa"),
        habilidades: nombres(j.skills),
        url: urlOferta(j.id),
      };
    }),
    url: urlEmpresa(slug),
  };
}

/* ---------------------------------------------------------------- postulaciones */

async function conversaciones() {
  const datos = await pedirJson("/api/conversations", { auth: true });
  return Array.isArray(datos) ? datos : datos?.conversations || [];
}

/** Empresas que escribieron primero (sin postulación tuya): suelen ser invitaciones a aplicar. */
function contactosDe(lista) {
  return lista
    .filter((c) => !c.has_applied && (c.messages || []).some((m) => m.from_candidate === false))
    .map((c) => ({
      empresa: c.company?.name || null,
      empresa_id: c.company?.id ?? null,
      descripcion: c.company?.one_liner || null,
      ubicacion: c.company?.location || null,
      de: [c.user?.name, c.user?.title].filter(Boolean).join(", ") || null,
      fundador_yc: c.user?.yc_founder ?? null,
      fecha: c.company_messaged_at || c.last_active_at || null,
      ofertas_ids: c.referenced_job_ids || [],
      mensaje: String(c.last_message || "").slice(0, 400),
      respondiste: Boolean(c.last_candidate_message),
      leido: c.is_read ?? null,
    }))
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

function inicioDeSemana(ahora = new Date()) {
  const d = new Date(ahora);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

function postulacionesDe(lista) {
  return lista
    .filter((c) => c.has_applied)
    .map((c) => {
      const mios = (c.messages || []).filter((m) => m.from_candidate && m.created_at).map((m) => m.created_at).sort();
      return {
        empresa: c.company?.name || null,
        empresa_id: c.company?.id ?? null,
        oferta: c.applied_job_title || null,
        ofertas_ids: c.referenced_job_ids || [],
        fecha: mios[0] || c.last_active_at || null,
        ultima_actividad: c.last_active_at || null,
        respuestas_de_la_empresa: (c.messages || []).filter((m) => m.from_candidate === false).length,
        estado: c.state || null,
      };
    })
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

async function idsPostulados() {
  const lista = postulacionesDe(await conversaciones());
  return { ofertas: new Set(lista.flatMap((p) => p.ofertas_ids.map(Number))), empresas: new Set(lista.map((p) => p.empresa_id).filter((x) => x != null)) };
}

export async function cupoSemanal(lista) {
  const postulaciones = lista || postulacionesDe(await conversaciones());
  const inicio = inicioDeSemana();
  const usadas = postulaciones.filter((p) => p.fecha && new Date(p.fecha) >= inicio).length;
  const reinicio = new Date(inicio);
  reinicio.setUTCDate(reinicio.getUTCDate() + 7);
  return {
    limite: CUPO_SEMANAL,
    usadas,
    disponibles: Math.max(0, CUPO_SEMANAL - usadas),
    semana_desde: inicio.toISOString().slice(0, 10),
    se_reinicia: reinicio.toISOString().slice(0, 10),
    nota: "Cálculo aproximado a partir de tus conversaciones; el límite real lo aplica Work at a Startup al enviar.",
  };
}

export async function misPostulaciones() {
  const lista = await conversaciones();
  const postulaciones = postulacionesDe(lista);
  const contactos = contactosDe(lista);
  return {
    total: postulaciones.length,
    cupo_semanal: await cupoSemanal(postulaciones),
    postulaciones,
    empresas_que_te_escribieron: contactos,
    ...(contactos.some((c) => !c.respondiste) ? { nota: "Hay empresas que te escribieron y no has respondido: responde desde la web (Messages)." } : {}),
  };
}

function preguntaDe(q) {
  const tipo = q.question_type;
  return {
    pregunta_id: q.id,
    pregunta: String(q.label || "").trim(),
    tipo,
    obligatoria: Boolean(q.required),
    ...(["single_choice", "multiple_choice"].includes(tipo) ? { opciones: (q.options || []).filter((o) => !o.archived).map((o) => ({ id: o.id, texto: o.label })) } : {}),
    max_caracteres: tipo === "long_text" ? 5000 : tipo === "url" ? 2000 : tipo === "text" ? 250 : undefined,
  };
}

/** Lee cómo se postula a la oferta. No envía nada. */
export async function preguntasDePostulacion(oferta) {
  const detalle = await detalleDeOferta(oferta);
  if (!detalle.con_sesion) throw new SesionExpirada();
  const base = { id: detalle.id, titulo: detalle.titulo, empresa: detalle.empresa, url: detalle.url };

  const postulados = await idsPostulados();
  if (detalle.ya_postulado || postulados.ofertas.has(detalle.id)) return { ...base, estado: "ya_postulado", mensaje: "Ya te postulaste a esta oferta." };
  const perfilWeb = detalle._props.profile;
  if (perfilWeb && perfilWeb.minimally_complete === false) {
    return { ...base, estado: "perfil_incompleto", mensaje: "Work at a Startup no deja postular hasta completar tu perfil de candidato: termínalo en https://www.workatastartup.com/application." };
  }
  if (perfilWeb && perfilWeb.shared === false) {
    return { ...base, estado: "perfil_no_compartido", mensaje: "Tu perfil no está visible para las empresas: cambia tu estado de búsqueda en https://www.workatastartup.com/application/share." };
  }
  const cupo = await cupoSemanal();
  if (!cupo.disponibles) return { ...base, estado: "limite_semanal", cupo_semanal: cupo, mensaje: `Usaste las ${cupo.limite} postulaciones de esta semana; se reinicia el ${cupo.se_reinicia}.` };

  const datos = await pedirJson(`/jobs/${detalle.id}/custom_questions.json`, { auth: true }).catch(() => ({ questions: detalle._props.customQuestions || [] }));
  const preguntas = (datos?.questions || []).filter((q) => !q.archived_at).map(preguntaDe);

  return {
    ...base,
    estado: detalle.postulacion_externa ? "revisar_externa" : "listo",
    ...(detalle.postulacion_externa ? { aviso_externa: "La descripción pide postular fuera de Work at a Startup: revísala antes de enviar aquí." } : {}),
    ya_escribiste_a_la_empresa: detalle.ya_escribiste_a_la_empresa || (detalle.empresa_id != null && postulados.empresas.has(detalle.empresa_id)),
    elegible_por_ubicacion: detalle.elegible_por_ubicacion,
    mensaje: { obligatorio: true, min_caracteres: MIN_CARACTERES_MENSAJE, nota: "Es el mensaje a los fundadores. Escrito por la persona tiene más respuesta." },
    preguntas,
    cupo_semanal: cupo,
  };
}

/** Respuesta en el formato de la web: texto, id de opción o lista de ids. */
function valorDeRespuesta(pregunta, respuesta) {
  const elegir = (r) => {
    const t = String(r).trim().toLowerCase();
    const opcion = pregunta.opciones.find((o) => String(o.id) === t || o.texto.trim().toLowerCase() === t);
    if (!opcion) throw new ErrorWaas(`"${r}" no es una opción de "${pregunta.pregunta}". Opciones: ${pregunta.opciones.map((o) => o.texto).join(" | ")}.`);
    return opcion.id;
  };
  if (pregunta.tipo === "single_choice") return elegir([respuesta].flat()[0]);
  if (pregunta.tipo === "multiple_choice") return [respuesta].flat().map(elegir);
  const texto = String([respuesta].flat().join(", ")).trim();
  if (pregunta.max_caracteres && texto.length > pregunta.max_caracteres) {
    throw new ErrorWaas(`La respuesta a "${pregunta.pregunta}" tiene ${texto.length} caracteres; el máximo es ${pregunta.max_caracteres}.`);
  }
  return texto;
}

/**
 * Envía la postulación: un mensaje a la empresa más las respuestas a sus preguntas.
 * Exige confirmacion = "POSTULAR <id>". Una sola petición, sin reintentos.
 */
export async function postularAOferta({ oferta, confirmacion, mensaje, respuestas = [], abierto_a_reubicacion = false }) {
  const id = idOferta(oferta);
  if (String(confirmacion || "").trim() !== `POSTULAR ${id}`) {
    return { estado: "requiere_confirmacion", mensaje: `Para enviar, el usuario debe aprobar la oferta y el mensaje; luego llama con confirmacion: "POSTULAR ${id}".` };
  }
  const texto = String(mensaje || "").trim();
  if (texto.length < MIN_CARACTERES_MENSAJE) {
    return { estado: "error", mensaje: `El mensaje a la empresa debe tener al menos ${MIN_CARACTERES_MENSAJE} caracteres (tiene ${texto.length}).` };
  }

  const formulario = await preguntasDePostulacion(id);
  if (!["listo", "revisar_externa"].includes(formulario.estado)) return formulario;

  const porId = new Map(respuestas.map((r) => [Number(r.pregunta_id), r.respuesta]));
  const desconocidas = [...porId.keys()].filter((k) => !formulario.preguntas.some((p) => p.pregunta_id === k));
  if (desconocidas.length) return { estado: "error", mensaje: `Estas preguntas no son de la oferta: ${desconocidas.join(", ")}.` };
  const faltan = formulario.preguntas.filter((p) => p.obligatoria && !String([porId.get(p.pregunta_id) ?? ""].flat().join("")).trim());
  if (faltan.length) return { estado: "faltan_respuestas", faltan: faltan.map((p) => ({ pregunta_id: p.pregunta_id, pregunta: p.pregunta })) };

  const respuestasWeb = {};
  for (const p of formulario.preguntas) {
    if (!porId.has(p.pregunta_id)) continue;
    respuestasWeb[p.pregunta_id] = valorDeRespuesta(p, porId.get(p.pregunta_id));
  }

  const detalle = await detalleDeOferta(id);
  const empresaId = detalle.empresa_id ?? (await idEmpresaPorBusqueda(detalle));
  if (empresaId == null) return { estado: "error", mensaje: "No pude identificar la empresa de la oferta; postula desde la web." };
  if (!detalle._csrf) return { estado: "error", mensaje: "La página no entregó el token de seguridad (CSRF); vuelve a iniciar sesión." };

  const r = await pedir("/apply", {
    metodo: "POST",
    auth: true,
    aceptar: "application/json",
    cabeceras: { "X-CSRF-Token": detalle._csrf, "X-Requested-With": "XMLHttpRequest", Referer: urlOferta(id) },
    cuerpo: {
      company_id: empresaId,
      job_id: id,
      message: texto,
      custom_question_answers: formulario.preguntas.length ? respuestasWeb : null,
      open_to_relocation: Boolean(abierto_a_reubicacion),
    },
  });
  const datos = parsearJson(r.texto);
  const base = { id, titulo: detalle.titulo, empresa: detalle.empresa, url: detalle.url };

  if (datos?.limit && datos?.reason) return { ...base, estado: "limite_semanal", mensaje: String(datos.reason) };
  if (datos?.success === false && datos?.question_id) {
    return { ...base, estado: "revisar_respuesta", pregunta_id: datos.question_id, mensaje: datos.error || "La empresa rechazó una respuesta." };
  }
  if (r.status === 403) return { ...base, estado: "bloqueado", mensaje: "Work at a Startup rechazó el envío (403). No se reintenta: revisa en la web." };
  if (r.status >= 200 && r.status < 300 && Array.isArray(datos?.job_ids)) {
    const enviada = datos.job_ids.map(Number).includes(id);
    return {
      ...base,
      estado: enviada ? "enviada" : "revisar",
      mensaje: enviada ? "Postulación enviada: la empresa recibió tu mensaje." : "La web respondió sin incluir esta oferta en tus postulaciones: revisa en mis-postulaciones antes de reintentar.",
      ofertas_postuladas_en_la_empresa: datos.job_ids,
    };
  }
  return { ...base, estado: "error", mensaje: `Respuesta inesperada (${r.status}). No se reintenta: revisa mis-postulaciones antes de volver a intentar.`, detalle: datos ?? r.texto.slice(0, 300) };
}

/** Si la página de la oferta no trae el id de la empresa, se busca en Algolia por su nombre. */
async function idEmpresaPorBusqueda(detalle) {
  const r = await consultarAlgolia({ consulta: detalle.empresa || "", porPagina: 20 });
  const hit = (r.hits || []).find((h) => Number(campo(h, "id", "objectID")) === detalle.id) || (r.hits || []).find((h) => (h.company?.slug || h.company_slug) === detalle.empresa_slug);
  return hit ? campo(hit.company || {}, "id") ?? campo(hit, "company_id") : null;
}

import { MIN_CARACTERES_MENSAJE } from "./config.js";
import { cargarPerfilMaestro } from "./perfil-maestro.js";
import { detalleDeOferta, preguntasDePostulacion } from "./ofertas.js";

const normalizar = (t) =>
  String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Catálogo genérico de tecnologías y sus variantes en las ofertas. Las que aparecen en el perfil
// maestro cuentan como propias; el resto, como ajenas.
const TECNOLOGIAS = {
  React: /\breact(\.?js)?\b(?!\s*native)/,
  "React Native": /react\s*native/,
  "Vue.js": /\bvue(\.?js)?\b/,
  Angular: /\bangular\b(?!\s*js)/,
  AngularJS: /angular\s*js/,
  "Next.js": /\bnext\.?js\b/,
  Svelte: /\bsvelte\b/,
  TypeScript: /typescript|\bts\b/,
  JavaScript: /javascript|\bjs\b|es6/,
  "Node.js": /\bnode(\.?js)?\b/,
  NestJS: /\bnest(\.?js)?\b/,
  Express: /\bexpress(\.?js)?\b/,
  PHP: /\bphp\b/,
  Laravel: /laravel/,
  Symfony: /symfony/,
  Yii: /\byii\b/,
  WordPress: /wordpress/,
  Expo: /\bexpo\b/,
  Java: /\bjava\b(?!\s*script)|\bspring\b/,
  ".NET / C#": /\.net\b|c#|csharp|asp\.net/,
  Python: /python|django|flask|fastapi/,
  Go: /\bgolang\b|\bgo\b(?=\s*(lang|developer|backend|services|,|\/|and\b))/,
  "Flutter / Dart": /flutter|\bdart\b/,
  Kotlin: /kotlin/,
  Swift: /\bswift(ui)?\b/,
  Ruby: /\bruby\b|\brails\b/,
  Elixir: /elixir|phoenix/,
  Scala: /\bscala\b/,
  Rust: /\brust\b/,
  "C / C++": /\bc\+\+|\bc\b(?=\s*(and|\/)\s*c\+\+)/,
  Solidity: /solidity/,
  MySQL: /mysql/,
  PostgreSQL: /postgres/,
  "SQL Server": /sql server|t-?sql|mssql/,
  Oracle: /\boracle\b/,
  MongoDB: /mongo/,
  Redis: /\bredis\b/,
  "APIs REST": /\brest(ful)?\b|\bapis?\b/,
  GraphQL: /graphql/,
  Docker: /docker/,
  Kubernetes: /kubernetes|\bk8s\b/,
  AWS: /\baws\b|amazon web services/,
  Azure: /\bazure\b/,
  GCP: /\bgcp\b|google cloud/,
  Terraform: /terraform/,
  Git: /\bgit\b|github|gitlab/,
  Linux: /linux/,
  "IA / LLM": /\bllms?\b|openai|anthropic|claude|cursor|\bmcp\b|\bgenai\b|generative ai/,
  "Machine learning": /machine learning|\bml\b|pytorch|tensorflow/,
  Scrum: /scrum|agile/,
};

// Aparecen en casi cualquier oferta técnica: no definen el eje del cargo.
const GENERICAS = ["APIs REST", "Git", "Scrum", "JavaScript", "IA / LLM"];

function terminosDelPerfil(perfil) {
  const terminos = [
    ...Object.values(perfil.aptitudes || {}).flat(),
    ...(perfil.experiencia || []).flatMap((e) => e.tecnologias || []),
    ...(perfil.habilidades_clave?.tecnicas || []),
  ];
  return [...new Set(terminos.filter(Boolean).map(String))];
}

function clasificarTecnologias(perfil) {
  const terminos = terminosDelPerfil(perfil).map(normalizar);
  const propias = {};
  const ajenas = {};
  for (const [nombre, re] of Object.entries(TECNOLOGIAS)) {
    const declarada = terminos.some((t) => t === normalizar(nombre) || re.test(t));
    (declarada ? propias : ajenas)[nombre] = re;
  }
  for (const t of terminos) {
    if (t.split(/\s+/).length > 2 || Object.values(propias).some((re) => re.test(t))) continue;
    propias[t] = new RegExp(`(^|[^a-z0-9])${escapar(t)}($|[^a-z0-9])`);
  }
  return { propias, ajenas };
}

/** "4+", "3", "2-3" → número de años (el menor del rango). */
const anios = (v) => {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** "$120K - $200K" → [120000, 200000] en la moneda indicada. */
function rangoSalario(texto) {
  const t = String(texto || "");
  const moneda = /€/.test(t) ? "EUR" : /£/.test(t) ? "GBP" : /\$/.test(t) ? "USD" : null;
  const nums = [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*([kKmM])?/g)].map((m) => parseFloat(m[1].replace(",", ".")) * (/k/i.test(m[2] || "") ? 1e3 : /m/i.test(m[2] || "") ? 1e6 : 1));
  if (!nums.length) return null;
  return { moneda, min: nums[0], max: nums[1] ?? nums[0] };
}

const PAIS_EN = { colombia: "colombia", mexico: "mexico", "estados unidos": "us", "ee. uu.": "us", espana: "spain", argentina: "argentina", chile: "chile", peru: "peru", ecuador: "ecuador", brasil: "brazil", canada: "canada" };
const PAIS_ISO = { colombia: "co", mexico: "mx", us: "us", spain: "es", argentina: "ar", chile: "cl", peru: "pe", ecuador: "ec", brazil: "br", canada: "ca", uruguay: "uy", "costa rica": "cr", venezuela: "ve", bolivia: "bo", paraguay: "py", guatemala: "gt", panama: "pa", "republica dominicana": "do" };
const REGIONES_ABIERTAS = /worldwide|anywhere|global|international|all countries/;
const REGIONES_LATAM = /latam|latin america|americas|south america|north america and latam|western hemisphere/;

function ubicacionPermitida(restriccion, pais) {
  const r = normalizar(restriccion);
  const p = normalizar(pais);
  const pEn = PAIS_EN[p] || p;
  if (!r || REGIONES_ABIERTAS.test(r)) return true;
  if (p && (r.includes(p) || r.includes(pEn))) return true;
  const iso = PAIS_ISO[pEn];
  if (iso && r.split(/[^a-z]+/).includes(iso)) return true;
  if (REGIONES_LATAM.test(r) && !["us", "canada", "spain"].includes(pEn)) return true;
  return false;
}

const INGLES_ALTO = /native english|fluent (in )?english|english fluency|excellent (written and verbal|verbal and written|communication)|exceptional (written|communication)|strong (written|verbal) communication/;
const NIVEL_INGLES_ALTO = /avanzado|nativo|bilingue|fluido|advanced|native|fluent|\bc1\b|\bc2\b/;

export async function evaluarEncaje(oferta) {
  const o = await detalleDeOferta(oferta);
  const perfil = cargarPerfilMaestro();
  const pref = perfil.preferencias || {};
  const dp = perfil.datos_personales || {};
  const titulo = normalizar(o.titulo);
  const texto = normalizar(`${o.titulo}\n${o.descripcion}\n${o.habilidades.join(", ")}`);

  const motivos = [];
  const avisos = [];
  let veredicto = "encaja";
  const bajar = (a) => {
    if (a === "no_encaja" || (a === "encaja_parcial" && veredicto === "encaja")) veredicto = a;
  };

  // Modalidad y ubicación
  const soloRemoto = /remot/.test(normalizar(pref.modalidad)) && !/hibrid|presencial|cualquiera/.test(normalizar(pref.modalidad));
  const reubica = pref.acepta_reubicacion === true;
  if (o.modalidad === "presencial" && !reubica) {
    bajar("no_encaja");
    motivos.push(`Es presencial en ${o.ubicacion || "una ciudad no indicada"}${soloRemoto ? "; solo buscas remoto" : "; no aceptas reubicarte"}.`);
  } else if (o.modalidad === "remoto o presencial" && soloRemoto) {
    bajar("encaja_parcial");
    motivos.push(`Ubicación "${o.ubicacion}": combina oficina y remoto; confirma que el remoto aplique para ti.`);
  }
  if (o.remoto_restringido_a && !ubicacionPermitida(o.remoto_restringido_a, dp.pais)) {
    bajar("no_encaja");
    motivos.push(`El remoto es solo para ${o.remoto_restringido_a.toUpperCase()} y vives en ${dp.pais || "otro país"}.`);
  }
  if (o.elegible_por_ubicacion === false) {
    bajar("encaja_parcial");
    motivos.push("Work at a Startup marca la oferta fuera de las preferencias de ubicación de tu cuenta.");
  }

  // Autorización de trabajo en EE. UU.
  const enEeuu = /^(us|usa|estados unidos|ee\.? ?uu\.?|united states)$/i.test(normalizar(dp.pais));
  const visaNoRequerida = /not required|will sponsor/i.test(o.visa || "");
  const exigeVisa = /visa only|exige/i.test(o.visa || "") || /must be (authorized|eligible) to work in the (us|united states)|us citizens? only|no (visa )?sponsorship/i.test(o.descripcion || "");
  if (!enEeuu && !visaNoRequerida && exigeVisa) {
    bajar("no_encaja");
    motivos.push(`Exige ser ciudadano o tener visa de EE. UU. (${o.visa || "según la descripción"}).`);
  }

  // Tipo de empleo y experiencia
  const misAnios = anios(perfil.anios_experiencia?.desarrollo_total ?? perfil.anios_experiencia?.total);
  if (/intern/i.test(o.tipo || "") && misAnios >= 2) {
    bajar("no_encaja");
    motivos.push("Es una pasantía (internship) y tienes experiencia profesional.");
  }
  if (/co-?founder/i.test(o.tipo || "")) {
    bajar("encaja_parcial");
    motivos.push("Busca un cofundador: implica equity y dedicación distintas a un empleo.");
  }
  const pedidos = anios(o.experiencia_minima);
  if (pedidos != null && misAnios != null && pedidos > misAnios) {
    bajar(pedidos - misAnios >= 2 ? "no_encaja" : "encaja_parcial");
    motivos.push(`Pide ${o.experiencia_minima} de experiencia y declaras ${perfil.anios_experiencia?.desarrollo_total ?? misAnios} años.`);
  }

  // Salario (solo si el perfil declara un mínimo en USD)
  const rango = rangoSalario(o.salario);
  const minimoUsd = pref.salario_minimo_usd_anual;
  if (rango && minimoUsd && rango.moneda === "USD") {
    if (rango.max < minimoUsd) {
      bajar("no_encaja");
      motivos.push(`Salario ${o.salario}, por debajo de tu mínimo de USD ${minimoUsd.toLocaleString("en-US")} al año.`);
    } else if (rango.min < minimoUsd) {
      bajar("encaja_parcial");
      motivos.push(`Salario ${o.salario}: el rango toca tu mínimo de USD ${minimoUsd.toLocaleString("en-US")}.`);
    }
  } else if (o.salario && !minimoUsd) {
    avisos.push(`Salario ${o.salario}. Tu perfil maestro no declara un mínimo en USD (preferencias.salario_minimo_usd_anual), así que no lo evalúo.`);
  }

  // Stack
  const { propias, ajenas } = clasificarTecnologias(perfil);
  const coincidencias = Object.entries(propias).filter(([, re]) => re.test(texto)).map(([n]) => n);
  const perfilTecnico = Object.keys(propias).filter((n) => n in TECNOLOGIAS && !GENERICAS.includes(n)).length >= 3;
  if (!perfilTecnico && Object.keys(propias).length && !coincidencias.length) {
    bajar("encaja_parcial");
    motivos.push("No encontré en la oferta ninguna de las habilidades o herramientas de tu perfil.");
  }
  if (perfilTecnico) {
    const ajenasTitulo = Object.entries(ajenas).filter(([, re]) => re.test(titulo)).map(([n]) => n);
    const habilidades = normalizar(o.habilidades.join(", "));
    const ajenasClave = Object.entries(ajenas).filter(([, re]) => re.test(habilidades)).map(([n]) => n);
    const ajenasTexto = Object.entries(ajenas).filter(([, re]) => re.test(texto)).map(([n]) => n);
    const propiasTitulo = Object.entries(propias).filter(([n, re]) => !GENERICAS.includes(n) && re.test(titulo)).map(([n]) => n);
    if (ajenasTitulo.length && !propiasTitulo.length) {
      bajar("no_encaja");
      motivos.push(`El cargo se centra en ${ajenasTitulo.join(", ")}, que no ${ajenasTitulo.length > 1 ? "están" : "está"} en tu perfil.`);
    } else if (ajenasClave.length) {
      bajar("encaja_parcial");
      motivos.push(`Las habilidades de la oferta incluyen ${ajenasClave.join(", ")}, que no ${ajenasClave.length > 1 ? "están" : "está"} en tu perfil.`);
    } else if (ajenasTexto.length) {
      bajar("encaja_parcial");
      motivos.push(`La descripción menciona también ${ajenasTexto.join(", ")}, que no ${ajenasTexto.length > 1 ? "están" : "está"} en tu perfil.`);
    }
    if (!coincidencias.filter((c) => !GENERICAS.includes(c)).length) {
      bajar("encaja_parcial");
      motivos.push("No encontré tecnologías principales de tu perfil en la oferta.");
    }
  }

  // Inglés: la plataforma y los procesos son en inglés.
  const ingles = (perfil.idiomas || []).find((i) => /ingl|english/i.test(i.idioma || ""));
  if (!ingles) {
    bajar("encaja_parcial");
    motivos.push("El proceso es en inglés y tu perfil maestro no declara inglés.");
  } else if (!NIVEL_INGLES_ALTO.test(normalizar(ingles.nivel))) {
    if (INGLES_ALTO.test(texto)) {
      bajar("encaja_parcial");
      motivos.push(`Pide inglés fluido o comunicación excelente; tu nivel declarado es ${ingles.nivel}.`);
    } else {
      avisos.push(`El proceso es en inglés; tu nivel declarado es ${ingles.nivel}.`);
    }
  }

  return {
    id: o.id,
    titulo: o.titulo,
    empresa: o.empresa,
    veredicto,
    motivos,
    avisos,
    coincidencias,
    ubicacion: o.ubicacion,
    modalidad: o.modalidad,
    salario: o.salario,
    experiencia_minima: o.experiencia_minima,
    visa: o.visa,
    tipo: o.tipo,
    url: o.url,
  };
}

/* ---------------------------------------------------------------- respuestas */

const PALABRAS_VACIAS = new Set("the a an and or of to in on for with you your do does have has are is what how many much which any".split(" "));
const palabras = (t) => normalizar(t).split(/[^a-z0-9.+#]+/).filter((p) => p.length > 1 && !PALABRAS_VACIAS.has(p));

/** Rango en meses de opciones como "1-2 years", "3+ years", "Less than 1 year" o "None". */
function rangoMeses(texto) {
  const t = normalizar(texto);
  if (/^(no|none)\b|no experience|^0$/.test(t)) return [0, 0];
  const factor = (u) => (/^(mes|month)/.test(u) ? 1 : 12);
  const par = t.match(/(\d+(?:\.\d+)?)\s*(?:-|to|a|y)\s*(\d+(?:\.\d+)?)\s*(year|yr|ano|month|mes)/);
  if (par) return [parseFloat(par[1]) * factor(par[3]), parseFloat(par[2]) * factor(par[3])];
  const m = t.match(/(\d+(?:\.\d+)?)\s*(\+)?\s*(year|yr|ano|month|mes)?/);
  if (!m) return null;
  const n = parseFloat(m[1]) * factor(m[3] || "year");
  if (m[2] || /more than|over|at least|mas de/.test(t)) return [n, Infinity];
  if (/less than|under|menos de/.test(t)) return [0, n];
  return [n, n];
}

function opcionPorMeses(opciones, meses) {
  const contienen = opciones.map((o) => ({ o, r: rangoMeses(o.texto) })).filter(({ r }) => r && meses >= r[0] && meses <= r[1]);
  contienen.sort((a, b) => b.r[0] - a.r[0]);
  return contienen[0]?.o || null;
}

const esSiNo = (opciones) => opciones.some((o) => /^yes\b/i.test(o.texto.trim())) && opciones.some((o) => /^no\b/i.test(o.texto.trim()));
const opcionSiNo = (opciones, si) => opciones.find((o) => (si ? /^yes\b/i : /^no\b/i).test(o.texto.trim()));

function proponerUna(p, perfil, tecnologias) {
  const q = normalizar(p.pregunta);
  const dp = perfil.datos_personales || {};
  const pref = perfil.preferencias || {};
  const tiempos = perfil.anios_experiencia || {};
  const opciones = p.opciones || [];
  const siNo = esSiNo(opciones);
  const r = (respuesta, clasificacion, fuente) => ({ respuesta, clasificacion, fuente });

  if (p.tipo === "url" || /linkedin|github|portfolio|personal (site|website)|website/.test(q)) {
    if (/linkedin/.test(q) && dp.linkedin) return r(dp.linkedin, "respaldada", "datos_personales.linkedin");
    if (/github/.test(q) && dp.github) return r(dp.github, "respaldada", "datos_personales.github");
    if (/portfolio|site|website/.test(q) && dp.portafolio) return r(dp.portafolio, "respaldada", "datos_personales.portafolio");
    if (/resume|cv\b/.test(q)) return r("", "sin_respaldo", "El perfil maestro no tiene una URL pública de tu CV: pídela al usuario.");
    if (p.tipo === "url") return r(dp.linkedin || "", dp.linkedin ? "requiere_confirmacion" : "sin_respaldo", "datos_personales.linkedin (confirma que es lo que pide)");
  }
  if (/salary|compensation|expected (pay|comp)|rate|per hour|hourly|usd|pay expectation/.test(q)) {
    if (pref.tarifa_minima_usd_hora && /hour|rate/.test(q)) return r(`USD ${pref.tarifa_minima_usd_hora}/hour`, "requiere_confirmacion", "preferencias.tarifa_minima_usd_hora");
    if (pref.salario_minimo_usd_anual) return r(`USD ${pref.salario_minimo_usd_anual.toLocaleString("en-US")}/year`, "requiere_confirmacion", "preferencias.salario_minimo_usd_anual");
    return r("", "sin_respaldo", "El perfil maestro no tiene expectativa salarial en USD: pregúntala al usuario.");
  }
  if (/english/.test(q)) {
    const ingles = (perfil.idiomas || []).find((i) => /ingl|english/i.test(i.idioma || ""));
    if (!ingles) return r("", "sin_respaldo", "El perfil maestro no declara inglés.");
    if (siNo) return r("", "requiere_confirmacion", `Nivel declarado: ${ingles.nivel}. Decide con el usuario si cumple lo que pide.`);
    return r(`${ingles.nivel === "Intermedio" ? "Intermediate" : ingles.nivel}${ingles.nota ? ` (${ingles.nota})` : ""}`, "requiere_confirmacion", "idiomas del perfil maestro (traduce la nota si está en español)");
  }
  if (/relocat/.test(q) && typeof pref.acepta_reubicacion === "boolean") {
    return siNo ? r(opcionSiNo(opciones, pref.acepta_reubicacion)?.texto || "", "respaldada", "preferencias.acepta_reubicacion") : r(pref.acepta_reubicacion ? "Yes, I'm open to relocating." : "No, I'm looking for remote work.", "respaldada", "preferencias.acepta_reubicacion");
  }
  if (/visa|sponsor|authori[sz]|work permit|legally|citizen/.test(q)) {
    return r("", "sin_respaldo", "Autorización de trabajo o visa: no está en el perfil maestro y no se supone. Pregúntale al usuario.");
  }
  if (/where.*(based|located|live)|location|located|time ?zone|city|country/.test(q)) {
    const lugar = [dp.ciudad, dp.pais].filter(Boolean).join(", ");
    return r(lugar ? `${lugar}${dp.zona_horaria ? ` (${dp.zona_horaria})` : ""}` : "", lugar ? "respaldada" : "sin_respaldo", "datos_personales (ciudad, país y zona horaria)");
  }
  if (/notice|start date|when can you start|earliest/.test(q)) {
    return r("", "sin_respaldo", "El perfil maestro no tiene preaviso ni fecha de inicio: pregúntale al usuario.");
  }
  if (/\bai\b|copilot|cursor|claude|llm|chatgpt|coding assistant|agent/.test(q) && (perfil.aptitudes?.ia || []).length) {
    const ia = perfil.aptitudes.ia;
    return siNo ? r(opcionSiNo(opciones, true)?.texto || "", "respaldada", `aptitudes.ia: ${ia.join(", ")}`) : r(`Yes, daily: ${ia.join(", ")}.`, "requiere_confirmacion", `aptitudes.ia (${ia.join(", ")}); ajusta el detalle con el usuario`);
  }
  if (/experience|years|yrs|worked with|familiar/.test(q)) {
    const enPregunta = Object.entries(TECNOLOGIAS).filter(([n, re]) => !GENERICAS.includes(n) && re.test(q)).map(([n]) => n);
    const propias = enPregunta.filter((n) => n in tecnologias.propias);
    const ajenas = enPregunta.filter((n) => !(n in tecnologias.propias));
    const total = tiempos.desarrollo_total ?? tiempos.total;
    const especifica = Object.entries(tiempos).find(([clave]) => !["total", "desarrollo_total"].includes(clave) && clave.split("_").some((parte) => parte.length > 1 && new RegExp(`\\b${escapar(parte)}\\b`).test(q)));
    const valor = especifica?.[1] ?? total;
    const fuente = especifica ? `anios_experiencia.${especifica[0]}` : "anios_experiencia (total)";
    if (ajenas.length && !propias.length) return r(siNo ? opcionSiNo(opciones, false)?.texto || "" : "", "sin_respaldo", `El perfil no declara ${ajenas.join(", ")}: pregúntale al usuario, no lo supongas.`);
    if (valor === undefined) return r("", "sin_respaldo", "El perfil maestro no tiene anios_experiencia.");
    const nota = ajenas.length ? ` También pregunta por ${ajenas.join(", ")}, que el perfil no declara.` : "";
    const confiable = Boolean(especifica) || (!enPregunta.length && /total|overall|professional|software/.test(q));
    const clas = confiable && !nota ? "respaldada" : "requiere_confirmacion";
    if (opciones.length && !siNo) return r(opcionPorMeses(opciones, (anios(valor) || 0) * 12)?.texto || "", clas, `${fuente} (${valor} años).${nota}`);
    if (siNo) return r(opcionSiNo(opciones, true)?.texto || "", propias.length || especifica ? clas : "requiere_confirmacion", `${fuente} (${valor} años).${nota}`);
    return r(`${valor} years${propias.length ? ` with ${propias.join(" and ")}` : " of professional software development"}.`, clas, `${fuente}.${nota}`);
  }
  return r("", "sin_respaldo", "No hay datos en el perfil maestro para responderla: pregúntale al usuario.");
}

/** Borrador del mensaje a la empresa a partir del perfil. El usuario debe personalizarlo. */
function borradorDeMensaje(perfil, evaluacion) {
  const dp = perfil.datos_personales || {};
  const titular = String(perfil.titular?.en || "").split("|")[0].trim();
  const resumen = String(perfil.resumen?.en || "").split(/(?<=\.)\s/)[0];
  const stack = evaluacion.coincidencias.filter((c) => !GENERICAS.includes(c)).slice(0, 5);
  const partes = [
    `Hi! I'm ${dp.nombre?.split(" ").slice(0, 2).join(" ") || "a software engineer"}${titular ? `, ${titular}` : ""}${dp.ciudad ? ` based in ${dp.ciudad}, ${dp.pais}` : ""}.`,
    resumen,
    stack.length ? `My day-to-day stack matches what you're using: ${stack.join(", ")}.` : "",
    `[Add one or two lines on why ${evaluacion.empresa} and this role interest you.]`,
    [dp.linkedin, dp.github, dp.portafolio].filter(Boolean).join(" · "),
  ].filter(Boolean);
  return partes.join("\n\n");
}

/** Propone el mensaje y las respuestas a partir del perfil maestro. Nunca envía nada. */
export async function proponerRespuestas(oferta) {
  const evaluacion = await evaluarEncaje(oferta);
  const formulario = await preguntasDePostulacion(evaluacion.id);
  if (!["listo", "revisar_externa"].includes(formulario.estado)) return { ...formulario, veredicto: evaluacion.veredicto, motivos: evaluacion.motivos };
  const perfil = cargarPerfilMaestro();
  const tecnologias = clasificarTecnologias(perfil);

  const respuestas = formulario.preguntas.map((p) => {
    const propuesta = proponerUna(p, perfil, tecnologias);
    let respuesta = propuesta.respuesta;
    if (p.max_caracteres && respuesta.length > p.max_caracteres) respuesta = respuesta.slice(0, p.max_caracteres - 1).trimEnd() + "…";
    if (p.opciones && respuesta && !p.opciones.some((o) => o.texto === respuesta)) {
      respuesta = "";
      propuesta.clasificacion = "requiere_confirmacion";
    }
    return {
      pregunta_id: p.pregunta_id,
      pregunta: p.pregunta,
      tipo: p.tipo,
      obligatoria: p.obligatoria,
      ...(p.opciones ? { opciones: p.opciones.map((o) => o.texto) } : {}),
      ...(p.max_caracteres ? { max_caracteres: p.max_caracteres } : {}),
      respuesta,
      clasificacion: propuesta.clasificacion,
      fuente: propuesta.fuente,
    };
  });

  return {
    id: evaluacion.id,
    titulo: evaluacion.titulo,
    empresa: evaluacion.empresa,
    veredicto: evaluacion.veredicto,
    motivos: evaluacion.motivos,
    avisos: evaluacion.avisos,
    estado_formulario: formulario.estado,
    ...(formulario.aviso_externa ? { aviso_externa: formulario.aviso_externa } : {}),
    ya_escribiste_a_la_empresa: formulario.ya_escribiste_a_la_empresa,
    mensaje: {
      borrador: borradorDeMensaje(perfil, evaluacion),
      min_caracteres: MIN_CARACTERES_MENSAJE,
      clasificacion: "requiere_confirmacion",
      nota: "Borrador en inglés a partir del perfil. El usuario debe completar el porqué de la empresa y aprobarlo; los mensajes escritos por la persona reciben más respuesta.",
    },
    respuestas,
    cupo_semanal: formulario.cupo_semanal,
    aviso:
      "Clasificación: respaldada (sale del perfil maestro), requiere_confirmacion (el usuario debe validarla) o sin_respaldo (falta el dato: pregúntalo, no lo inventes). Nada se envía sin la confirmación del usuario.",
  };
}
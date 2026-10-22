import { BASE } from "./config.js";
import { pagina, parsearJson } from "./http.js";
import { cargarPerfilMaestro } from "./perfil-maestro.js";

const normalizar = (t) =>
  String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .trim();

const mes = (fecha) => (fecha ? String(fecha).slice(0, 7) : null);

/** Catálogo de habilidades de la web (id → nombre), publicado en window.JOBS_GLOBALS. */
function catalogoHabilidades(html) {
  const i = html.indexOf('"ENG_SKILLS":');
  if (i < 0) return new Map();
  const inicio = html.indexOf("[", i);
  let profundidad = 0;
  for (let j = inicio; j < html.length; j++) {
    if (html[j] === "[") profundidad++;
    else if (html[j] === "]" && --profundidad === 0) {
      const lista = parsearJson(html.slice(inicio, j + 1)) || [];
      return new Map(lista.map((s) => [s.value, s.label]));
    }
  }
  return new Map();
}

async function perfilWeb() {
  const { datos, html } = await pagina("/application/experience", { auth: true });
  const p = datos?.props?.sectionAppProps;
  if (!p?.data) throw new Error("No encontré tu perfil de candidato en la página /application.");
  return { p, habilidades: catalogoHabilidades(html) };
}

export async function verMiPerfil(fuente) {
  const { p, habilidades } = fuente || (await perfilWeb());
  const d = p.data;
  return {
    nombre: p.full_name,
    estado: p.state,
    visible_para_empresas: p.shared,
    perfil_minimo_completo: p.minimally_complete,
    modo_de_busqueda: d.share,
    secciones: (p.sectionInfo || []).map((s) => ({ seccion: s.title, estado: s.status })),
    frase_corta: d.short_phrase,
    que_buscas: d.looking_for,
    proyecto_destacado: d.proud_project ? `${String(d.proud_project).slice(0, 300)}…` : null,
    rol: d.role,
    especialidades: d.eng_type,
    tipos_de_empleo: d.job_type,
    anios_experiencia: d.experienceDisplay || d.experience,
    ciudad: d.city_current,
    remoto: d.remote,
    reubicacion: d.relocate,
    reubicacion_a: d.relocate_to_preset,
    autorizado_en_eeuu: d.us_authorized,
    necesita_visa_eeuu: d.us_visa_sponsorship,
    tamanos_de_empresa: (d.company_sizes || []).map((c) => `${c.value} (${c.rating})`),
    habilidades: (d.top_skills || []).map((s) => `${habilidades.get(s.value) || s.value} (${s.rating})`),
    experiencia: (d.positions || []).map((x) => ({
      empresa: x.employer?.name || x.employer_name_other,
      cargo: String(x.title || "").trim(),
      inicio: mes(x.start_date),
      fin: x.is_current ? null : mes(x.end_date),
      ubicacion: x.location || null,
    })),
    formacion: (d.educations || []).map((e) => ({
      institucion: e.school?.name || e.school_name_other,
      titulo: [e.degree, e.field_of_study].filter(Boolean).join(" – "),
      inicio: mes(e.start_date),
      fin: mes(e.end_date),
    })),
    enlaces: { linkedin: d.linkedin || null, github: d.github || null },
    cv: p.resume ? { estado: p.resume.status, actualizado: mes(p.resume.updated_at) } : null,
    editar_en: `${BASE}/application`,
  };
}

const parecido = (a, b) => {
  const x = normalizar(a);
  const y = normalizar(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const px = new Set(x.split(" ").filter((p) => p.length > 3));
  return y.split(" ").filter((p) => p.length > 3 && px.has(p)).length >= 2;
};

/** Diferencias entre el perfil de candidato de la web y el perfil maestro. Solo lectura. */
export async function compararPerfil() {
  const fuente = await perfilWeb();
  const web = await verMiPerfil(fuente);
  const { p } = fuente;
  const perfil = cargarPerfilMaestro();
  const dp = perfil.datos_personales || {};
  const pref = perfil.preferencias || {};
  const corregir = [];

  const anios = parseFloat(String(perfil.anios_experiencia?.desarrollo_total ?? "")) || null;
  const aniosWeb = parseFloat(String(p.data.experience ?? "")) || null;
  if (anios && aniosWeb && anios !== aniosWeb) corregir.push({ campo: "Años de experiencia", web: web.anios_experiencia, perfil_maestro: `${perfil.anios_experiencia.desarrollo_total} años de desarrollo` });

  if (dp.ciudad && !normalizar(web.ciudad).includes(normalizar(dp.ciudad))) corregir.push({ campo: "Ciudad", web: web.ciudad, perfil_maestro: `${dp.ciudad}, ${dp.pais}` });

  if (typeof pref.acepta_reubicacion === "boolean" && web.reubicacion && (web.reubicacion === "yes") !== pref.acepta_reubicacion) {
    corregir.push({ campo: "Reubicación", web: `${web.reubicacion}${web.reubicacion_a?.length ? ` (${web.reubicacion_a.join(", ")})` : ""}`, perfil_maestro: pref.acepta_reubicacion ? "acepta reubicarse" : "no acepta reubicarse" });
  }
  const soloRemoto = /remot/.test(normalizar(pref.modalidad)) && !/hibrid|presencial|cualquiera/.test(normalizar(pref.modalidad));
  if (soloRemoto && web.remoto && web.remoto !== "only") corregir.push({ campo: "Remoto", web: web.remoto, perfil_maestro: `${pref.modalidad} (en la web: "only")` });

  for (const [red, clave] of [["linkedin", "linkedin"], ["github", "github"]]) {
    const a = decodeURIComponent(String(web.enlaces[red] || "")).replace(/\/+$/, "").toLowerCase();
    const b = decodeURIComponent(String(dp[clave] || "")).replace(/\/+$/, "").toLowerCase();
    if (b && a !== b) corregir.push({ campo: red, web: web.enlaces[red] || "(vacío)", perfil_maestro: dp[clave] });
  }

  const experiencia = [];
  const usadas = new Set();
  const buscar = (lista, ...criterios) => {
    for (const criterio of criterios) {
      const hallada = lista.find((w) => !usadas.has(w) && criterio(w));
      if (hallada) return usadas.add(hallada), hallada;
    }
    return null;
  };
  for (const e of perfil.experiencia || []) {
    const enWeb = buscar(
      web.experiencia,
      (w) => parecido(w.empresa, e.empresa),
      (w) => normalizar(w.cargo) === normalizar(e.cargo) && w.inicio === mes(e.inicio),
      (w) => w.inicio === mes(e.inicio)
    );
    if (!enWeb) {
      experiencia.push({ falta_en_la_web: `${e.cargo} – ${e.empresa} (${e.inicio} a ${e.fin || "actual"})` });
      continue;
    }
    const diferencias = [];
    if (!parecido(enWeb.empresa, e.empresa)) diferencias.push(`empresa "${enWeb.empresa}" en la web, "${e.empresa}" en el perfil`);
    if (mes(e.inicio) !== enWeb.inicio) diferencias.push(`inicio ${enWeb.inicio} en la web, ${e.inicio} en el perfil`);
    if ((e.fin ? mes(e.fin) : null) !== enWeb.fin) diferencias.push(`fin ${enWeb.fin || "actual"} en la web, ${e.fin || "actual"} en el perfil`);
    if (!enWeb.empresa) diferencias.push("la web no tiene el nombre de la empresa");
    if (diferencias.length) experiencia.push({ experiencia: `${e.cargo} – ${e.empresa}`, diferencias });
  }

  const formacion = [];
  for (const f of (perfil.formacion || []).filter((x) => x.mostrar_en_cv !== false)) {
    const enWeb = buscar(
      web.formacion,
      (w) => parecido(w.institucion, f.institucion),
      (w) => parecido(w.titulo, f.titulo_en || f.titulo_es)
    );
    if (!enWeb) {
      formacion.push({ falta_en_la_web: `${f.titulo_en || f.titulo_es} – ${f.institucion}` });
      continue;
    }
    const diferencias = [];
    const distinta = (a, b) => a && b && !String(b).startsWith(String(a)) && !String(a).startsWith(String(b));
    if (distinta(f.inicio, enWeb.inicio)) diferencias.push(`inicio ${enWeb.inicio} en la web, ${f.inicio} en el perfil`);
    if (distinta(f.fin, enWeb.fin)) diferencias.push(`fin ${enWeb.fin} en la web, ${f.fin} en el perfil`);
    if (diferencias.length) formacion.push({ estudio: `${f.titulo_en || f.titulo_es} – ${f.institucion}`, en_la_web: `${enWeb.titulo} – ${enWeb.institucion}`, diferencias });
  }

  const declaradas = new Set([...Object.values(perfil.aptitudes || {}).flat(), ...(perfil.habilidades_clave?.tecnicas || [])].flatMap((t) => String(t).split(/\s*\/\s*/)).map(normalizar));
  const habilidadesWeb = web.habilidades.map((h) => h.replace(/\s*\(.*\)$/, ""));
  const noDeclaradas = habilidadesWeb.filter((h) => ![...declaradas].some((d) => d && (d === normalizar(h) || d.includes(normalizar(h)) || normalizar(h).includes(d))));

  return {
    corregir_en_la_web: corregir,
    experiencia,
    formacion,
    habilidades: {
      en_la_web: habilidadesWeb,
      ...(noDeclaradas.length ? { no_estan_en_el_perfil_maestro: noDeclaradas, nota: "Revisa si las usas de verdad; si no, quítalas de la web (no inventes habilidades)." } : {}),
    },
    autorizacion_eeuu: { autorizado: web.autorizado_en_eeuu, necesita_visa: web.necesita_visa_eeuu },
    editar_en: `${BASE}/application`,
    nota: "Este MCP no modifica tu perfil de la web: corrige estos puntos en /application.",
  };
}

# mcp-workatastartup

Servidor MCP para [Work at a Startup](https://www.workatastartup.com), la bolsa de empleo de las startups de Y Combinator. Con él puedes:

- Buscar ofertas con filtros, ver el detalle de la oferta y de la startup, y evaluar si encajan con tu perfil.
- Preparar el mensaje a los fundadores y las respuestas a sus preguntas, y postular una oferta a la vez con tu confirmación explícita.
- Ver tus postulaciones y cuántas te quedan esta semana.

Funciona con cualquier cuenta de candidato de Work at a Startup. Ningún dato personal está escrito en el código: todo sale del perfil maestro.

> **Proyecto no oficial.** No está afiliado a Y Combinator ni a Work at a Startup ni respaldado por ellos. Usa las mismas peticiones que hace su web, que pueden cambiar sin aviso y romper alguna herramienta. Cada quien es responsable de usarlo de acuerdo con sus términos de uso. Las postulaciones son reales, gastan tu cupo semanal y no se pueden deshacer.

## Instalación

Requisitos: Node.js 20 o superior y un navegador basado en Chromium (Chrome, Edge, Brave o Chromium), que solo se usa para iniciar sesión.

```bash
git clone https://github.com/Jucamhc/mcp-workatastartup.git
cd mcp-workatastartup
npm install
```

Es autónomo: incluye el estándar del perfil maestro (`src/perfil-maestro.js`, `perfil-maestro.schema.json` y [`PERFIL-MAESTRO.md`](PERFIL-MAESTRO.md)). Los demás MCP de empleo traen la misma copia, así que todos comparten el mismo perfil.

Regístralo en tu cliente MCP (por ejemplo `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "workatastartup": {
      "command": "node",
      "args": ["/ruta/a/mcp-workatastartup/src/index.js"],
      "env": { "PERFIL_MAESTRO": "/ruta/a/mi/perfil-maestro.json" }
    }
  }
}
```

### Variables de entorno (todas opcionales)

| Variable | Por defecto | Para qué |
|---|---|---|
| `PERFIL_MAESTRO` | `~/.perfil-maestro/perfil-maestro.json` | Ruta de tu perfil maestro (la misma para todos los MCP) |
| `WAAS_DATA_DIR` | `~/.workatastartup` | Sesión (cookies) y perfil del navegador |
| `CHROME_PATH` | se detecta | Ruta del ejecutable del navegador si no está en la ubicación habitual |

La sesión queda en `~/.workatastartup/`, fuera de carpetas sincronizadas. El MCP nunca muestra cookies ni credenciales.

## Primeros pasos

1. `iniciar-sesion`: abre el navegador en el login de Y Combinator. Entras a mano (enlace por correo, contraseña o Google) y el MCP guarda la sesión. Como el navegador del MCP la conserva, volver a llamar a `iniciar-sesion` la renueva sola en segundos.
2. Completa tu perfil de candidato en la web (`/application`): sin perfil completo y compartido, Work at a Startup no deja postular.
3. Si aún no tienes perfil maestro, `construir-perfil-maestro` te pide una fuente (la URL de tu LinkedIn o tu CV en PDF) y `guardar-perfil-maestro` lo valida y lo guarda.

## Flujo de postulación

1. `buscar-ofertas` → `detalle-de-oferta` o `detalle-de-empresa` → `evaluar-encaje`.
2. `preguntas-de-postulacion`: si ya te postulaste, el cupo de la semana, el mensaje obligatorio y las preguntas de la empresa. No envía nada.
3. `proponer-respuestas`: borrador del mensaje (en inglés) y respuestas a partir del perfil maestro, clasificadas en `respaldada`, `requiere_confirmacion` o `sin_respaldo`. Nunca inventa datos.
4. El usuario revisa, completa el porqué de la empresa y aprueba.
5. `postular-a-oferta` con `confirmacion: "POSTULAR <id>"`, el mensaje y las respuestas aprobadas. Una oferta a la vez y sin reintentos automáticos.

Resultados de `postular-a-oferta`: `enviada`, `ya_postulado`, `limite_semanal`, `revisar_respuesta` (la empresa rechazó una respuesta), `faltan_respuestas`, `bloqueado` (403), `sesion_expirada`, `revisar` o `error`.

## Herramientas

| Herramienta | Sesión | Qué hace |
|---|---|---|
| `estado-de-sesion` | — | Si hay sesión y el cupo semanal |
| `iniciar-sesion` | — | Login manual en el navegador |
| `buscar-ofertas` | opcional | Con sesión, todas las ofertas con filtros; sin sesión, solo las ~30 más recientes |
| `detalle-de-oferta` | opcional | Oferta completa |
| `detalle-de-empresa` | opcional | Startup y sus ofertas abiertas |
| `evaluar-encaje` | opcional | `encaja`, `encaja_parcial` o `no_encaja`, con motivos y avisos |
| `preguntas-de-postulacion` | sí | Formulario de la oferta |
| `proponer-respuestas` | sí | Borrador del mensaje y respuestas |
| `postular-a-oferta` | sí | Envía la postulación |
| `mis-postulaciones` | sí | Empresas a las que te postulaste y cupo semanal |
| `construir-perfil-maestro`, `guardar-perfil-maestro`, `ver-perfil-maestro` | — | Estándar compartido del perfil maestro |

### Filtros de búsqueda

`palabra` (en inglés), `rol` (`eng`, `design`, `product`…), `especialidad` (`fs` full stack, `fe`, `be`, `android`, `ios`, `ai`, `ml`, `devops`, `qa`…), `remoto` (`remoto`, `solo_remoto`, `presencial`, `todas`), `tipo` (`fulltime`, `contract`, `intern`), `sin_visa_eeuu`, `experiencia_max`, `con_salario`, `pagina`, `por_pagina`.

Por defecto, `remoto` sale de `preferencias.modalidad` y `sin_visa_eeuu` es `true` si `datos_personales.pais` no es EE. UU.

## Perfil maestro

Usa los mismos campos que los demás MCP. Para esta plataforma conviene declarar, en `preferencias`, campos opcionales que el esquema admite:

- `salario_minimo_usd_anual`: mínimo anual en USD para evaluar el salario de las ofertas.
- `tarifa_minima_usd_hora`: tarifa por hora en USD para contratos.

Sin ellos, `evaluar-encaje` muestra el salario sin juzgarlo y `proponer-respuestas` deja las preguntas de salario como `sin_respaldo`.

### Qué tiene en cuenta el encaje

- **Ubicación**: casi todas las ofertas son en EE. UU. "Remote (US)" significa remoto solo desde EE. UU.; si vives en otro país, la oferta queda `no_encaja`.
- **Visa**: "US citizen/visa only" descarta la oferta si no vives en EE. UU.
- **Experiencia mínima** frente a `anios_experiencia.desarrollo_total`, **tipo** (pasantía, cofundador), **tecnologías** e **inglés**: los procesos son en inglés.

## Referencia técnica

- Las páginas son Rails + Inertia: los datos vienen como JSON en el atributo `data-page`.
- Búsqueda: Algolia (app `45BWZJ1SGC`, índice `WaaSPublicCompanyJob_created_at_desc_production`). La llave sale de `window.AlgoliaOpts` en `/jobs`; la anónima no devuelve ofertas, la de la sesión sí. Filtros: `role`, `eng_type`, `remote` (`yes`, `only`, `no`), `job_type`, `us_visa_required` (`none`, `possible`, `yes`), `min_experience`, `has_salary`.
- Detalle: `GET /jobs/<id>` y `GET /companies/<slug>` (públicos).
- Preguntas: `GET /jobs/<id>/custom_questions.json`. Tipos `text` (250), `long_text` (5000), `url` (2000), `single_choice` (id de opción) y `multiple_choice` (lista de ids).
- Postulación: `POST /apply` con `X-CSRF-Token` y `{ company_id, job_id, message, custom_question_answers, open_to_relocation }`. El mensaje es obligatorio (mínimo 50 caracteres). Respuestas: `{ job_ids, company_id }`, `{ success: false, question_id, error }` o `{ limit, reason }`.
- Postulaciones: `GET /api/conversations` (`has_applied`, `referenced_job_ids`, mensajes con `from_candidate` y `created_at`). Límite: 10 postulaciones por semana, desde el lunes.

## Pendiente de verificar

- Con una cuenta real: formato de los resultados de Algolia con sesión, `company.id` en la página de la oferta con sesión, y la respuesta de `POST /apply`.
- Leer y comparar el perfil de candidato de la web (`/application`) con el perfil maestro.

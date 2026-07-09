/* ================================================================
   EDURESPONSE — app.js
   Lectura automática de hojas de respuesta SIMCE / PAES con Gemini
   ================================================================ */

'use strict';

/* ──────────────────────────────────────────────────────────────
   CONFIG
   ────────────────────────────────────────────────────────────── */
const DEFAULT_API_KEY = ''; // Ingresa tu API key en ⚙️ Config

const CONFIG = {
  get GEMINI_API_KEY() { return localStorage.getItem('edu_api_key') || DEFAULT_API_KEY; },
  AI_PROVIDER    : 'openai',
  OPENAI_MODEL   : 'gpt-4o',      // Cambiado a gpt-4o para máxima precisión de visión
  PDF_SCALE      : 3.0,          // Escala subida a 3.0 para una calidad de imagen ultra-definida
  REQ_DELAY_MS   : 4200,         // ms between Gemini calls (stay < 15 RPM)
  MAX_PAGES      : 40,

  SIMCE: {
    numQuestions : 45,
    options      : ['A','B','C','D'],
    courses      : ['2° Básico','4° Básico','6° Básico','8° Básico','2° Medio'],
    subjects     : ['Matemática','Lenguaje y Comunicación','Historia y Geografía','Ciencias Naturales','Inglés'],
  },
  PAES: {
    numQuestions : 75,
    options      : ['A','B','C','D','E'],
    courses      : ['3° Medio','4° Medio'],
    subjects     : ['Matemática','Lenguaje y Comunicación','Historia y Ciencias Sociales','Física','Biología','Química'],
  },
  GLOBAL: {
    numOptions   : [20, 30, 45],
    options      : ['A','B','C','D'],
    courses      : ['1° Básico','2° Básico','3° Básico','4° Básico','5° Básico',
                    '6° Básico','7° Básico','8° Básico',
                    '1° Medio','2° Medio','3° Medio','4° Medio'],
  },
};

/* ──────────────────────────────────────────────────────────────
   GEMINI PROMPTS
   ────────────────────────────────────────────────────────────── */
const PROMPT_SIMCE = `
Analiza detenidamente esta imagen de una Hoja de Respuestas para ensayo SIMCE escolar chileno.

1. ORIENTACIÓN Y ALINEACIÓN DE LA IMAGEN:
- Antes de leer, determina la orientación de la hoja: debe estar vertical, con el nombre del alumno arriba y las grillas abajo. Si está girada o rotada, rota la imagen mentalmente 90, 180 o 270 grados para leerla al derecho.
- La hoja impresa contiene 4 marcas de esquina negras en forma de escuadra (L) o L-marks en las esquinas extremas del papel. Utilízalas como referencia espacial para corregir mentalmente cualquier distorsión de perspectiva o inclinación de la foto.

2. ESTRUCTURA DE LAS PREGUNTAS:
- Columna 1 (izquierda): Preguntas 01 a 15.
- Columna 2 (centro): Preguntas 16 a 30.
- Columna 3 (derecha): Preguntas 31 a 45.
Cada columna tiene una cabecera como "Preguntas 01 – 15". Cada pregunta se ubica en una fila horizontal identificada por su número a la izquierda (por ejemplo: "01", "02", ..., "45").
En cada fila horizontal hay exactamente 4 círculos alineados de izquierda a derecha correspondientes a las opciones A, B, C y D.

3. REGLAS CRÍTICAS DE DETECCIÓN Y GRADO DE CONFIANZA:
- Una opción está seleccionada si el círculo correspondiente tiene una marca explícita del estudiante: relleno oscuro completo o parcial, una "X" (cruz) marcada encima, un check ("✓"), o un rayón/mancha de lápiz notable.
- Determina la respuesta por la POSICIÓN del círculo marcado (1º = A, 2º = B, 3º = C, 4º = D), no intentes leer la letra adentro, ya que si está marcada, la letra estará tapada o distorsionada.
- EVITAR ALUCINACIÓN: Si en una fila todos los 4 círculos están limpios, blancos y sin marcas (la letra A, B, C, D se ve perfectamente blanca e intacta), la respuesta es estrictamente null. ¡No adivines ni inventes respuestas! Si la pregunta está vacía, reporta null. Si tienes dudas de si hay una marca o si es un borrón o sombra, asume que está vacía (null).

4. MÉTODO DE RAZONAMIENTO PASO A PASO (Chain of Thought):
Para asegurar una precisión absoluta, analiza la hoja columna por columna y pregunta por pregunta. En la propiedad "observaciones_analisis" de tu respuesta JSON, describe brevemente qué marca ves para cada pregunta (ejemplo: "Pregunta 01: Marca clara en el primer círculo (A). Pregunta 02: Marca de cruz en el segundo círculo (B). Pregunta 03: Todos los círculos limpios (null). ..."). Luego, mapea esta conclusión al campo "respuestas".

Devuelve ÚNICAMENTE el siguiente JSON (sin texto extra, sin markdown, sin bloques de código):
{
  "nombre": "nombre del estudiante escrito a mano en la parte superior, o null si está vacío/ilegible",
  "tipo": "SIMCE",
  "observaciones_analisis": "Texto libre con el análisis paso a paso pregunta por pregunta de la 1 a la 45 para asegurar que no se salten filas o columnas",
  "respuestas": {
    "1": "A o B o C o D o null",
    "2": "A o B o C o D o null",
    "...": "... continuar hasta la pregunta 45 ..."
  }
}
Incluye las 45 preguntas en el JSON.
`;

const PROMPT_PAES = `
Analiza detenidamente esta imagen de una Hoja de Respuestas para ensayo PAES escolar chileno.

1. ORIENTACIÓN Y ALINEACIÓN DE LA IMAGEN:
- Antes de leer, determina la orientación de la hoja: debe estar vertical, con el nombre del alumno arriba y las grillas abajo. Si está girada o rotada, rota la imagen mentalmente 90, 180 o 270 grados para leerla al derecho.
- La hoja impresa contiene 4 marcas de esquina negras en forma de escuadra (L) o L-marks en las esquinas extremas del papel. Utilízalas como referencia espacial para corregir mentalmente cualquier distorsión de perspectiva o inclinación de la foto.

2. ESTRUCTURA DE LAS PREGUNTAS:
- Columna 1 (izquierda): Preguntas 01 a 25.
- Columna 2 (centro): Preguntas 26 a 50.
- Columna 3 (derecha): Preguntas 51 a 75.
Cada columna tiene una cabecera como "Preguntas 01 – 25". Cada pregunta se ubica en una fila horizontal identificada por su número a la izquierda.
En cada fila horizontal hay exactamente 5 círculos alineados de izquierda a derecha correspondientes a las opciones A, B, C, D y E.

3. REGLAS CRÍTICAS DE DETECCIÓN Y GRADO DE CONFIANZA:
- Una opción está seleccionada si el círculo correspondiente tiene una marca explícita del estudiante: relleno oscuro completo o parcial, una "X" (cruz) marcada encima, un check ("✓"), o un rayón/mancha de lápiz notable.
- Determina la respuesta por la POSICIÓN del círculo marcado (1º = A, 2º = B, 3º = C, 4º = D, 5º = E), no intentes leer la letra adentro, ya que si está marcada, la letra estará tapada o distorsionada.
- EVITAR ALUCINACIÓN: Si en una fila todos los 5 círculos están limpios, blancos y sin marcas (la letra A, B, C, D, E se ve perfectamente blanca e intacta), la respuesta es estrictamente null. ¡No adivines ni inventes respuestas! Si la pregunta está vacía, reporta null. Si tienes dudas de si hay una marca o si es un borrón o sombra, asume que está vacía (null).

4. MÉTODO DE RAZONAMIENTO PASO A PASO (Chain of Thought):
Para asegurar una precisión absoluta, analiza la hoja columna por columna y pregunta por pregunta. En la propiedad "observaciones_analisis" de tu respuesta JSON, describe brevemente qué marca ves para cada pregunta (ejemplo: "Pregunta 01: Marca clara en el primer círculo (A). Pregunta 02: Marca de cruz en el segundo círculo (B). ..."). Luego, mapea esta conclusión al campo "respuestas".

Devuelve ÚNICAMENTE el siguiente JSON (sin texto extra, sin markdown, sin bloques de código):
{
  "nombre": "nombre del estudiante escrito a mano en la parte superior, o null si está vacío/ilegible",
  "tipo": "PAES",
  "observaciones_analisis": "Texto libre con el análisis paso a paso pregunta por pregunta de la 1 a la 75 para asegurar que no se salten filas o columnas",
  "respuestas": {
    "1": "A o B o C o D o E o null",
    "2": "A o B o C o D o E o null",
    "...": "... continuar hasta la pregunta 75 ..."
  }
}
Incluye las 75 preguntas en el JSON.
`;

const PROMPT_GLOBAL = (n) => `
Analiza detenidamente esta imagen de una Hoja de Respuestas de evaluación escolar chilena.

La hoja tiene ${n} preguntas con opciones A, B, C, D (la letra está escrita dentro de los círculos).

1. ORIENTACIÓN Y ALINEACIÓN DE LA IMAGEN:
- Determina la orientación de la hoja: debe estar vertical, con el nombre del alumno arriba y las grillas abajo. Si está girada o rotada, rota la imagen mentalmente 90, 180 o 270 grados para leerla al derecho.
- La hoja impresa contiene 4 marcas de esquina negras en forma de escuadra (L) o L-marks en las esquinas extremas del papel. Utilízalas como referencia espacial para corregir mentalmente cualquier distorsión de perspectiva o inclinación de la foto.

2. ESTRUCTURA DE LAS PREGUNTAS:
- Las preguntas están organizadas en columnas verticales de 15 o 20 preguntas cada una. Cada fila tiene su número de pregunta a la izquierda y sus opciones A, B, C, D alineadas horizontalmente.

3. REGLAS CRÍTICAS DE DETECCIÓN Y GRADO DE CONFIANZA:
- Una opción está seleccionada si el círculo correspondiente tiene una marca explícita del estudiante: relleno oscuro completo o parcial, una "X" (cruz) marcada encima, un check ("✓"), o un rayón/mancha de lápiz notable.
- Determina la respuesta por la POSICIÓN del círculo marcado (1º = A, 2º = B, 3º = C, 4º = D), no intentes leer la letra adentro, ya que si está marcada, la letra estará tapada o distorsionada.
- EVITAR ALUCINACIÓN: Si en una fila todos los círculos están limpios, blancos y sin marcas, la respuesta es estrictamente null. ¡No adivines ni inventes respuestas! Si la pregunta está vacía, reporta null. Si tienes dudas de si hay una marca o si es un borrón o sombra, asume que está vacía (null).

4. MÉTODO DE RAZONAMIENTO PASO A PASO (Chain of Thought):
Para asegurar una precisión absoluta, analiza la hoja columna por columna y pregunta por pregunta. En la propiedad "observaciones_analisis" de tu respuesta JSON, describe brevemente qué marca ves para cada pregunta. Luego, mapea esta conclusión al campo "respuestas".

Devuelve ÚNICAMENTE el siguiente JSON (sin texto extra, sin markdown, sin bloques de código):
{
  "nombre": "nombre del estudiante escrito a mano en la parte superior, o null si está vacío/ilegible",
  "tipo": "GLOBAL",
  "observaciones_analisis": "Texto libre con el análisis paso a paso pregunta por pregunta de la 1 a la ${n} para asegurar que no se salten filas o columnas",
  "respuestas": {
    "1": "A o B o C o D o null",
    "...": "... continuar hasta la pregunta ${n} ..."
  }
}
`;

/* ──────────────────────────────────────────────────────────────
   STATE
   ────────────────────────────────────────────────────────────── */
let state = {
  currentView      : 'home',
  currentType      : 'SIMCE',
  currentAnswers   : {},
  currentAnswerCount: 45,
  records          : [],
  keys             : [],
  activeKeyId      : null,

  // Processing
  homeType         : 'SIMCE',
  homeGlobalCount  : 30,
  procResults      : [],
  procRunning      : false,

  // Key modal
  keyModalMode     : 'create',
  keyModalId       : null,
  keyModalAnswers  : {},
  keyModalCount    : 30,

  // Detail modal
  detailRecordId   : null,

  // Edit modal
  editResultIdx    : null,
  editAnswers      : {},
};

/* ──────────────────────────────────────────────────────────────
   STORAGE
   ────────────────────────────────────────────────────────────── */
function loadStorage() {
  try {
    state.records = JSON.parse(localStorage.getItem('edu_records') || '[]');
    state.keys    = JSON.parse(localStorage.getItem('edu_keys')    || '[]');
  } catch(e) { state.records = []; state.keys = []; }
}
function saveStorage() {
  localStorage.setItem('edu_records', JSON.stringify(state.records));
  localStorage.setItem('edu_keys',    JSON.stringify(state.keys));
}

/* ──────────────────────────────────────────────────────────────
   VIEW MANAGER
   ────────────────────────────────────────────────────────────── */
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('view-' + name);
  if (el) el.classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const nb = document.getElementById('nav-' + name);
  if (nb) nb.classList.add('active');

  state.currentView = name;

  if (name === 'home')      updateUploadConfigFields();
  if (name === 'registros') renderTable();
  if (name === 'claves')    renderKeys();
}

/* ──────────────────────────────────────────────────────────────
   HOME — TYPE SELECTION
   ────────────────────────────────────────────────────────────── */
function setHomeType(type) {
  state.homeType = type;
  document.querySelectorAll('.type-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.type === type);
  });
  updateUploadConfigFields();
}

function setHomeGlobalCount(n) {
  state.homeGlobalCount = n;
  [20,30,45].forEach(v => {
    const b = document.getElementById('hg-' + v);
    if (b) b.classList.toggle('active', v === n);
  });
}

function selectType(type) {
  state.currentType = type;
  state.currentAnswers = {};
  showView('form');
  populateFormSelects();
  renderAnswerGrid('answers-grid', type, getDefaultCount(type), {});
  updateFormBadge();

  const cw = document.getElementById('count-selector-wrap');
  const aw = document.getElementById('asig-libre-wrap');
  if (cw) cw.style.display = type === 'GLOBAL' ? 'flex' : 'none';
  if (aw) aw.style.display = type === 'GLOBAL' ? 'block' : 'none';

  document.getElementById('f-nombre').value  = '';
  document.getElementById('f-rut').value     = '';
  document.getElementById('f-evaluacion').value = '';
  const fl = document.getElementById('f-letra');
  if (fl) fl.value = '';
  const fd = document.getElementById('f-fecha');
  if (fd) fd.valueAsDate = new Date();
}

function getDefaultCount(type) {
  if (type === 'SIMCE')  return 45;
  if (type === 'PAES')   return 75;
  return state.currentAnswerCount || 30;
}

function updateFormBadge() {
  const b = document.getElementById('form-type-badge');
  if (!b) return;
  b.textContent  = state.currentType === 'GLOBAL' ? 'GLOBAL' : state.currentType;
  b.dataset.type = state.currentType;
  const t = document.getElementById('form-view-title');
  if (t) t.textContent = 'Nueva Hoja – ' + state.currentType;
}

function populateFormSelects() {
  const cfg = CONFIG[state.currentType] || CONFIG.SIMCE;

  const cs = document.getElementById('f-curso');
  if (cs) {
    cs.innerHTML = '<option value="">— Seleccionar —</option>';
    const courses = state.currentType === 'GLOBAL' ? CONFIG.GLOBAL.courses : cfg.courses;
    courses.forEach(c => cs.appendChild(new Option(c, c)));
  }

  const as = document.getElementById('f-asignatura');
  if (as) {
    as.innerHTML = '<option value="">— Seleccionar —</option>';
    if (state.currentType !== 'GLOBAL') {
      cfg.subjects.forEach(s => as.appendChild(new Option(s, s)));
    }
  }
}

function setAnswerCount(n) {
  state.currentAnswerCount = n;
  [20,30,45].forEach(v => {
    const b = document.getElementById('count-' + v);
    if (b) b.classList.toggle('active', v === n);
  });
  renderAnswerGrid('answers-grid', 'GLOBAL', n, state.currentAnswers);
}

/* ──────────────────────────────────────────────────────────────
   ANSWER GRID RENDERER
   ────────────────────────────────────────────────────────────── */
function renderAnswerGrid(containerId, type, numQ, answers, keyAnswers, readOnly) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  const opts = type === 'PAES' ? ['A','B','C','D','E'] : ['A','B','C','D'];
  const cols = type === 'PAES' ? 5 : 3;

  container.className = 'answers-grid' + (type === 'PAES' ? ' paes-grid' : '');

  // Distribute questions into columns
  const perCol = Math.ceil(numQ / cols);
  const colGroups = [];
  for (let c = 0; c < cols; c++) {
    const start = c * perCol + 1;
    const end   = Math.min(start + perCol - 1, numQ);
    colGroups.push({ start, end });
  }

  colGroups.forEach(({ start, end }) => {
    const colDiv = document.createElement('div');
    colDiv.className = 'ans-col';
    for (let q = start; q <= end; q++) {
      const row = document.createElement('div');
      row.className = 'answer-row';

      const qn = document.createElement('span');
      qn.className = 'q-num';
      qn.textContent = String(q).padStart(2, '0');
      row.appendChild(qn);

      opts.forEach(opt => {
        const bub = document.createElement('span');
        bub.className = 'bubble';
        bub.textContent = opt;
        bub.dataset.q   = q;
        bub.dataset.opt = opt;
        bub.id = `${containerId}-q${q}-${opt}`;

        const sel = answers && answers[q];
        const key = keyAnswers && keyAnswers[q];

        if (sel === opt && key) {
          bub.classList.add(sel === key ? 'correct' : 'wrong');
        } else if (sel === opt) {
          bub.classList.add('selected');
        } else if (key === opt && !sel) {
          bub.classList.add('key-mark');
        }

        if (!readOnly) {
          bub.onclick = () => toggleBubble(containerId, q, opt, type, numQ, keyAnswers);
        }
        row.appendChild(bub);
      });

      colDiv.appendChild(row);
    }
    container.appendChild(colDiv);
  });
}

function toggleBubble(containerId, q, opt, type, numQ, keyAnswers) {
  // Determine which answer state to modify
  let ansObj;
  if (containerId === 'answers-grid')   ansObj = state.currentAnswers;
  else if (containerId === 'key-answers-grid') ansObj = state.keyModalAnswers;
  else if (containerId === 'edit-answers-grid') ansObj = state.editAnswers;
  else return;

  ansObj[q] = ansObj[q] === opt ? null : opt;

  renderAnswerGrid(containerId, type, numQ, ansObj, keyAnswers);
}

/* ──────────────────────────────────────────────────────────────
   MANUAL FORM — SAVE RECORD
   ────────────────────────────────────────────────────────────── */
function saveRecord() {
  const nombre   = document.getElementById('f-nombre').value.trim();
  const rut      = document.getElementById('f-rut').value.trim();
  const fecha    = document.getElementById('f-fecha').value;
  const cursoVal = document.getElementById('f-curso').value;
  const letraVal = document.getElementById('f-letra').value;
  const curso    = buildCursoDisplay(cursoVal, letraVal);
  const evName   = document.getElementById('f-evaluacion').value.trim();
  let   asig     = document.getElementById('f-asignatura').value;

  if (state.currentType === 'GLOBAL') {
    asig = document.getElementById('f-asignatura-libre').value.trim() || asig;
  }

  if (!nombre)   { showToast('Ingresa el nombre del estudiante', 'error'); return; }
  if (!cursoVal) { showToast('Selecciona el curso', 'error'); return; }

  const numQ = getDefaultCount(state.currentType);
  const answeredCount = Object.values(state.currentAnswers).filter(Boolean).length;

  const record = {
    id         : Date.now(),
    tipo       : state.currentType,
    nombre, rut, fecha, curso, asig,
    evaluacion : evName,
    numQ,
    respuestas : { ...state.currentAnswers },
    answeredCount,
    score      : calcScore(state.currentAnswers, state.activeKeyId, numQ),
    keyId      : state.activeKeyId,
    createdAt  : new Date().toISOString(),
  };

  state.records.unshift(record);
  saveStorage();
  updateBadge();

  showToast(`✓ Registro guardado (${answeredCount}/${numQ} respuestas)`, 'success');
  clearForm();
  showView('registros');
}

function clearForm() {
  state.currentAnswers = {};
  const numQ = getDefaultCount(state.currentType);
  renderAnswerGrid('answers-grid', state.currentType, numQ, {});
  document.getElementById('f-nombre').value     = '';
  document.getElementById('f-rut').value        = '';
  document.getElementById('f-evaluacion').value = '';
  document.getElementById('f-curso').value      = '';
  const fl = document.getElementById('f-letra');
  if (fl) fl.value = '';
  if (document.getElementById('f-asignatura'))
    document.getElementById('f-asignatura').value = '';
}

function clearAllAnswers() {
  state.currentAnswers = {};
  const numQ = getDefaultCount(state.currentType);
  renderAnswerGrid('answers-grid', state.currentType, numQ, {});
}

function loadKeyForForm() {
  const tipo = state.currentType;
  const asig = tipo === 'GLOBAL'
    ? document.getElementById('f-asignatura-libre')?.value?.trim()
    : document.getElementById('f-asignatura')?.value;
  const cursoVal = document.getElementById('f-curso')?.value;
  const letraVal = document.getElementById('f-letra')?.value;
  const curso = buildCursoDisplay(cursoVal, letraVal);

  const match = state.keys.find(k =>
    k.tipo === tipo &&
    (!k.asig || k.asig === asig) &&
    (!k.curso || curso.startsWith(k.curso))
  );

  const box  = document.getElementById('key-info-box');
  const name = document.getElementById('key-info-name');
  if (match) {
    state.activeKeyId = match.id;
    if (box)  box.style.display = 'flex';
    if (name) name.textContent  = match.nombre;
  } else {
    state.activeKeyId = null;
    if (box) box.style.display = 'none';
  }
}

/* ──────────────────────────────────────────────────────────────
   PDF PROCESSING
   ────────────────────────────────────────────────────────────── */
function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('upload-area')?.classList.add('drag-over');
}
function handleDragLeave(e) {
  document.getElementById('upload-area')?.classList.remove('drag-over');
}
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('upload-area')?.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type === 'application/pdf') startProcessing(file);
  else showToast('Por favor sube un archivo PDF', 'error');
}
function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) startProcessing(file);
  e.target.value = '';
}

async function startProcessing(file) {
  const tipo = state.homeType;
  state.procResults = [];
  state.procRunning = true;

  showView('procesamiento');

  const typeBadge = document.getElementById('proc-type-badge');
  if (typeBadge) { typeBadge.textContent = tipo === 'GLOBAL' ? 'GLOBAL' : tipo; typeBadge.dataset.type = tipo; }

  const saveBar   = document.getElementById('proc-save-bar');
  const resultsGrid = document.getElementById('proc-results-grid');
  if (saveBar)    saveBar.style.display    = 'none';
  if (resultsGrid) resultsGrid.innerHTML  = '';

  setProgress(0, 0, 0, 'Cargando PDF…');

  try {
    // ── Init PDF.js
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const totalPages = Math.min(pdf.numPages, CONFIG.MAX_PAGES);

    if (totalPages === 0) { showToast('El PDF no tiene páginas', 'error'); return; }

    setProgress(0, totalPages, 0, `${totalPages} hojas encontradas`);

    // Create placeholder cards
    for (let i = 1; i <= totalPages; i++) {
      state.procResults.push({ pageNum: i, status: 'pending', data: null, thumbUrl: null, include: true });
      appendProcCard(i, totalPages);
    }

    const estSec = Math.ceil(totalPages * CONFIG.REQ_DELAY_MS / 1000);
    const etaEl  = document.getElementById('proc-eta');
    if (etaEl) etaEl.textContent = `Tiempo estimado: ~${estSec} segundos`;

    // Process each page
    for (let i = 1; i <= totalPages; i++) {
      if (!state.procRunning) break;

      updateCardStatus(i, 'proc', 'Analizando con IA…');
      setProgress(i - 1, totalPages, Math.round((i - 1) / totalPages * 100), `Procesando hoja ${i} de ${totalPages}…`);

      try {
        // Render page to canvas
        const { base64, thumbDataUrl } = await renderPageToBase64(pdf, i);

        // Update thumbnail
        updateCardThumb(i, thumbDataUrl);

        // Call Gemini
        const result = await callGemini(base64, tipo);
        result.pageNum = i;
        result.thumbUrl = thumbDataUrl;
        state.procResults[i - 1] = { pageNum: i, status: 'success', data: result, thumbUrl: thumbDataUrl, include: true };

        updateCardData(i, result);
        updateCardStatus(i, 'ok', 'Detectado correctamente');

      } catch (err) {
        console.error(`Page ${i} error:`, err);
        state.procResults[i - 1] = { pageNum: i, status: 'error', data: null, thumbUrl: null, include: false };
        updateCardStatus(i, 'fail', 'Error al procesar – ' + (err.message || ''));
      }

      // Rate limiting: wait before next request
      if (i < totalPages) await delay(CONFIG.REQ_DELAY_MS);
    }

    setProgress(totalPages, totalPages, 100, 'Procesamiento completado');
    if (etaEl) etaEl.textContent = '';

    const successCount = state.procResults.filter(r => r.status === 'success').length;
    const sumEl = document.getElementById('proc-save-summary');
    if (sumEl) sumEl.innerHTML = `<strong>${successCount}</strong> de ${totalPages} hojas procesadas correctamente`;
    if (saveBar) saveBar.style.display = 'flex';

  } catch (err) {
    console.error('PDF processing error:', err);
    showToast('Error al leer el PDF: ' + err.message, 'error');
  } finally {
    state.procRunning = false;
  }
}

async function renderPageToBase64(pdf, pageNum) {
  const page     = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: CONFIG.PDF_SCALE });
  const canvas   = document.createElement('canvas');
  canvas.width   = viewport.width;
  canvas.height  = viewport.height;
  const ctx      = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;

  const dataUrl    = canvas.toDataURL('image/jpeg', 0.90);
  const base64     = dataUrl.split(',')[1];

  // Thumbnail (smaller)
  const tCanvas    = document.createElement('canvas');
  const tScale     = 80 / canvas.width;
  tCanvas.width    = 80;
  tCanvas.height   = Math.round(canvas.height * tScale);
  tCanvas.getContext('2d').drawImage(canvas, 0, 0, tCanvas.width, tCanvas.height);
  const thumbDataUrl = tCanvas.toDataURL('image/jpeg', 0.75);

  return { base64, thumbDataUrl };
}

async function callGemini(imageBase64, tipo) {
  let prompt;
  if (tipo === 'SIMCE')     prompt = PROMPT_SIMCE;
  else if (tipo === 'PAES') prompt = PROMPT_PAES;
  else                      prompt = PROMPT_GLOBAL(state.homeGlobalCount);

  // Llamar al proxy serverless seguro local
  const url = '/api/analyze';
  const res = await fetch(url, {
    method  : 'POST',
    headers : { 'Content-Type': 'application/json' },
    body    : JSON.stringify({ imageBase64, prompt, model: CONFIG.OPENAI_MODEL }),
  });

  if (!res.ok) {
    const errText = await res.text();
    let friendly = `Servidor ${res.status}: ${errText.slice(0, 300)}`;
    if (res.status === 500 && errText.includes('OPENAI_API_KEY')) {
      friendly = 'La API key de OpenAI no está configurada en el panel de Vercel. Agrégala en Environment Variables.';
    }
    throw new Error(friendly);
  }

  const data  = await res.json();
  const text  = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Respuesta vacía de OpenAI');

  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned);
}

function cancelProcessing() {
  state.procRunning = false;
  showView('home');
}

/* ── Processing UI helpers ── */
function appendProcCard(pageNum, total) {
  const grid = document.getElementById('proc-results-grid');
  if (!grid) return;
  const card = document.createElement('div');
  card.className = 'proc-card pending';
  card.id = `proc-card-${pageNum}`;
  card.innerHTML = `
    <div class="proc-card-top">
      <div class="proc-thumb" id="proc-thumb-${pageNum}">
        <div class="proc-thumb-placeholder">Página ${pageNum}</div>
      </div>
      <div class="proc-card-info">
        <div class="proc-page-num">Hoja ${pageNum} de ${total}</div>
        <div class="proc-nombre" id="proc-nombre-${pageNum}">—</div>
        <div class="proc-meta"  id="proc-meta-${pageNum}">Esperando análisis…</div>
        <div class="proc-status wait" id="proc-status-${pageNum}">
          <span>En cola</span>
        </div>
      </div>
    </div>
    <div class="proc-card-actions" id="proc-actions-${pageNum}">
      <label class="proc-toggle">
        <input type="checkbox" checked id="proc-include-${pageNum}" onchange="toggleInclude(${pageNum})" />
        Incluir al guardar
      </label>
    </div>`;
  grid.appendChild(card);
}

function updateCardThumb(pageNum, thumbUrl) {
  const el = document.getElementById(`proc-thumb-${pageNum}`);
  if (el && thumbUrl) {
    el.innerHTML = `<img src="${thumbUrl}" alt="Pág. ${pageNum}" />`;
  }
}

function updateCardData(pageNum, data) {
  const nombreEl = document.getElementById(`proc-nombre-${pageNum}`);
  const metaEl   = document.getElementById(`proc-meta-${pageNum}`);
  const actEl    = document.getElementById(`proc-actions-${pageNum}`);

  if (nombreEl) nombreEl.textContent = data.nombre || '(Sin nombre)';

  const curso  = buildCursoDisplay(data.nivel, data.curso);
  const asig   = data.asignatura || '(Sin asignatura)';
  const resp   = Object.values(data.respuestas || {}).filter(Boolean).length;
  const total  = Object.keys(data.respuestas || {}).length;

  // Calculate score if key is selected
  const selectedKeyId = document.getElementById('upload-key-select')?.value;
  let scoreText = '';
  if (selectedKeyId) {
    const score = calcScore(data.respuestas, Number(selectedKeyId), total);
    if (score) {
      const pct = Math.round(score.correct / score.total * 100);
      scoreText = `<br/><span class="score-chip score-high" style="font-size:0.75rem;padding:2px 6px;margin-top:4px;display:inline-block">${score.correct}/${score.total} (${pct}%)</span>`;
    }
  }

  if (metaEl) metaEl.innerHTML = `${asig} · ${curso}<br/>${resp}/${total} respuestas marcadas${scoreText}`;

  if (actEl) {
    const existing = actEl.innerHTML;
    const editBtn  = `<button class="proc-edit-btn" onclick="openEditModal(${pageNum - 1})">✎ Editar</button>`;
    if (!actEl.querySelector('.proc-edit-btn')) {
      actEl.insertAdjacentHTML('beforeend', editBtn);
    }
  }

  const card = document.getElementById(`proc-card-${pageNum}`);
  if (card) card.className = 'proc-card success';
}

function updateCardStatus(pageNum, type, msg) {
  const el = document.getElementById(`proc-status-${pageNum}`);
  if (!el) return;
  const icons = {
    ok   : '✓',
    fail : '✗',
    wait : '…',
    proc : '',
  };
  const spinner = type === 'proc' ? '<div class="spinner"></div>' : '';
  el.className = `proc-status ${type}`;
  el.innerHTML = `${spinner}<span>${icons[type] ? icons[type] + ' ' : ''}${msg}</span>`;
}

function toggleInclude(pageNum) {
  const r = state.procResults[pageNum - 1];
  if (r) r.include = document.getElementById(`proc-include-${pageNum}`)?.checked ?? true;
}

function setProgress(done, total, pct, msg) {
  const fill = document.getElementById('proc-progress-fill');
  const text = document.getElementById('proc-status-text');
  const ctr  = document.getElementById('proc-counter');
  if (fill) fill.style.width = pct + '%';
  if (text) text.textContent = msg;
  if (ctr)  ctr.textContent  = total ? `${done} / ${total}` : '';
}

/* ── Save all processed results ── */
function saveAllProcResults() {
  const selectedKeyId = document.getElementById('upload-key-select')?.value;
  const keyId = selectedKeyId ? Number(selectedKeyId) : null;
  const keyObj = keyId ? state.keys.find(k => k.id === keyId) : null;

  // Determine asignatura
  let batchAsig = '';
  if (state.homeType === 'GLOBAL') {
    batchAsig = document.getElementById('upload-asig-libre')?.value?.trim() || '';
  } else {
    const selVal = document.getElementById('upload-asig-select')?.value;
    if (selVal === 'OTRA') {
      batchAsig = document.getElementById('upload-asig-libre')?.value?.trim() || '';
    } else {
      batchAsig = selVal || '';
    }
  }

  const toSave = state.procResults.filter(r => r.include && r.status === 'success' && r.data);
  if (!toSave.length) { showToast('No hay resultados para guardar', 'error'); return; }

  toSave.forEach(r => {
    const d    = r.data;
    const tipo = d.tipo || state.homeType;
    const numQ = keyObj ? keyObj.numQ : (tipo === 'PAES' ? 75 : (tipo === 'SIMCE' ? 45 : state.homeGlobalCount));
    
    // Determine curso
    let batchCurso = '';
    if (keyObj && keyObj.curso) {
      batchCurso = keyObj.curso;
    } else {
      batchCurso = document.getElementById('upload-curso-select')?.value || '';
    }
    const curso = batchCurso || buildCursoDisplay(d.nivel, d.curso);
    const answeredCount = Object.values(d.respuestas || {}).filter(Boolean).length;

    const record = {
      id          : Date.now() + Math.random(),
      tipo,
      nombre      : d.nombre || '',
      rut         : d.rut    || '',
      fecha       : new Date().toISOString().slice(0, 10),
      curso,
      asig        : batchAsig || d.asignatura || '',
      evaluacion  : keyObj ? keyObj.nombre : '',
      numQ,
      respuestas  : d.respuestas || {},
      answeredCount,
      score       : calcScore(d.respuestas || {}, keyId, numQ),
      keyId       : keyId,
      source      : 'pdf',
      thumbUrl    : r.thumbUrl || null,
      createdAt   : new Date().toISOString(),
    };
    state.records.unshift(record);
  });

  saveStorage();
  updateBadge();
  showToast(`✓ ${toSave.length} registros guardados`, 'success');
  showView('registros');
}

function buildCursoDisplay(nivel, letra) {
  if (!nivel && !letra) return '—';
  if (!nivel) return letra || '—';
  return letra ? `${nivel} ${letra.toUpperCase()}` : nivel;
}

/* ──────────────────────────────────────────────────────────────
   EDIT MODAL (processed result)
   ────────────────────────────────────────────────────────────── */
function openEditModal(idx) {
  const r = state.procResults[idx];
  if (!r || !r.data) return;
  state.editResultIdx = idx;
  state.editAnswers   = { ...(r.data.respuestas || {}) };

  document.getElementById('edit-nombre').value    = r.data.nombre    || '';
  document.getElementById('edit-rut').value       = r.data.rut       || '';
  document.getElementById('edit-curso').value     = buildCursoDisplay(r.data.nivel, r.data.curso);
  document.getElementById('edit-asignatura').value= r.data.asignatura|| '';

  const tipo = r.data.tipo || state.homeType;
  const numQ = tipo === 'PAES' ? 75 : (tipo === 'SIMCE' ? 45 : state.homeGlobalCount);
  renderAnswerGrid('edit-answers-grid', tipo, numQ, state.editAnswers);

  document.getElementById('edit-modal-overlay').style.display = 'flex';
}

function closeEditModal(e) {
  if (e.target === document.getElementById('edit-modal-overlay')) closeEditModalDirect();
}
function closeEditModalDirect() {
  document.getElementById('edit-modal-overlay').style.display = 'none';
}

function saveEditedResult() {
  const idx = state.editResultIdx;
  if (idx === null || idx === undefined) return;
  const r = state.procResults[idx];
  if (!r || !r.data) return;

  r.data.nombre     = document.getElementById('edit-nombre').value.trim();
  r.data.rut        = document.getElementById('edit-rut').value.trim();
  r.data.asignatura = document.getElementById('edit-asignatura').value.trim();
  r.data.respuestas = { ...state.editAnswers };

  updateCardData(r.pageNum, r.data);
  closeEditModalDirect();
  showToast('Cambios guardados', 'success');
}

/* ──────────────────────────────────────────────────────────────
   CLAVES VIEW
   ────────────────────────────────────────────────────────────── */
function openKeyModal(existingId) {
  state.keyModalMode    = existingId ? 'edit' : 'create';
  state.keyModalId      = existingId || null;
  state.keyModalAnswers = {};
  state.keyModalCount   = 30;

  document.getElementById('key-modal-title').textContent =
    existingId ? 'Editar Clave' : 'Nueva Clave de Respuestas';
  document.getElementById('km-nombre').value = '';
  document.getElementById('km-type').value   = 'SIMCE';

  if (existingId) {
    const k = state.keys.find(k => k.id === existingId);
    if (k) {
      document.getElementById('km-nombre').value  = k.nombre;
      document.getElementById('km-type').value    = k.tipo;
      state.keyModalAnswers = { ...k.respuestas };
      state.keyModalCount   = k.numQ;
    }
  }

  updateKeyModalFields();
  document.getElementById('key-modal-overlay').style.display = 'flex';
}

function updateKeyModalFields() {
  const tipo = document.getElementById('km-type').value;
  const cfg  = CONFIG[tipo] || CONFIG.SIMCE;

  const cs = document.getElementById('km-curso');
  if (cs) {
    cs.innerHTML = '<option value="">— Todos —</option>';
    const courses = tipo === 'GLOBAL' ? CONFIG.GLOBAL.courses : (cfg.courses || []);
    courses.forEach(c => cs.appendChild(new Option(c, c)));
  }

  const as    = document.getElementById('km-asignatura');
  const asLib = document.getElementById('km-asig-libre');
  if (as && asLib) {
    if (tipo === 'GLOBAL') {
      as.style.display    = 'none';
      asLib.style.display = 'block';
    } else {
      as.style.display    = 'block';
      asLib.style.display = 'none';
      as.innerHTML = '<option value="">— Todas —</option>';
      (cfg.subjects || []).forEach(s => as.appendChild(new Option(s, s)));
    }
  }

  const cw = document.getElementById('km-count-wrap');
  if (cw) cw.style.display = tipo === 'GLOBAL' ? 'block' : 'none';

  const numQ = tipo === 'PAES' ? 75 : (tipo === 'SIMCE' ? 45 : state.keyModalCount);
  renderAnswerGrid('key-answers-grid', tipo, numQ, state.keyModalAnswers);
}

function setKeyCount(n) {
  state.keyModalCount = n;
  [20, 30, 45].forEach(v => {
    const b = document.getElementById(`km-c-${v}`);
    if (b) b.classList.toggle('active', v === n);
  });
  renderAnswerGrid('key-answers-grid', 'GLOBAL', n, state.keyModalAnswers);
}

function saveKey() {
  const tipo   = document.getElementById('km-type').value;
  const nombre = document.getElementById('km-nombre').value.trim();
  const curso  = document.getElementById('km-curso')?.value || '';
  const asig   = tipo === 'GLOBAL'
    ? (document.getElementById('km-asig-libre')?.value?.trim() || '')
    : (document.getElementById('km-asignatura')?.value || '');

  if (!nombre) { showToast('Ingresa un nombre para la clave', 'error'); return; }

  const numQ = tipo === 'PAES' ? 75 : (tipo === 'SIMCE' ? 45 : state.keyModalCount);
  const answered = Object.values(state.keyModalAnswers).filter(Boolean).length;
  if (answered === 0) { showToast('Marca al menos una respuesta correcta', 'error'); return; }

  const key = {
    id        : state.keyModalId || Date.now(),
    tipo, nombre, curso, asig, numQ,
    respuestas: { ...state.keyModalAnswers },
    answered,
    createdAt : new Date().toISOString(),
  };

  if (state.keyModalMode === 'edit') {
    const idx = state.keys.findIndex(k => k.id === state.keyModalId);
    if (idx >= 0) state.keys[idx] = key;
  } else {
    state.keys.unshift(key);
  }

  saveStorage();
  renderKeys();
  updateUploadConfigFields();
  closeKeyModalDirect();
  showToast(`✓ Clave guardada (${answered}/${numQ} respuestas)`, 'success');
}

function renderKeys() {
  const grid  = document.getElementById('keys-grid');
  const empty = document.getElementById('keys-empty');
  if (!grid) return;

  if (!state.keys.length) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';

  grid.innerHTML = state.keys.map(k => `
    <div class="key-card">
      <div class="key-card-header">
        <div>
          <div class="key-card-name">${esc(k.nombre)}</div>
          <div class="key-card-meta">
            ${typeBadgeHtml(k.tipo)} · ${k.numQ} preg · ${k.answered} marcadas
            ${k.asig ? '· ' + esc(k.asig) : ''}
            ${k.curso ? '· ' + esc(k.curso) : ''}
          </div>
        </div>
      </div>
      <div class="key-preview">${buildKeyPreview(k)}</div>
      <div class="key-card-acts">
        <button class="btn-outline" style="font-size:.75rem;padding:.25rem .6rem" onclick="openKeyModal(${k.id})">Editar</button>
        <button class="key-del-btn" onclick="deleteKey(${k.id})">Eliminar</button>
      </div>
    </div>
  `).join('');
}

function buildKeyPreview(k) {
  return Object.entries(k.respuestas).slice(0, 20).map(([q, a]) =>
    `<div class="key-dot ${a ? 'has-ans' : ''}">${a || '·'}</div>`
  ).join('');
}

function deleteKey(id) {
  if (!confirm('¿Eliminar esta clave?')) return;
  state.keys = state.keys.filter(k => k.id !== id);
  saveStorage();
  renderKeys();
  updateUploadConfigFields();
}

function closeKeyModal(e) {
  if (e.target === document.getElementById('key-modal-overlay')) closeKeyModalDirect();
}
function closeKeyModalDirect() {
  document.getElementById('key-modal-overlay').style.display = 'none';
}

/* ──────────────────────────────────────────────────────────────
   REGISTROS VIEW
   ────────────────────────────────────────────────────────────── */
function renderTable() {
  const tbody   = document.getElementById('records-tbody');
  const empty   = document.getElementById('empty-state');
  const tWrap   = document.getElementById('table-wrap');
  const subtitle= document.getElementById('reg-subtitle-count');
  if (!tbody) return;

  const typeF  = document.getElementById('filter-type')?.value  || '';
  const cursoF = document.getElementById('filter-curso')?.value || '';
  const asigF  = document.getElementById('filter-asig')?.value  || '';
  const search = (document.getElementById('filter-search')?.value || '').toLowerCase();

  // Populate filter dropdowns
  populateFilterDropdowns();

  let rows = state.records;
  if (typeF)  rows = rows.filter(r => r.tipo  === typeF);
  if (cursoF) rows = rows.filter(r => r.curso === cursoF);
  if (asigF)  rows = rows.filter(r => r.asig  === asigF);
  if (search) rows = rows.filter(r =>
    (r.nombre || '').toLowerCase().includes(search) ||
    (r.rut    || '').toLowerCase().includes(search)
  );

  if (subtitle) subtitle.textContent = `${rows.length} hoja${rows.length !== 1 ? 's' : ''} registrada${rows.length !== 1 ? 's' : ''}`;

  if (!rows.length) {
    if (empty) empty.style.display = 'flex';
    if (tWrap) tWrap.style.display = 'none';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (tWrap) tWrap.style.display = 'block';

  tbody.innerHTML = rows.map((r, i) => {
    const scoreHtml = buildScoreHtml(r.score, r.numQ);
    return `
      <tr>
        <td>${i + 1}</td>
        <td>${typeBadgeHtml(r.tipo)}</td>
        <td class="r-name">${esc(r.nombre) || '<em style="color:var(--text-muted)">—</em>'}</td>
        <td>${esc(r.rut) || '—'}</td>
        <td>${esc(r.curso) || '—'}</td>
        <td>${esc(r.asig) || '—'}</td>
        <td>${esc(r.evaluacion) || '—'}</td>
        <td>${r.fecha || '—'}</td>
        <td>${r.answeredCount || 0}/${r.numQ || '?'}</td>
        <td>${scoreHtml}</td>
        <td><button class="tbl-act-btn" onclick="openRecordModal(${r.id})">Ver</button></td>
      </tr>`;
  }).join('');
}

function populateFilterDropdowns() {
  const cursoSel = document.getElementById('filter-curso');
  const asigSel  = document.getElementById('filter-asig');
  if (!cursoSel || !asigSel) return;

  const curVal = cursoSel.value;
  const asVal  = asigSel.value;

  const cursos = [...new Set(state.records.map(r => r.curso).filter(Boolean))].sort();
  const asigs  = [...new Set(state.records.map(r => r.asig).filter(Boolean))].sort();

  cursoSel.innerHTML = '<option value="">Todos los cursos</option>' +
    cursos.map(c => `<option value="${esc(c)}" ${c === curVal ? 'selected' : ''}>${esc(c)}</option>`).join('');
  asigSel.innerHTML  = '<option value="">Todas las asignaturas</option>' +
    asigs.map(a => `<option value="${esc(a)}" ${a === asVal ? 'selected' : ''}>${esc(a)}</option>`).join('');
}

function buildScoreHtml(score, numQ) {
  if (!score || !score.total) return `<span class="score-chip score-none">Sin clave</span>`;
  const pct  = Math.round(score.correct / score.total * 100);
  const cls  = pct >= 70 ? 'high' : pct >= 50 ? 'mid' : 'low';
  return `<span class="score-chip score-${cls}">${score.correct}/${score.total} (${pct}%)</span>`;
}

/* ── Record Detail Modal ── */
function openRecordModal(id) {
  const r = state.records.find(rec => rec.id === id);
  if (!r) return;
  state.detailRecordId = id;

  const badge = document.getElementById('modal-type-badge');
  const title = document.getElementById('modal-title');
  if (badge) { badge.textContent = r.tipo === 'GLOBAL' ? 'GLOBAL' : r.tipo; badge.dataset.type = r.tipo; }
  if (title)  title.textContent = r.nombre || 'Sin nombre';

  // Info grid
  const infoGrid = document.getElementById('modal-info-grid');
  if (infoGrid) {
    infoGrid.innerHTML = [
      ['Nombre', r.nombre || '—'],
      ['RUT',    r.rut    || '—'],
      ['Curso',  r.curso  || '—'],
      ['Asignatura', r.asig || '—'],
      ['Evaluación', r.evaluacion || '—'],
      ['Fecha',  r.fecha  || '—'],
      ['Respondidas', `${r.answeredCount || 0} / ${r.numQ}`],
      ['Tipo',   r.tipo],
    ].map(([l, v]) => `
      <div class="info-item">
        <div class="info-label">${l}</div>
        <div class="info-value">${esc(String(v))}</div>
      </div>`).join('');
  }

  // Score
  const scoreBar = document.getElementById('modal-score-bar');
  if (scoreBar) {
    if (r.score && r.score.total) {
      const pct = Math.round(r.score.correct / r.score.total * 100);
      const cls = pct >= 70 ? 'high' : pct >= 50 ? 'mid' : 'low';
      scoreBar.style.display = 'block';
      scoreBar.innerHTML = `
        <div class="score-summary">
          <div>
            <div class="score-number ${cls}">${r.score.correct}</div>
            <div class="score-label">correctas</div>
          </div>
          <div>
            <div class="score-number" style="color:var(--text-muted)">${r.score.wrong}</div>
            <div class="score-label">incorrectas</div>
          </div>
          <div>
            <div class="score-number" style="color:var(--text-muted)">${r.score.blank}</div>
            <div class="score-label">sin marcar</div>
          </div>
          <div class="score-pct">${pct}%</div>
        </div>`;
    } else {
      scoreBar.style.display = 'none';
    }
  }

  // Answers grid
  const key      = state.keys.find(k => k.id === r.keyId);
  const keyAns   = key ? key.respuestas : {};
  const ansGrid  = document.getElementById('modal-answers-grid');
  if (ansGrid) {
    ansGrid.innerHTML = '';
    const opts = r.tipo === 'PAES' ? ['A','B','C','D','E'] : ['A','B','C','D'];
    const total = r.numQ || Object.keys(r.respuestas || {}).length;

    for (let q = 1; q <= total; q++) {
      const sel = r.respuestas[q];
      const kA  = keyAns[q];
      let cls   = 'empty';
      if (sel && kA) cls = sel === kA ? 'correct' : 'wrong';
      else if (sel)  cls = 'selected';
      ansGrid.innerHTML += `
        <div class="modal-ans-cell">
          <div class="modal-ans-num">${q}</div>
          <div class="modal-ans-val ${cls}">${sel || '·'}</div>
        </div>`;
    }
  }

  document.getElementById('modal-overlay').style.display = 'flex';
}

function closeModal(e)  { if (e.target === document.getElementById('modal-overlay')) closeModalDirect(); }
function closeModalDirect() { document.getElementById('modal-overlay').style.display = 'none'; }

function deleteRecord() {
  if (!confirm('¿Eliminar este registro?')) return;
  state.records = state.records.filter(r => r.id !== state.detailRecordId);
  saveStorage();
  updateBadge();
  closeModalDirect();
  renderTable();
  showToast('Registro eliminado');
}

function printRecord() { window.print(); }

/* ──────────────────────────────────────────────────────────────
   SCORE CALCULATOR
   ────────────────────────────────────────────────────────────── */
function calcScore(respuestas, keyId, numQ) {
  const key = keyId ? state.keys.find(k => k.id === keyId) : null;
  if (!key) return null;
  let correct = 0, wrong = 0, blank = 0;
  for (let q = 1; q <= numQ; q++) {
    const sel = respuestas[q];
    const kA  = key.respuestas[q];
    if (!kA) continue;
    if (!sel) blank++;
    else if (sel === kA) correct++;
    else wrong++;
  }
  return { correct, wrong, blank, total: correct + wrong + blank };
}

/* ──────────────────────────────────────────────────────────────
   EXPORT CSV
   ────────────────────────────────────────────────────────────── */
function exportCSV() {
  if (!state.records.length) { showToast('No hay registros para exportar', 'error'); return; }

  const maxQ = Math.max(...state.records.map(r => r.numQ || 0));
  const headers = ['Tipo','Nombre','RUT','Curso','Asignatura','Evaluación','Fecha','Respondidas',
    'Correctas','Incorrectas','Blanco','Porcentaje'];
  for (let q = 1; q <= maxQ; q++) headers.push(`P${q}`);

  const rows = state.records.map(r => {
    const s = r.score || {};
    const pct = s.total ? Math.round(s.correct / s.total * 100) + '%' : '';
    const cols = [
      r.tipo, r.nombre || '', r.rut || '', r.curso || '', r.asig || '',
      r.evaluacion || '', r.fecha || '',
      r.answeredCount || 0,
      s.correct ?? '', s.wrong ?? '', s.blank ?? '', pct,
    ];
    for (let q = 1; q <= maxQ; q++) cols.push(r.respuestas?.[q] || '');
    return cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',');
  });

  const csv  = [headers.join(','), ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `EduResponse_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exportado', 'success');
}

/* ──────────────────────────────────────────────────────────────
   PLANTILLAS
   ────────────────────────────────────────────────────────────── */
function openTemplate(tipo) {
  window.open(`template-${tipo}.html`, '_blank');
}

/* ──────────────────────────────────────────────────────────────
   UTILITIES
   ────────────────────────────────────────────────────────────── */
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function typeBadgeHtml(tipo) {
  const map = {
    SIMCE : ['green-pill','SIMCE'],
    PAES  : ['amber-pill','PAES'],
    GLOBAL: ['purple-pill','Global'],
  };
  const [cls, label] = map[tipo] || ['purple-pill', tipo];
  return `<span class="card-badge ${cls}">${label}</span>`;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent  = msg;
  t.className    = 'toast show ' + type;
  setTimeout(() => t.className = 'toast', 3000);
}

function updateBadge() {
  const b = document.getElementById('badge-count');
  const n = state.records.length;
  if (!b) return;
  b.textContent    = n;
  b.style.display  = n > 0 ? 'inline-flex' : 'none';
}

function formatRut(input) {
  let v = input.value.replace(/[^0-9kK]/g, '').toUpperCase();
  if (v.length > 1) v = v.slice(0, -1) + '-' + v.slice(-1);
  if (v.length > 5) v = v.slice(0, -5) + '.' + v.slice(-5);
  if (v.length > 9) v = v.slice(0, -9) + '.' + v.slice(-9);
  input.value = v;
}

/* ──────────────────────────────────────────────────────────────
   BATCH CONFIG MANAGEMENT
   ────────────────────────────────────────────────────────────── */
function updateUploadConfigFields() {
  const tipo = state.homeType;
  const keySelect = document.getElementById('upload-key-select');
  const asigSelect = document.getElementById('upload-asig-select');
  const asigLibre = document.getElementById('upload-asig-libre');
  const cursoSelect = document.getElementById('upload-curso-select');
  const countGroup = document.getElementById('upload-count-group');

  if (!keySelect || !asigSelect || !cursoSelect) return;

  // 1. Populate Key selector
  keySelect.innerHTML = '<option value="">— Sin pauta (solo extraer respuestas) —</option>';
  const matchingKeys = state.keys.filter(k => k.tipo === tipo);
  matchingKeys.forEach(k => {
    keySelect.appendChild(new Option(k.nombre, k.id));
  });

  // 2. Populate Asignatura selector
  asigSelect.innerHTML = '';
  if (tipo === 'GLOBAL') {
    asigSelect.style.display = 'none';
    asigLibre.style.display = 'block';
  } else {
    asigSelect.style.display = 'block';
    asigLibre.style.display = 'none';
    asigSelect.innerHTML = '<option value="">— Seleccionar —</option>';
    const cfg = CONFIG[tipo];
    if (cfg && cfg.subjects) {
      cfg.subjects.forEach(s => {
        asigSelect.appendChild(new Option(s, s));
      });
    }
    asigSelect.appendChild(new Option('Otra asignatura...', 'OTRA'));
  }

  // 3. Populate Curso selector
  cursoSelect.innerHTML = '<option value="">— Seleccionar Curso —</option>';
  const cfg = CONFIG[tipo];
  const courses = tipo === 'GLOBAL' ? CONFIG.GLOBAL.courses : (cfg ? cfg.courses : []);
  courses.forEach(c => {
    cursoSelect.appendChild(new Option(c, c));
  });

  // 4. Show/hide count group
  if (countGroup) {
    countGroup.style.display = tipo === 'GLOBAL' ? 'block' : 'none';
  }
}

function handleUploadKeyChange() {
  const keyId = document.getElementById('upload-key-select').value;
  const asigSelect = document.getElementById('upload-asig-select');
  const asigLibre = document.getElementById('upload-asig-libre');
  const cursoSelect = document.getElementById('upload-curso-select');
  
  if (keyId) {
    const key = state.keys.find(k => k.id === Number(keyId));
    if (key) {
      // Pre-fill subject
      if (state.homeType === 'GLOBAL') {
        if (asigLibre) {
          asigLibre.value = key.asig || '';
        }
      } else {
        if (asigSelect) {
          const hasOption = Array.from(asigSelect.options).some(opt => opt.value === key.asig);
          if (hasOption) {
            asigSelect.value = key.asig;
            asigLibre.style.display = 'none';
          } else if (key.asig) {
            asigSelect.value = 'OTRA';
            asigLibre.value = key.asig;
            asigLibre.style.display = 'block';
          }
        }
      }

      // Pre-fill course
      if (cursoSelect && key.curso) {
        cursoSelect.value = key.curso;
      }

      // Pre-fill number of questions for GLOBAL
      if (state.homeType === 'GLOBAL') {
        setHomeGlobalCount(key.numQ);
      }
    }
  }
}

function handleUploadAsigChange() {
  const asigSelect = document.getElementById('upload-asig-select');
  const asigLibre = document.getElementById('upload-asig-libre');
  if (asigSelect && asigLibre) {
    asigLibre.style.display = asigSelect.value === 'OTRA' ? 'block' : 'none';
    if (asigSelect.value !== 'OTRA') {
      asigLibre.value = '';
    }
  }
}

/* ──────────────────────────────────────────────────────────────
   INIT
   ────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  console.log("EduResponse App Loaded - Version 3.1 (Chain of Thought Prompts v3)");
  loadStorage();
  updateBadge();

  // Set today's date
  const fd = document.getElementById('f-fecha');
  if (fd) fd.valueAsDate = new Date();

  showView('home');
  setHomeType('SIMCE');
});

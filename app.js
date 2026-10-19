(function () {
  'use strict';

  var MODEL = 'claude-sonnet-5-5';
  var API_URL = 'https://api.anthropic.com/v1/messages';
  var STORE_KEY = 'foddy-v1';
  var KEY_KEY = 'foddy-key';
  var DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  var DIAS_C = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  var MAX_FOTOS = 5;
  var nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
  var dfDia = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' });
  var dfCorto = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });

  function $(s, r) { return (r || document).querySelector(s); }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(el, k); }); return; }
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  function str(x) { return typeof x === 'string' ? x.trim() : (x == null ? '' : String(x)); }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function numOr(v, def) {
    var n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
    return isFinite(n) && n >= 0 ? n : def;
  }
  function fmtG(g) { return g == null ? 'sin dato' : '≈ ' + nf.format(g) + ' g'; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignorar */ } }

  /* ---------- Estado y almacenamiento (solo en este dispositivo) ---------- */
  function blank() {
    return {
      v: 1,
      settings: { edad: '2 años', alergias: '', aversiones: '', desayunoMeriendaG: '', tope: 16, tiempo: '', pediatra: '' },
      modelos: [],
      historial: [],
      ultimo: null
    };
  }
  function merge(src) {
    var out = blank();
    if (src && typeof src === 'object') {
      if (src.settings && typeof src.settings === 'object') Object.assign(out.settings, src.settings);
      if (Array.isArray(src.modelos)) out.modelos = src.modelos;
      if (Array.isArray(src.historial)) out.historial = src.historial;
      if (src.ultimo && typeof src.ultimo === 'object') out.ultimo = src.ultimo;
    }
    return out;
  }
  var state = blank();
  try { var raw = lsGet(STORE_KEY); if (raw) state = merge(JSON.parse(raw)); } catch (e) { /* datos dañados: se empieza en blanco */ }
  var apiKey = lsGet(KEY_KEY) || '';

  var saveTimer = null;
  function touch() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 500); }
  function flush() {
    saveTimer = null;
    var ok = lsSet(STORE_KEY, JSON.stringify(state));
    $('#status').textContent = ok ? '' : 'No se pueden guardar los datos en este navegador.';
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && saveTimer) { clearTimeout(saveTimer); flush(); }
  });

  /* ---------- Semana ---------- */
  function defaultMonday() {
    var d = new Date(); d.setHours(12, 0, 0, 0);
    var wd = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() + (wd >= 4 ? 7 - wd : -wd));
    return d;
  }
  function mondayOf(d) { var x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  function isoDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  var weekStart = defaultMonday();
  var festivos = new Set();
  function dayDate(i) { var d = new Date(weekStart); d.setDate(d.getDate() + i); return d; }

  function renderWeek() {
    $('#fecha').value = isoDate(weekStart);
    $('#semanaTxt').textContent = 'Semana del ' + dfDia.format(weekStart) + ' al ' + dfDia.format(dayDate(6)) + ' de ' + dayDate(6).getFullYear() + '.';
    var box = $('#dias');
    box.textContent = '';
    DIAS.forEach(function (n, i) {
      var finde = i >= 5;
      var casa = finde || festivos.has(i);
      box.append(h('button', {
        class: 'day', type: 'button', disabled: finde,
        'aria-pressed': finde ? null : String(festivos.has(i)),
        'aria-label': n + ' ' + dayDate(i).getDate() + ': ' + (casa ? 'comida y cena en casa' : 'cena en casa, comida en el cole'),
        onclick: function () {
          if (festivos.has(i)) festivos.delete(i); else festivos.add(i);
          renderWeek();
        }
      }, h('b', { text: DIAS_C[i] }), h('b', { text: String(dayDate(i).getDate()) }), h('span', { text: casa ? 'Casa' : 'Cole' })));
    });
  }
  $('#fecha').addEventListener('change', function (e) {
    var v = e.target.value;
    if (!v) return;
    var d = new Date(v + 'T12:00:00');
    if (isNaN(d.getTime())) return;
    weekStart = mondayOf(d);
    festivos.clear();
    renderWeek();
  });

  /* ---------- Fotos del menú del cole ---------- */
  var fotos = [];
  function renderThumbs() {
    var box = $('#thumbs');
    box.textContent = '';
    fotos.forEach(function (f, i) {
      var url = URL.createObjectURL(f);
      box.append(h('div', { class: 'thumb' },
        h('img', { src: url, alt: 'Foto ' + (i + 1) + ' del menú del colegio' }),
        h('button', {
          type: 'button', 'aria-label': 'Quitar foto ' + (i + 1),
          onclick: function () { URL.revokeObjectURL(url); fotos.splice(i, 1); renderThumbs(); }
        }, '×')));
    });
    $('#btnFotos').textContent = fotos.length ? 'Añadir otra foto' : 'Añadir foto o captura';
    $('#btnFotos').style.display = fotos.length >= MAX_FOTOS ? 'none' : '';
  }
  $('#fotos').addEventListener('change', function (e) {
    Array.prototype.slice.call(e.target.files || []).forEach(function (f) { if (fotos.length < MAX_FOTOS) fotos.push(f); });
    e.target.value = '';
    renderThumbs();
  });

  function cargarImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('imagen')); };
      img.src = url;
    });
  }
  // Reduce la foto y la convierte a JPEG para que pese poco y funcione con cualquier formato del iPhone.
  async function prepararImagen(file) {
    var src;
    try { src = await createImageBitmap(file); } catch (e) { src = await cargarImg(file); }
    var w = src.width || src.naturalWidth, hh = src.height || src.naturalHeight;
    var k = Math.min(1, 1600 / Math.max(w, hh));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(hh * k));
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  }

  /* ---------- Ajustes ---------- */
  var AJ = { sEdad: 'edad', sAlergias: 'alergias', sAversiones: 'aversiones', sPediatra: 'pediatra', sTope: 'tope', sDesayuno: 'desayunoMeriendaG', sTiempo: 'tiempo' };
  function renderSettings() {
    Object.keys(AJ).forEach(function (id) { $('#' + id).value = state.settings[AJ[id]] == null ? '' : state.settings[AJ[id]]; });
    renderClave();
  }
  Object.keys(AJ).forEach(function (id) {
    $('#' + id).addEventListener('input', function (e) { state.settings[AJ[id]] = e.target.value; touch(); });
  });

  /* ---------- Clave de API ---------- */
  function renderClave() {
    $('#avisoClave').hidden = !!apiKey;
    $('#claveMsg').textContent = apiKey ? 'Clave guardada en este dispositivo (termina en ' + apiKey.slice(-4) + ').' : 'Todavía no hay ninguna clave guardada.';
    $('#sClave').value = '';
    $('#btnBorrarClave').disabled = !apiKey;
  }
  $('#irAjustes').addEventListener('click', function () { selectTab('ajustes'); $('#sClave').focus(); });
  $('#btnBorrarClave').addEventListener('click', function () {
    apiKey = ''; lsDel(KEY_KEY); renderClave();
  });
  $('#btnClave').addEventListener('click', async function () {
    var k = $('#sClave').value.trim();
    var msg = $('#claveMsg');
    if (!k) { msg.textContent = 'Pega primero la clave de API.'; return; }
    if (!/^sk-ant-/.test(k)) { msg.textContent = 'La clave debería empezar por «sk-ant-». Revisa que la has copiado entera.'; return; }
    var btn = $('#btnClave');
    btn.disabled = true; msg.textContent = 'Probando la clave…';
    try {
      var res = await fetch(API_URL, {
        method: 'POST', headers: cabeceras(k),
        body: JSON.stringify({ model: MODEL, max_tokens: 64, messages: [{ role: 'user', content: 'Responde solo: ok' }] })
      });
      if (!res.ok) throw await errorHttp(res);
      apiKey = k;
      lsSet(KEY_KEY, k);
      renderClave();
      msg.textContent = 'Clave guardada y comprobada. Ya puedes generar menús.';
    } catch (e) {
      msg.textContent = textoError(e);
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------- Platos modelo ---------- */
  function renderModelos() {
    var box = $('#listaModelos');
    box.textContent = '';
    if (!state.modelos.length) {
      box.append(h('p', { class: 'empty', text: 'Todavía no hay ningún plato. Añade el primero arriba.' }));
      return;
    }
    state.modelos.forEach(function (m, i) {
      var armed = false, timer = null;
      var del = h('button', {
        class: 'btn line small', type: 'button', text: 'Quitar',
        onclick: function () {
          if (!armed) {
            armed = true; del.textContent = '¿Seguro? Toca otra vez';
            timer = setTimeout(function () { armed = false; del.textContent = 'Quitar'; }, 3500);
            return;
          }
          clearTimeout(timer);
          state.modelos.splice(i, 1);
          touch(); renderModelos();
        }
      });
      box.append(h('div', { class: 'model' }, h('b', { text: m.nombre }), del, m.notas ? h('p', { text: m.notas }) : null));
    });
  }
  $('#btnModelo').addEventListener('click', function () {
    var nombre = $('#mNombre').value.trim();
    var msg = $('#modeloMsg');
    if (!nombre) { msg.textContent = 'Escribe el nombre del plato.'; return; }
    state.modelos.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), nombre: nombre, notas: $('#mNotas').value.trim() });
    $('#mNombre').value = ''; $('#mNotas').value = '';
    msg.textContent = 'Plato añadido.';
    touch(); renderModelos();
  });

  /* ---------- Pestañas ---------- */
  var TABS = ['menu', 'modelos', 'ajustes'];
  function selectTab(name) {
    TABS.forEach(function (t) {
      $('#tab-' + t).setAttribute('aria-selected', String(t === name));
      $('#panel-' + t).hidden = t !== name;
    });
    if (name === 'menu') renderResultado(false);
    window.scrollTo(0, 0);
  }
  TABS.forEach(function (t) { $('#tab-' + t).addEventListener('click', function () { selectTab(t); }); });

  /* ---------- Llamada a Claude ---------- */
  function cabeceras(key) {
    return {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
  }
  async function errorHttp(res) {
    var message = '', type = '';
    try { var j = await res.json(); message = (j.error && j.error.message) || ''; type = (j.error && j.error.type) || ''; } catch (e) { /* sin cuerpo */ }
    return { http: res.status, type: type, message: message };
  }
  function textoError(e) {
    if (e && e.name === 'AbortError') return 'Generación detenida.';
    if (e && e.http) {
      var m = (e.message || '').toLowerCase();
      if (e.http === 401) return 'La clave de API no es válida. Revísala en Ajustes.';
      if (e.http === 403) return 'Tu clave no tiene permiso para usar este modelo.';
      if (e.http === 404) return 'El modelo no está disponible con tu clave.';
      if (e.http === 413) return 'Las fotos pesan demasiado. Prueba con menos fotos o capturas más pequeñas.';
      if (e.http === 429) return 'Se ha alcanzado el límite de uso o de gasto de tu cuenta. Espera un rato o revisa los límites en la consola de Anthropic.';
      if (e.http === 400 && m.indexOf('credit balance') >= 0) return 'Tu cuenta de API no tiene saldo. Añade crédito en la consola de Anthropic.';
      if (e.http === 529 || e.http >= 500) return 'Los servidores de Anthropic están saturados. Inténtalo de nuevo en unos minutos.';
      return 'Anthropic ha rechazado la petición (' + e.http + ').' + (e.message ? ' ' + e.message : '');
    }
    if (e && e.code === 'invalid_json') return 'La respuesta no ha llegado con el formato esperado. Pulsa de nuevo el botón para reintentarlo.';
    if (e && e.code === 'truncated') return 'La respuesta se ha cortado por ser demasiado larga. Vuelve a intentarlo.';
    if (e && e.code === 'refusal') return 'Claude no ha podido generar el menú con estos datos. Revisa las fotos y las notas e inténtalo otra vez.';
    if (e && e.code === 'stream') return 'La conexión se ha interrumpido durante la respuesta.' + (e.message ? ' ' + e.message : '');
    if (e && e.code === 'imagen') return 'No se ha podido leer alguna de las fotos. Prueba con otra captura.';
    return 'No se ha podido conectar. Comprueba tu conexión a internet, mantén la app abierta mientras se genera y vuelve a intentarlo.';
  }

  // Envía la petición con streaming y devuelve el texto completo.
  async function pedirMenu(content, signal, onProgreso) {
    var res = await fetch(API_URL, {
      method: 'POST', headers: cabeceras(apiKey), signal: signal,
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 32000,
        stream: true,
        output_config: { effort: 'medium' },
        messages: [{ role: 'user', content: content }]
      })
    });
    if (!res.ok) throw await errorHttp(res);
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = '', text = '', stop = null;
    function evento(bloque) {
      var data = '';
      bloque.split('\n').forEach(function (l) { if (l.indexOf('data:') === 0) data += l.slice(5).trim(); });
      if (!data) return;
      var j;
      try { j = JSON.parse(data); } catch (e) { return; }
      if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta') {
        text += j.delta.text; onProgreso(text.length);
      } else if (j.type === 'message_delta' && j.delta && j.delta.stop_reason) {
        stop = j.delta.stop_reason;
      } else if (j.type === 'error') {
        throw { code: 'stream', message: (j.error && j.error.message) || '' };
      }
    }
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true }).replace(/\r\n/g, '\n');
      var i;
      while ((i = buf.indexOf('\n\n')) >= 0) { evento(buf.slice(0, i)); buf = buf.slice(i + 2); }
    }
    if (buf.trim()) evento(buf);
    if (stop === 'refusal') throw { code: 'refusal' };
    if (stop === 'max_tokens') throw { code: 'truncated' };
    return text;
  }
  function extraerJson(text) {
    var a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a < 0 || b <= a) throw { code: 'invalid_json' };
    try { return JSON.parse(text.slice(a, b + 1)); } catch (e) { throw { code: 'invalid_json' }; }
  }

  /* ---------- Instrucciones para Claude ---------- */
  function buildPrompt(texto, nota, nFotos) {
    var s = state.settings;
    var tope = numOr(s.tope, 16);
    var dm = numOr(s.desayunoMeriendaG, 0);
    var hoy = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    var dias = DIAS.map(function (n, i) {
      var casa = i >= 5 || festivos.has(i);
      return '- ' + n + ' ' + isoDate(dayDate(i)) + ': ' + (casa
        ? 'COMIDA Y CENA en casa' + (i < 5 ? ' (festivo o sin colegio)' : '')
        : 'solo CENA en casa (la comida es la del colegio)');
    }).join('\n');
    var modelos = state.modelos.length
      ? state.modelos.map(function (m) { return '- ' + m.nombre + (m.notas ? ': ' + m.notas : ''); }).join('\n')
      : '(ninguno todavía)';
    var hist = state.historial.length
      ? state.historial.map(function (x) { return '- Semana del ' + x.semana + ': ' + arr(x.platos).join('; '); }).join('\n')
      : '(sin historial)';
    var cole = '';
    if (nFotos) cole += 'Se adjuntan ' + nFotos + ' imagen(es) con el menú del colegio de esta semana. Léelas con atención y no completes con suposiciones lo que no se lea.\n';
    if (texto) cole += 'Texto del menú del colegio:\n' + texto + '\n';
    if (!cole) cole = '(no hay menú del colegio: todos los días son en casa)';

    return [
      'Eres un asistente de planificación de menús infantiles para una niña de ' + (s.edad || '2 a 3 años') + '. Escribe en español de España, con un tono claro y cercano, sin tecnicismos. No inventes datos: si algo no se puede leer o no lo sabes, dilo en "preguntas" o en "suposiciones".',
      'Hoy es ' + hoy + '.',
      'SEMANA A PLANIFICAR:\n' + dias,
      'DATOS DE LA NIÑA:\n- Alergias e intolerancias: ' + (s.alergias || 'ninguna indicada') +
        '\n- Alimentos que rechaza: ' + (s.aversiones || 'ninguno indicado') +
        '\n- Proteína animal fija de desayuno y merienda (lácteos, huevo, embutido): ' + dm + ' g al día. Ya cuenta dentro del tope; no la sumes en tus platos.' +
        '\n- Tiempo para cocinar entre semana: ' + (s.tiempo || 'no indicado') +
        '\n- Indicaciones del pediatra: ' + (s.pediatra || 'ninguna indicada'),
      'REGLAS, POR ORDEN DE PRIORIDAD:\n' +
        '1. Seguridad: respeta alergias y aversiones; texturas adecuadas a la edad (nada de frutos secos enteros, uvas o cerezas sin trocear, ni trozos duros crudos); sin pescados grandes con riesgo de mercurio (pez espada, tintorera, atún rojo, lucio); poca sal; sin miel.\n' +
        '2. Tope de proteína animal: ' + tope + ' g como máximo al día, sumando colegio, comida, cena y desayuno/merienda fijos. Proteína animal es la de carne, pescado, huevo y lácteos. Estima los gramos con raciones propias de la edad y valores de composición reconocidos (por ejemplo BEDCA) o el etiquetado. Del colegio no se conocen las raciones: estima una ración infantil estándar y devuelve igualmente un número. Si el colegio ya llega o casi llega al tope, pon una cena sin proteína animal.\n' +
        '3. Si la comida (del colegio o de casa) lleva proteína animal, la cena prioriza la proteína vegetal (legumbres, cereales integrales, tofu, cremas de frutos secos o semillas molidas). Si la comida ya es vegetal, la cena puede llevar una ración pequeña animal sin pasar del tope.\n' +
        '4. Complementa el menú del colegio: no repitas su ingrediente principal ni su técnica de cocinado el mismo día ni el día siguiente. Equilibra la semana entre verdura, fruta, legumbres, cereales, pescado, huevo y carne.\n' +
        '5. Fruta y verdura de temporada en España según el mes de las fechas de la semana. Si dudas de la temporada de un producto, dilo.\n' +
        '6. Sin ultraprocesados (NOVA 4: embutidos, salchichas, nuggets, galletas, cereales azucarados, zumos envasados, yogures de sabores, salsas comerciales, caldos concentrados), sin azúcares añadidos y sin edulcorantes. Endulza solo con la propia fruta.\n' +
        '7. Usa los platos modelo como inspiración de sabores y texturas, sin repetir el mismo más de una vez por semana. Si alguno incumple una regla, adáptalo y avísalo en "suposiciones".',
      'PLATOS MODELO DE LA FAMILIA:\n' + modelos,
      'PLATOS DE SEMANAS ANTERIORES (varía respecto a ellos):\n' + hist,
      'MENÚ DEL COLEGIO:\n' + cole,
      nota ? 'NOTA DE LA FAMILIA PARA ESTA SEMANA:\n' + nota : '',
      'FORMATO DE LA RESPUESTA: responde SOLO con un objeto JSON, sin texto antes ni después, con esta forma:\n' +
        '{\n' +
        '  "resumen": "2 o 3 frases sobre la lógica de la semana",\n' +
        '  "dias": [ {\n' +
        '    "dia": "Lunes", "fecha": "AAAA-MM-DD",\n' +
        '    "cole": {"plato": "lo que se lee en el menú del colegio", "proteina_animal_g": 7.5},\n' +
        '    "comida": null,\n' +
        '    "cena": { "nombre": "", "ingredientes": ["200 g de calabaza"], "elaboracion": "dos o tres líneas", "proteina_animal_g": 0, "base_vegetal": true, "nota": "textura o seguridad, opcional" },\n' +
        '    "temporada": ["calabaza", "mandarina"]\n' +
        '  } ],\n' +
        '  "comprobaciones": [ {"regla": "Tope de proteína animal", "cumple": true, "detalle": "una frase"} ],\n' +
        '  "lista_compra": [ {"seccion": "Verduras y frutas", "items": ["calabaza"]} ],\n' +
        '  "suposiciones": ["..."],\n' +
        '  "preguntas": ["..."]\n' +
        '}\n' +
        'Incluye los 7 días en orden. En los días con colegio "comida" es null y "cole" lleva el plato del colegio; en los días en casa "cole" es null y "comida" tiene la misma forma que "cena". Los gramos son números con punto decimal. En "comprobaciones" incluye al menos: tope de proteína animal, relación comida/cena, complemento del colegio, temporada, ausencia de ultraprocesados y azúcares, y seguridad de texturas.'
    ].filter(Boolean).join('\n\n');
  }

  function plato(p, esCole) {
    if (!p || typeof p !== 'object') return null;
    var g = Number(p.proteina_animal_g);
    g = isFinite(g) && g >= 0 ? g : null;
    if (esCole) return { nombre: str(p.plato || p.nombre), g: g };
    return {
      nombre: str(p.nombre || p.plato), ingredientes: arr(p.ingredientes).map(str).filter(Boolean),
      elaboracion: str(p.elaboracion), g: g, vegetal: p.base_vegetal === true, nota: str(p.nota)
    };
  }
  function normalizar(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.dias) || !d.dias.length) throw { code: 'invalid_json' };
    return {
      resumen: str(d.resumen),
      dias: d.dias.map(function (x) {
        x = x || {};
        return { dia: str(x.dia), fecha: str(x.fecha), cole: plato(x.cole, true), comida: plato(x.comida), cena: plato(x.cena), temporada: arr(x.temporada).map(str).filter(Boolean) };
      }),
      comprobaciones: arr(d.comprobaciones).map(function (c) { c = c || {}; return { regla: str(c.regla), cumple: c.cumple === true, detalle: str(c.detalle) }; }),
      lista_compra: arr(d.lista_compra).map(function (s) { s = s || {}; return { seccion: str(s.seccion), items: arr(s.items).map(str).filter(Boolean) }; }),
      suposiciones: arr(d.suposiciones).map(str).filter(Boolean),
      preguntas: arr(d.preguntas).map(str).filter(Boolean)
    };
  }

  /* ---------- Generar ---------- */
  function showEstado(msg, kind) {
    var el = $('#estado');
    el.hidden = !msg;
    el.className = 'estado' + (kind ? ' ' + kind : '');
    el.textContent = msg || '';
  }
  var ctl = null, timer = null;
  function setBusy(on) {
    $('#btnGenerar').disabled = on;
    $('#btnParar').hidden = !on;
    clearInterval(timer);
    if (on) {
      var t0 = Date.now();
      var progreso = 0;
      var tick = function () {
        var seg = Math.round((Date.now() - t0) / 1000);
        showEstado('Preparando el menú… ' + seg + ' s' + (progreso ? ' · ' + progreso + ' caracteres recibidos' : '') + '. Mantén la app abierta; puede tardar un minuto.');
      };
      setBusy.onProgreso = function (n) { progreso = n; };
      tick();
      timer = setInterval(tick, 1000);
    }
  }
  $('#btnParar').addEventListener('click', function () { if (ctl) ctl.abort(); });

  $('#btnGenerar').addEventListener('click', async function () {
    if (!apiKey) { selectTab('ajustes'); $('#claveMsg').textContent = 'Primero guarda tu clave de API.'; return; }
    var hayCole = [0, 1, 2, 3, 4].some(function (i) { return !festivos.has(i); });
    var texto = $('#textoCole').value.trim();
    var nota = $('#notaSemana').value.trim();
    if (hayCole && !fotos.length && !texto) {
      showEstado('Añade una foto o pega el texto del menú del colegio para empezar.', 'warn');
      return;
    }
    ctl = new AbortController();
    setBusy(true);
    var estadoFinal = null;
    try {
      var content = [];
      for (var i = 0; i < fotos.length; i++) {
        var data;
        try { data = await prepararImagen(fotos[i]); } catch (e) { throw { code: 'imagen' }; }
        content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: data } });
      }
      content.push({ type: 'text', text: buildPrompt(texto, nota, fotos.length) });
      var respuesta = await pedirMenu(content, ctl.signal, function (n) { if (setBusy.onProgreso) setBusy.onProgreso(n); });
      var res = normalizar(extraerJson(respuesta));
      var semana = isoDate(weekStart);
      var platos = [];
      res.dias.forEach(function (x) { if (x.comida && x.comida.nombre) platos.push(x.comida.nombre); if (x.cena && x.cena.nombre) platos.push(x.cena.nombre); });
      state.historial = [{ semana: semana, platos: platos }].concat(state.historial.filter(function (x) { return x.semana !== semana; })).slice(0, 4);
      state.ultimo = { semana: semana, resultado: res };
      touch();
      renderResultado(true);
    } catch (e) {
      estadoFinal = { msg: textoError(e), kind: e && e.name === 'AbortError' ? '' : 'bad' };
    } finally {
      setBusy(false);
      showEstado(estadoFinal ? estadoFinal.msg : '', estadoFinal ? estadoFinal.kind : '');
    }
  });

  /* ---------- Resultado ---------- */
  var ICON_OK = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M6.5 10.5l2.5 2.5 4.5-5"/></svg>';
  var ICON_NO = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2.5l8 14H2z"/><path d="M10 8v4M10 14.2v.1"/></svg>';
  function icon(svg) { var s = document.createElement('span'); s.innerHTML = svg; return s.firstChild; }
  function chip(text, kind) { return h('span', { class: 'chip' + (kind ? ' ' + kind : ''), text: text }); }

  function mealBlock(label, p) {
    var box = h('div', { class: 'meal' }, h('div', { class: 'meal-label', text: label }), h('div', { class: 'meal-name', text: p.nombre || 'Sin nombre' }));
    if (p.ingredientes.length) box.append(h('ul', { class: 'ing' }, p.ingredientes.map(function (i) { return h('li', { text: i }); })));
    if (p.elaboracion) box.append(h('p', { class: 'elab', text: p.elaboracion }));
    if (p.nota) box.append(h('p', { class: 'nota', text: p.nota }));
    box.append(h('div', { class: 'chips' }, chip('Proteína animal ' + fmtG(p.g)), p.vegetal ? chip('Base vegetal', 'ok') : null));
    return box;
  }
  function dayTotal(x, dm) { return ((x.cole && x.cole.g) || 0) + ((x.comida && x.comida.g) || 0) + ((x.cena && x.cena.g) || 0) + dm; }

  function renderResultado(scroll) {
    var box = $('#resultado');
    box.textContent = '';
    if (!state.ultimo || !state.ultimo.resultado) {
      box.append(h('div', { class: 'block' }, h('h2', { text: 'Tu menú aparecerá aquí' }),
        h('p', { class: 'hint', text: 'Elige la semana, sube el menú del colegio y pulsa «Generar menú de la semana». Antes de empezar, revisa los datos de tu hija en Ajustes.' })));
      return;
    }
    var res = state.ultimo.resultado;
    var tope = numOr(state.settings.tope, 16);
    var dm = numOr(state.settings.desayunoMeriendaG, 0);
    var over = res.dias.filter(function (x) { return dayTotal(x, dm) > tope; });
    var ini = new Date(state.ultimo.semana + 'T12:00:00');

    box.append(h('div', { class: 'res-head' },
      h('h2', { text: 'Menú de la semana' }),
      isNaN(ini.getTime()) ? null : h('p', { class: 'when', text: 'Semana del ' + dfDia.format(ini) + ' · generado con los ajustes actuales' }),
      res.resumen ? h('p', { text: res.resumen }) : null));

    if (res.preguntas.length) {
      box.append(h('div', { class: 'estado warn', style: 'margin-top:12px' }, h('b', { text: 'Antes de usar este menú' }),
        h('ul', { class: 'plain' }, res.preguntas.map(function (q) { return h('li', { text: q }); }))));
    }
    if (over.length) {
      box.append(h('div', { class: 'estado bad', style: 'margin-top:12px' },
        'Por encima del tope de ' + nf.format(tope) + ' g: ' + over.map(function (x) { return x.dia; }).join(', ') + '. Revisa esos días o vuelve a generar el menú.'));
    }
    if (dm === 0) {
      box.append(h('div', { class: 'estado', style: 'margin-top:12px' }, 'La proteína de desayuno y merienda está en 0 g. Si toma lácteos o huevo, indícalo en Ajustes para que el total sea real.'));
    }

    var list = h('div', { style: 'display:grid;gap:16px;margin-top:16px' });
    res.dias.forEach(function (x) {
      var total = dayTotal(x, dm);
      var ratio = tope > 0 ? total / tope : 0;
      var kind = ratio > 1 ? 'bad' : ratio > 0.85 ? 'warn' : '';
      var stateTxt = ratio > 1 ? 'Supera el tope' : ratio > 0.85 ? 'Cerca del tope' : 'Dentro del tope';
      var f = new Date(x.fecha + 'T12:00:00');
      var card = h('article', { class: 'day-card' },
        h('div', { class: 'day-top' }, h('h3', { text: x.dia + (isNaN(f.getTime()) ? '' : ' ' + dfCorto.format(f)) }),
          h('span', { class: 'tag', text: x.cole ? 'Día de cole' : 'Comida y cena en casa' })),
        h('div', { class: 'meter-wrap' },
          h('div', { class: 'meter-text' }, h('span', null, 'Proteína animal del día ', h('b', { text: '≈ ' + nf.format(total) + ' de ' + nf.format(tope) + ' g' })),
            h('span', { class: 'state-' + (kind || 'ok'), text: stateTxt })),
          h('div', { class: 'meter ' + kind, role: 'img', 'aria-label': 'Proteína animal ' + nf.format(total) + ' gramos de ' + nf.format(tope) }, h('i', { style: 'width:' + Math.min(100, Math.round(ratio * 100)) + '%' }))));
      if (x.cole) {
        card.append(h('div', { class: 'meal cole' }, h('div', { class: 'meal-label', text: 'Colegio (comida)' }),
          h('div', { class: 'meal-name', text: x.cole.nombre || 'Sin leer' }), h('div', { class: 'chips' }, chip('Estimado ' + fmtG(x.cole.g)))));
      }
      if (dm > 0) {
        card.append(h('div', { class: 'meal cole' }, h('div', { class: 'meal-label', text: 'Desayuno y merienda (ajustes)' }), h('div', { class: 'chips' }, chip(fmtG(dm)))));
      }
      if (x.comida) card.append(mealBlock('Comida', x.comida));
      if (x.cena) card.append(mealBlock('Cena', x.cena));
      if (x.temporada.length) card.append(h('div', { class: 'chips' }, x.temporada.map(function (t) { return chip('De temporada: ' + t, 'season'); })));
      list.append(card);
    });
    box.append(list);

    box.append(h('div', { class: 'row', style: 'margin-top:16px' },
      h('button', { class: 'btn secondary', type: 'button', text: 'Copiar menú', onclick: function (e) { copiar(textoMenu(res, dm), e.currentTarget, '#copiaMsg'); } }),
      h('button', { class: 'btn line', type: 'button', text: 'Generar otra versión', onclick: function () { $('#btnGenerar').click(); } })));
    box.append(h('p', { class: 'hint', id: 'copiaMsg', role: 'status' }));

    if (res.comprobaciones.length) {
      box.append(h('details', null, h('summary', { text: 'Comprobaciones del asistente' }),
        h('div', null, res.comprobaciones.map(function (c) {
          return h('div', { class: 'check ' + (c.cumple ? 'ok' : 'no') }, icon(c.cumple ? ICON_OK : ICON_NO), h('div', null, h('b', { text: c.regla }), h('span', { text: c.detalle })));
        }))));
    }
    if (res.lista_compra.length) {
      box.append(h('details', null, h('summary', { text: 'Lista de la compra' }),
        h('div', { class: 'shop' }, res.lista_compra.map(function (s) {
          return h('div', null, h('h4', { text: s.seccion }), h('ul', { class: 'plain' }, s.items.map(function (i) { return h('li', { text: i }); })));
        }), h('button', { class: 'btn secondary small', type: 'button', text: 'Copiar lista', style: 'justify-self:start', onclick: function (e) { copiar(textoCompra(res), e.currentTarget, '#copiaMsg'); } }))));
    }
    if (res.suposiciones.length) {
      box.append(h('details', null, h('summary', { text: 'Suposiciones que se han hecho' }),
        h('div', null, h('ul', { class: 'plain' }, res.suposiciones.map(function (q) { return h('li', { text: q }); })))));
    }
    if (scroll) box.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  function textoMenu(res, dm) {
    var out = ['MENÚ DE LA SEMANA'];
    res.dias.forEach(function (x) {
      out.push('', x.dia.toUpperCase() + (x.fecha ? ' (' + x.fecha + ')' : ''));
      if (x.cole) out.push('Cole: ' + x.cole.nombre);
      if (x.comida) out.push('Comida: ' + x.comida.nombre + (x.comida.ingredientes.length ? ' — ' + x.comida.ingredientes.join(', ') : ''));
      if (x.cena) out.push('Cena: ' + x.cena.nombre + (x.cena.ingredientes.length ? ' — ' + x.cena.ingredientes.join(', ') : ''));
      out.push('Proteína animal del día: ' + fmtG(dayTotal(x, dm)));
    });
    return out.join('\n');
  }
  function textoCompra(res) {
    var out = ['LISTA DE LA COMPRA'];
    res.lista_compra.forEach(function (s) { out.push('', s.seccion.toUpperCase()); s.items.forEach(function (i) { out.push('- ' + i); }); });
    return out.join('\n');
  }
  function copiar(texto, btn, msgSel) {
    var msg = $(msgSel);
    function fallback() {
      var ta = $('#copiaManual');
      if (!ta) {
        ta = h('textarea', { id: 'copiaManual', readonly: true, 'aria-label': 'Texto para copiar' });
        btn.parentNode.after(ta);
      }
      ta.value = texto; ta.focus(); ta.select();
      if (msg) msg.textContent = 'Selecciona y copia el texto de la caja.';
    }
    try {
      navigator.clipboard.writeText(texto).then(function () {
        if (msg) msg.textContent = 'Copiado. Ya puedes pegarlo donde quieras.';
      }, fallback);
    } catch (e) { fallback(); }
  }

  /* ---------- Copia de seguridad ---------- */
  $('#btnCopiaGuardar').addEventListener('click', function (e) {
    var copia = JSON.stringify({ app: 'foddy', v: 1, datos: state });
    copiar(copia, e.currentTarget, '#copiaMsgAjustes');
  });
  $('#btnCopiaRestaurar').addEventListener('click', function () {
    var msg = $('#copiaMsgAjustes');
    try {
      var j = JSON.parse($('#copiaTexto').value.trim());
      if (!j || j.app !== 'foddy' || !j.datos) throw new Error('formato');
      state = merge(j.datos);
      flush();
      renderAll();
      $('#copiaTexto').value = '';
      msg.textContent = 'Copia restaurada.';
    } catch (e) {
      msg.textContent = 'Ese texto no es una copia de seguridad de Foddy.';
    }
  });

  /* ---------- Arranque ---------- */
  function renderAll() {
    renderSettings(); renderWeek(); renderThumbs(); renderModelos(); renderResultado(false);
  }
  renderAll();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* sin funcionamiento sin conexión */ });
    });
  }
})();

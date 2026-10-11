(function () {
  'use strict';

  var API_URL = (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '';
  var configured = API_URL.indexOf('script.google.com') !== -1 || API_URL.indexOf('script.googleusercontent.com') !== -1;
  var photoFile = null;
  var results = [];

  function $(id) {
    return document.getElementById(id);
  }

  async function api(action, body, method) {
    var t0 = performance.now();
    var res;
    if (method === 'GET') {
      res = await fetch(API_URL + '?action=' + encodeURIComponent(action), { method: 'GET', redirect: 'follow' });
    } else {
      // text/plain evita la petición previa (preflight) que Apps Script no soporta.
      res = await fetch(API_URL, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action: action }, body || {}))
      });
    }
    var text = await res.text();
    var ms = Math.round(performance.now() - t0);
    var json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error('Respuesta que no es JSON (revisa que el acceso sea "Anyone"): ' + text.slice(0, 100));
    }
    return { json: json, ms: ms, status: res.status };
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        resolve(String(fr.result).split(',')[1]);
      };
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }

  async function makePhoto() {
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    var source;
    if (photoFile) {
      var bitmap = await createImageBitmap(photoFile);
      var scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      source = 'tu foto';
    } else {
      canvas.width = 1600;
      canvas.height = 1000;
      var g = ctx.createLinearGradient(0, 0, 1600, 1000);
      g.addColorStop(0, '#1c212d');
      g.addColorStop(1, '#e0b14a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1600, 1000);
      var seed = 12345;
      var rnd = function () {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
      };
      for (var i = 0; i < 1800; i++) {
        ctx.fillStyle = 'hsla(' + Math.floor(rnd() * 360) + ',60%,' + (30 + Math.floor(rnd() * 40)) + '%,0.5)';
        ctx.fillRect(rnd() * 1600, rnd() * 1000, 10 + rnd() * 60, 6 + rnd() * 40);
      }
      source = 'imagen sintética';
    }
    var blob = await new Promise(function (res) {
      canvas.toBlob(res, 'image/jpeg', 0.8);
    });
    var b64 = await blobToBase64(blob);
    return { blob: blob, b64: b64, width: canvas.width, height: canvas.height, source: source };
  }

  function kb(n) {
    return (n / 1024).toFixed(0) + ' KB';
  }

  async function t1() {
    var r = await api('ping', {}, 'GET');
    return { status: r.json.ok ? 'pass' : 'fail', ms: r.ms, detail: 'Hora del servidor: ' + r.json.serverTime };
  }

  async function t2() {
    var r = await api('echo', { message: 'hola' });
    return { status: r.json.ok && r.json.echo === 'hola' ? 'pass' : 'fail', ms: r.ms, detail: 'Eco recibido: ' + r.json.echo };
  }

  async function t3() {
    var times = [];
    for (var i = 0; i < 6; i++) {
      var r = await api('ping', {}, 'GET');
      if (!r.json.ok) return { status: 'fail', detail: 'Falló el ping ' + (i + 1) };
      times.push(r.ms);
    }
    var sorted = times.slice().sort(function (a, b) {
      return a - b;
    });
    var median = sorted[Math.floor(sorted.length / 2)];
    return {
      status: median < 3000 ? 'pass' : 'warn',
      detail: 'Primera: ' + times[0] + ' ms | mediana: ' + median + ' ms | máx: ' + sorted[sorted.length - 1] + ' ms'
    };
  }

  async function t4() {
    var sizes = [100, 500, 1024, 2048, 4096];
    var lines = [];
    var okCount = 0;
    for (var i = 0; i < sizes.length; i++) {
      var data = 'A'.repeat(sizes[i] * 1024);
      try {
        var r = await api('payload', { data: data });
        var ok = r.json.ok && r.json.receivedChars === data.length;
        lines.push(kb(sizes[i] * 1024) + ': ' + (ok ? 'OK' : 'FALLÓ') + ' (' + r.ms + ' ms)');
        if (!ok) break;
        okCount++;
      } catch (e) {
        lines.push(kb(sizes[i] * 1024) + ': FALLÓ (' + e.message.slice(0, 60) + ')');
        break;
      }
    }
    var status = okCount === sizes.length ? 'pass' : okCount > 0 ? 'warn' : 'fail';
    return { status: status, detail: lines.join(' | ') };
  }

  async function t5() {
    var r = await api('sheetRoundTrip');
    return { status: r.json.ok && r.json.match ? 'pass' : 'fail', ms: r.ms, detail: r.json.ok ? 'Filas en la hoja de prueba: ' + r.json.rows : String(r.json.error) };
  }

  async function t6() {
    var photo = await makePhoto();
    var r = await api('driveRoundTrip', { data: photo.b64, mime: 'image/jpeg', returnData: true });
    if (!r.json.ok) return { status: 'fail', detail: String(r.json.error) };
    var preview = $('preview');
    preview.textContent = '';
    var img = document.createElement('img');
    img.alt = 'Foto devuelta por la API';
    img.src = 'data:' + r.json.mime + ';base64,' + r.json.data;
    preview.appendChild(img);
    var status = r.json.match ? (r.ms > 8000 ? 'warn' : 'pass') : 'fail';
    return {
      status: status,
      ms: r.ms,
      detail: photo.source + ' ' + photo.width + 'x' + photo.height + ', ' + kb(photo.blob.size) + ' subida y devuelta; bytes coinciden: ' + r.json.match
    };
  }

  async function t7() {
    var r = await api('servicesCheck');
    return { status: r.json.ok && r.json.cache && r.json.lock ? 'pass' : 'fail', ms: r.ms, detail: 'CacheService: ' + r.json.cache + ' | LockService: ' + r.json.lock };
  }

  async function t8() {
    var ls = false;
    try {
      localStorage.setItem('ds-test', '1');
      ls = localStorage.getItem('ds-test') === '1';
      localStorage.removeItem('ds-test');
    } catch (e) {
      ls = false;
    }
    var canv = !!document.createElement('canvas').toBlob;
    var ok = ls && typeof fetch === 'function' && canv;
    return { status: ok ? 'pass' : 'fail', detail: 'localStorage: ' + ls + ' | fetch: ' + (typeof fetch === 'function') + ' | canvas.toBlob: ' + canv };
  }

  var TESTS = [
    { id: 'T1', title: 'GET ping (lectura entre sitios, CORS)', run: t1 },
    { id: 'T2', title: 'POST text/plain: eco en JSON', run: t2 },
    { id: 'T3', title: 'Latencia: 6 pings seguidos', run: t3 },
    { id: 'T4', title: 'Escalera de tamaño (100 KB a 4 MB)', run: t4 },
    { id: 'T5', title: 'Hoja de cálculo: escribir y leer', run: t5 },
    { id: 'T6', title: 'Drive: guardar foto, leerla y mostrarla', run: t6 },
    { id: 'T7', title: 'Caché y bloqueos', run: t7 },
    { id: 'T8', title: 'Navegador: localStorage, fetch, canvas', run: t8 }
  ];

  function renderRows() {
    var box = $('rows');
    box.textContent = '';
    TESTS.forEach(function (t) {
      var res = results.filter(function (r) {
        return r.id === t.id;
      })[0];
      var row = document.createElement('div');
      row.className = 'row';
      var badge = document.createElement('span');
      var st = res ? res.status : 'idle';
      badge.className = 'badge ' + st;
      badge.textContent = { idle: 'PENDING', run: 'RUNNING', pass: 'PASS', warn: 'WARN', fail: 'FAIL' }[st];
      var main = document.createElement('div');
      main.className = 'main';
      var title = document.createElement('div');
      title.className = 'title';
      title.textContent = t.id + ' · ' + t.title + (res && res.ms ? '  (' + res.ms + ' ms)' : '');
      var detail = document.createElement('div');
      detail.className = 'detail';
      detail.textContent = res ? res.detail || '' : '';
      main.appendChild(title);
      main.appendChild(detail);
      row.appendChild(badge);
      row.appendChild(main);
      box.appendChild(row);
    });
  }

  function summaryText() {
    var host = API_URL.indexOf('script.google.com') !== -1 ? 'script.google.com/macros/s/.../exec' : 'no configurada';
    var lines = [
      'Decklist Showcase - fase 0',
      'Fecha: ' + new Date().toISOString(),
      'Página: ' + location.origin + location.pathname,
      'API: ' + host,
      'Navegador: ' + navigator.userAgent,
      ''
    ];
    TESTS.forEach(function (t) {
      var res = results.filter(function (r) {
        return r.id === t.id;
      })[0];
      lines.push(t.id + ' ' + t.title + ': ' + (res ? res.status.toUpperCase() : 'PENDING') + (res && res.ms ? ' (' + res.ms + ' ms)' : '') + (res && res.detail ? ' - ' + res.detail : ''));
    });
    return lines.join('\n');
  }

  async function runAll() {
    if (!configured) return;
    $('run').disabled = true;
    results = [];
    $('preview').textContent = '';
    for (var i = 0; i < TESTS.length; i++) {
      var t = TESTS[i];
      results.push({ id: t.id, status: 'run', detail: 'Ejecutando...' });
      renderRows();
      var out;
      try {
        out = await t.run();
      } catch (e) {
        out = { status: 'fail', detail: String(e && e.message ? e.message : e) };
      }
      results[results.length - 1] = Object.assign({ id: t.id }, out);
      renderRows();
    }
    $('out').value = summaryText();
    $('outwrap').hidden = false;
    $('run').disabled = false;
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderRows();
    $('cfg').textContent = configured ? 'API configurada' : 'Falta pegar la URL de la API en config.js';
    $('cfg').className = 'cfg ' + (configured ? 'ok' : 'bad');
    $('run').disabled = !configured;
    $('run').addEventListener('click', runAll);
    $('photo').addEventListener('change', function (e) {
      photoFile = e.target.files && e.target.files[0] ? e.target.files[0] : null;
    });
    $('copy').addEventListener('click', function () {
      var ta = $('out');
      ta.select();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(ta.value);
      } else {
        document.execCommand('copy');
      }
      $('copy').textContent = 'Copiado';
    });
  });
})();

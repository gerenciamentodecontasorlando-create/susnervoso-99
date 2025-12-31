/* BTX Prontuário Offline - single file app logic (no deps) */
(() => {
  "use strict";

  // ---------- tiny helpers ----------
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
  const fmtDateTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleString("pt-BR");
  };
  const fmtDate = (ts) => {
    const d = new Date(ts);
    return d.toLocaleDateString("pt-BR");
  };
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(16).slice(2) + Date.now();
  const escapeHtml = (s="") => (""+s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const toast = (msg) => {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._tm);
    toast._tm = setTimeout(() => t.classList.remove("show"), 2400);
  };

  // ---------- IndexedDB wrapper ----------
  const DB_NAME = "btx_prontuario_db";
  const DB_VERSION = 1;
  const STORES = {
    patients: { keyPath: "id" },
    events: { keyPath: "id", indexes: [["patientId","patientId"], ["type","type"], ["createdAt","createdAt"]] },
    settings: { keyPath: "key" }
  };

  function openDB(){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, def] of Object.entries(STORES)){
          if (!db.objectStoreNames.contains(name)){
            const store = db.createObjectStore(name, { keyPath: def.keyPath });
            (def.indexes||[]).forEach(([idx, key]) => store.createIndex(idx, key, {unique:false}));
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function tx(storeName, mode, fn){
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const store = t.objectStore(storeName);
      const res = fn(store);
      t.oncomplete = () => resolve(res);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const dbApi = {
    async put(store, value){ return tx(store, "readwrite", s => s.put(value)); },
    async del(store, key){ return tx(store, "readwrite", s => s.delete(key)); },
    async get(store, key){
      return new Promise(async (resolve, reject) => {
        try{
          const db = await openDB();
          const t = db.transaction(store, "readonly");
          const s = t.objectStore(store);
          const req = s.get(key);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        }catch(e){ reject(e); }
      });
    },
    async all(store){
      return new Promise(async (resolve, reject) => {
        try{
          const db = await openDB();
          const t = db.transaction(store, "readonly");
          const s = t.objectStore(store);
          const req = s.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        }catch(e){ reject(e); }
      });
    },
    async byIndex(store, indexName, value){
      return new Promise(async (resolve, reject) => {
        try{
          const db = await openDB();
          const t = db.transaction(store, "readonly");
          const s = t.objectStore(store).index(indexName);
          const range = IDBKeyRange.only(value);
          const req = s.getAll(range);
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        }catch(e){ reject(e); }
      });
    }
  };

  // ---------- app state ----------
  const state = {
    view: "dashboard",
    patients: [],
    events: [],
    selectedPatientId: null,
    settings: {
      professionalName: "Orlando Abreu Gomes da Silva",
      professionalReg: "",
      professionalContact: "(91) 99987-3835",
      professionalEmail: "btxtecbaixotocantins@gmail.com",
      professionalAddress: "",
      clinicName: "BTXTech",
      accessPin: ""
    }
  };

  // ---------- seed ----------
  async function ensureSeed(){
    const s = await dbApi.get("settings", "app_settings");
    if (!s){
      await dbApi.put("settings", { key:"app_settings", value: state.settings });
    }else{
      state.settings = {...state.settings, ...(s.value||{})};
    }

    const patients = await dbApi.all("patients");
    const events = await dbApi.all("events");
    state.patients = patients.sort((a,b)=> (b.updatedAt||0)-(a.updatedAt||0));
    state.events = events.sort((a,b)=> (b.createdAt||0)-(a.createdAt||0));

    if (!state.selectedPatientId && state.patients[0]) state.selectedPatientId = state.patients[0].id;
  }

  // ---------- navigation ----------
  const views = {
    dashboard: { title:"Início", sub:"visão geral do sistema" },
    patients: { title:"Pacientes", sub:"cadastro e busca" },
    encounter: { title:"Atendimento", sub:"registro rápido por evento" },
    timeline: { title:"Linha do tempo", sub:"memória longitudinal do paciente" },
    documents: { title:"Documentos", sub:"receituário, atestado, orçamento, recibo" },
    settings: { title:"Configurações", sub:"dados do profissional e segurança" }
  };

  function setView(v){
    state.view = v;
    $$(".navBtn").forEach(b => b.classList.toggle("active", b.dataset.view === v));
    $("#viewTitle").textContent = views[v]?.title || "BTX";
    $("#viewSubtitle").textContent = views[v]?.sub || "";
    render();
  }

  // ---------- rendering ----------
  function render(){
    const root = $("#content");
    root.innerHTML = "";
    if (state.view === "dashboard") root.appendChild(renderDashboard());
    if (state.view === "patients") root.appendChild(renderPatients());
    if (state.view === "encounter") root.appendChild(renderEncounter());
    if (state.view === "timeline") root.appendChild(renderTimeline());
    if (state.view === "documents") root.appendChild(renderDocuments());
    if (state.view === "settings") root.appendChild(renderSettings());
  }

  function card(title, sub, rightEl){
    const c = document.createElement("div");
    c.className = "card";
    const h = document.createElement("div");
    h.className = "cardHeader";
    const t = document.createElement("div");
    t.innerHTML = `<div class="cardTitle">${escapeHtml(title)}</div>${sub?`<div class="cardSub">${escapeHtml(sub)}</div>`:""}`;
    h.appendChild(t);
    if (rightEl) h.appendChild(rightEl);
    c.appendChild(h);
    return c;
  }

  function patientPicker(){
    const wrap = document.createElement("div");
    wrap.className = "row";
    const f = document.createElement("div");
    f.className = "field";
    f.innerHTML = `<label>Paciente selecionado</label>`;
    const sel = document.createElement("select");
    sel.innerHTML = state.patients.map(p => `<option value="${p.id}" ${p.id===state.selectedPatientId?"selected":""}>${escapeHtml(p.name)} • ${escapeHtml(p.identifier||"—")}</option>`).join("") || `<option value="">(sem pacientes)</option>`;
    sel.addEventListener("change", () => {
      state.selectedPatientId = sel.value || null;
      render();
    });
    f.appendChild(sel);
    wrap.appendChild(f);

    const b = document.createElement("div");
    b.className = "field";
    b.innerHTML = `<label>Ações</label>`;
    const row = document.createElement("div");
    row.className = "row";
    row.style.gap = "8px";
    const add = document.createElement("button");
    add.className = "btn ghost";
    add.textContent = "Novo paciente";
    add.onclick = () => openPatientForm();
    const pdf = document.createElement("button");
    pdf.className = "btn";
    pdf.textContent = "PDF do paciente";
    pdf.onclick = () => quickPatientPDF();
    row.appendChild(add); row.appendChild(pdf);
    b.appendChild(row);
    wrap.appendChild(b);

    return wrap;
  }

  function renderDashboard(){
    const frag = document.createDocumentFragment();

    const top = card("Resumo", "o que está acontecendo agora");
    top.appendChild(patientPicker());
    top.appendChild(document.createElement("hr")).className = "sep";

    const counts = document.createElement("div");
    counts.className = "grid3";
    counts.innerHTML = `
      <div class="card">
        <div class="cardTitle">Pacientes</div>
        <div class="cardSub">cadastros no dispositivo</div>
        <div style="font-size:32px;font-weight:950;margin-top:10px">${state.patients.length}</div>
      </div>
      <div class="card">
        <div class="cardTitle">Eventos</div>
        <div class="cardSub">toda a memória registrada</div>
        <div style="font-size:32px;font-weight:950;margin-top:10px">${state.events.length}</div>
      </div>
      <div class="card">
        <div class="cardTitle">Status</div>
        <div class="cardSub">offline-first</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <span class="badge accent">autosave</span>
          <span class="badge ${navigator.onLine?'ok':'warn'}">${navigator.onLine?'online':'offline'}</span>
          <span class="badge">sem login remoto</span>
        </div>
      </div>
    `;
    top.appendChild(counts);

    const recent = card("Últimos eventos", "linha do tempo recente");
    const list = state.events.slice(0, 8).map(ev => {
      const p = state.patients.find(x=>x.id===ev.patientId);
      return `<tr>
        <td>${escapeHtml(fmtDateTime(ev.createdAt))}</td>
        <td>${escapeHtml(p?.name||"—")}</td>
        <td><span class="badge accent">${escapeHtml(labelType(ev.type))}</span></td>
        <td>${escapeHtml(ev.summary||"")}</td>
      </tr>`;
    }).join("");
    recent.innerHTML += `
      <table class="table">
        <thead><tr><th>Data/Hora</th><th>Paciente</th><th>Tipo</th><th>Resumo</th></tr></thead>
        <tbody>${list || `<tr><td colspan="4" style="color:rgba(255,255,255,.55)">Sem eventos ainda.</td></tr>`}</tbody>
      </table>
    `;

    frag.appendChild(top);
    frag.appendChild(recent);
    const wrap = document.createElement("div");
    wrap.appendChild(frag);
    return wrap;
  }

  function renderPatients(){
    const wrap = document.createElement("div");
    wrap.className = "grid2";

    const left = card("Pacientes", "crie, selecione, edite, exclua", (() => {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "Adicionar";
      btn.onclick = () => openPatientForm();
      return btn;
    })());

    const q = document.createElement("input");
    q.placeholder = "Buscar por nome, CPF/CNS, telefone...";
    q.value = "";
    q.addEventListener("input", () => drawList(q.value));
    left.appendChild(q);

    const listWrap = document.createElement("div");
    listWrap.style.marginTop = "12px";
    left.appendChild(listWrap);

    function drawList(filter=""){
      const f = filter.trim().toLowerCase();
      const items = state.patients.filter(p => {
        if (!f) return true;
        return [p.name, p.identifier, p.phone, p.notes].some(x => (x||"").toLowerCase().includes(f));
      });

      listWrap.innerHTML = `
        <table class="table">
          <thead><tr><th>Nome</th><th>Identificador</th><th>Contato</th><th>Ação</th></tr></thead>
          <tbody>
            ${items.map(p => `
              <tr>
                <td>${escapeHtml(p.name)}</td>
                <td>${escapeHtml(p.identifier||"—")}</td>
                <td>${escapeHtml(p.phone||"—")}</td>
                <td>
                  <button class="btn ghost" data-act="sel" data-id="${p.id}">Selecionar</button>
                  <button class="btn ghost" data-act="edit" data-id="${p.id}">Editar</button>
                  <button class="btn danger" data-act="del" data-id="${p.id}">Excluir</button>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="4" style="color:rgba(255,255,255,.55)">Nenhum paciente.</td></tr>`}
          </tbody>
        </table>
      `;
      $$("button[data-act]", listWrap).forEach(b => b.onclick = async () => {
        const id = b.dataset.id;
        const act = b.dataset.act;
        if (act==="sel"){
          state.selectedPatientId = id;
          toast("Paciente selecionado");
          render();
        }
        if (act==="edit"){
          const p = state.patients.find(x=>x.id===id);
          openPatientForm(p);
        }
        if (act==="del"){
          const pinOk = await requirePin("Excluir paciente");
          if (!pinOk) return;
          await deletePatient(id);
        }
      });
    }
    drawList("");

    const right = card("Paciente atual", "dados essenciais + alertas");
    const p = state.patients.find(x=>x.id===state.selectedPatientId);
    if (!p){
      right.innerHTML += `<div class="cardSub">Nenhum paciente selecionado. Crie um paciente para começar.</div>`;
    }else{
      const alerts = buildAlertsForPatient(p.id);
      right.innerHTML += `
        <div class="row">
          <div class="field"><label>Nome</label><input value="${escapeHtml(p.name)}" disabled /></div>
          <div class="field"><label>Identificador (CPF/CNS)</label><input value="${escapeHtml(p.identifier||"")}" disabled /></div>
          <div class="field"><label>Contato</label><input value="${escapeHtml(p.phone||"")}" disabled /></div>
        </div>
        <div class="row">
          <div class="field"><label>Observações</label><textarea disabled>${escapeHtml(p.notes||"")}</textarea></div>
        </div>
        <hr class="sep" />
        <div class="row">
          <span class="badge accent">Eventos: ${countPatientEvents(p.id)}</span>
          ${alerts.map(a => `<span class="badge ${a.level==='warn'?'warn':a.level==='ok'?'ok':'accent'}">${escapeHtml(a.text)}</span>`).join("")}
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn" id="btnTimeline">Ver linha do tempo</button>
          <button class="btn ghost" id="btnNewRx">Nova receita</button>
          <button class="btn ghost" id="btnNewNote">Nova evolução</button>
        </div>
      `;
      $("#btnTimeline", right).onclick = () => setView("timeline");
      $("#btnNewRx", right).onclick = () => setView("documents") || openDocWizard("rx");
      $("#btnNewNote", right).onclick = () => setView("encounter");
    }

    wrap.appendChild(left);
    wrap.appendChild(right);
    return wrap;
  }

  function renderEncounter(){
    const wrap = document.createElement("div");
    const c = card("Registrar atendimento", "crie eventos clínicos (não sobrescreve — só adiciona)");
    c.appendChild(patientPicker());

    const p = state.patients.find(x=>x.id===state.selectedPatientId);
    if (!p){
      c.innerHTML += `<div class="cardSub" style="margin-top:10px">Crie um paciente antes.</div>`;
      wrap.appendChild(c);
      return wrap;
    }

    const form = document.createElement("div");
    form.className = "grid2";

    const left = document.createElement("div");
    left.className = "card";
    left.innerHTML = `
      <div class="cardHeader">
        <div>
          <div class="cardTitle">Novo evento</div>
          <div class="cardSub">evento imutável (memória longitudinal)</div>
        </div>
        <span class="badge accent">Autosave: ON</span>
      </div>

      <div class="row">
        <div class="field">
          <label>Tipo</label>
          <select id="evType">
            <option value="evolution">Evolução/Anamnese</option>
            <option value="procedure">Procedimento</option>
            <option value="exam">Solicitação/Resultado de exame</option>
            <option value="note">Observação</option>
          </select>
        </div>
        <div class="field">
          <label>CID (opcional)</label>
          <input id="evCid" placeholder="ex.: K02, I10, Z00..." />
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>Queixa/Motivo</label>
          <input id="evChief" placeholder="ex.: dor, retorno, revisão, urgência..." />
        </div>
        <div class="field">
          <label>Sinais/Vitais (opcional)</label>
          <input id="evVitals" placeholder="ex.: PA 120/80 • FC 78 • Sat 98%" />
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>Texto clínico</label>
          <textarea id="evText" placeholder="Digite evolução, exame físico, hipótese, conduta..."></textarea>
          <small class="hint">Dica: você pode colar texto e ele vai salvar automaticamente enquanto você digita.</small>
        </div>
      </div>

      <div class="row">
        <button class="btn" id="saveEvent">Salvar evento</button>
        <button class="btn ghost" id="clearDraft">Limpar</button>
      </div>
    `;

    const right = document.createElement("div");
    right.className = "card";
    right.innerHTML = `
      <div class="cardHeader">
        <div>
          <div class="cardTitle">Eventos recentes do paciente</div>
          <div class="cardSub">${escapeHtml(p.name)}</div>
        </div>
        <button class="btn ghost" id="goTimeline">Abrir linha do tempo</button>
      </div>
      <div id="recentEvents"></div>
    `;

    $("#goTimeline", right).onclick = () => setView("timeline");

    // autosave draft per patient
    const draftKey = `draft_event_${p.id}`;
    const loadDraft = () => {
      try{
        const d = JSON.parse(localStorage.getItem(draftKey) || "null");
        if (d){
          $("#evType", left).value = d.type || "evolution";
          $("#evCid", left).value = d.cid || "";
          $("#evChief", left).value = d.chief || "";
          $("#evVitals", left).value = d.vitals || "";
          $("#evText", left).value = d.text || "";
        }
      }catch(_){}
    };
    const saveDraft = () => {
      const d = {
        type: $("#evType", left).value,
        cid: $("#evCid", left).value,
        chief: $("#evChief", left).value,
        vitals: $("#evVitals", left).value,
        text: $("#evText", left).value
      };
      localStorage.setItem(draftKey, JSON.stringify(d));
      $("#autosavePill").classList.add("ok");
      setTimeout(()=>$("#autosavePill").classList.remove("ok"), 500);
    };
    ["input","change"].forEach(evt => {
      ["#evType","#evCid","#evChief","#evVitals","#evText"].forEach(id => {
        $(id, left).addEventListener(evt, () => {
          clearTimeout(saveDraft._t);
          saveDraft._t = setTimeout(saveDraft, 220);
        });
      });
    });
    loadDraft();

    $("#clearDraft", left).onclick = () => {
      localStorage.removeItem(draftKey);
      $("#evCid", left).value = "";
      $("#evChief", left).value = "";
      $("#evVitals", left).value = "";
      $("#evText", left).value = "";
      toast("Rascunho limpo");
    };

    $("#saveEvent", left).onclick = async () => {
      const ev = {
        id: uid(),
        patientId: p.id,
        type: $("#evType", left).value,
        cid: $("#evCid", left).value.trim(),
        chief: $("#evChief", left).value.trim(),
        vitals: $("#evVitals", left).value.trim(),
        text: $("#evText", left).value.trim(),
        createdAt: Date.now(),
        summary: buildEventSummary({
          type: $("#evType", left).value,
          chief: $("#evChief", left).value,
          cid: $("#evCid", left).value
        })
      };
      if (!ev.text && !ev.chief){
        toast("Digite pelo menos a queixa ou o texto clínico.");
        return;
      }
      await dbApi.put("events", ev);
      await touchPatient(p.id);
      await refreshState();
      localStorage.removeItem(draftKey);
      toast("Evento salvo na memória ✅");
      setView("timeline");
    };

    const renderRecent = () => {
      const evs = state.events.filter(e=>e.patientId===p.id).slice(0, 8);
      $("#recentEvents", right).innerHTML = `
        <table class="table">
          <thead><tr><th>Data</th><th>Tipo</th><th>Resumo</th></tr></thead>
          <tbody>
            ${evs.map(ev => `
              <tr>
                <td>${escapeHtml(fmtDate(ev.createdAt))}</td>
                <td><span class="badge accent">${escapeHtml(labelType(ev.type))}</span></td>
                <td>${escapeHtml(ev.summary||"")}</td>
              </tr>
            `).join("") || `<tr><td colspan="3" style="color:rgba(255,255,255,.55)">Sem eventos.</td></tr>`}
          </tbody>
        </table>
      `;
    };
    renderRecent();

    form.appendChild(left);
    form.appendChild(right);
    c.appendChild(form);
    wrap.appendChild(c);
    return wrap;
  }

  function renderTimeline(){
    const wrap = document.createElement("div");
    const c = card("Linha do tempo", "memória longitudinal por paciente");
    c.appendChild(patientPicker());

    const p = state.patients.find(x=>x.id===state.selectedPatientId);
    if (!p){
      c.innerHTML += `<div class="cardSub" style="margin-top:10px">Crie um paciente antes.</div>`;
      wrap.appendChild(c);
      return wrap;
    }

    const filters = document.createElement("div");
    filters.className = "row";
    filters.innerHTML = `
      <div class="field">
        <label>Filtrar por tipo</label>
        <select id="tlType">
          <option value="all">Todos</option>
          <option value="rx">Receituário</option>
          <option value="certificate">Atestado</option>
          <option value="budget">Orçamento</option>
          <option value="receipt">Recibo</option>
          <option value="evolution">Evolução/Anamnese</option>
          <option value="procedure">Procedimento</option>
          <option value="exam">Exame</option>
          <option value="note">Observação</option>
        </select>
      </div>
      <div class="field">
        <label>Buscar na linha do tempo</label>
        <input id="tlSearch" placeholder="ex.: amoxicilina, dor, hipertensão..." />
      </div>
      <div class="field">
        <label>Ações rápidas</label>
        <div class="row" style="gap:8px">
          <button class="btn ghost" id="newRx">Nova receita</button>
          <button class="btn ghost" id="newAt">Novo atestado</button>
          <button class="btn" id="pdfAll">PDF do histórico</button>
        </div>
      </div>
    `;
    c.appendChild(filters);

    const list = document.createElement("div");
    c.appendChild(list);

    const redraw = () => {
      const type = $("#tlType", c).value;
      const s = ($("#tlSearch", c).value||"").trim().toLowerCase();
      let evs = state.events.filter(e => e.patientId===p.id);
      if (type !== "all") evs = evs.filter(e => e.type===type);
      if (s){
        evs = evs.filter(e => JSON.stringify(e).toLowerCase().includes(s));
      }
      evs.sort((a,b)=>b.createdAt-a.createdAt);

      list.innerHTML = `
        <table class="table">
          <thead><tr><th>Data/Hora</th><th>Tipo</th><th>Resumo</th><th>Ações</th></tr></thead>
          <tbody>
            ${evs.map(ev => `
              <tr>
                <td>${escapeHtml(fmtDateTime(ev.createdAt))}</td>
                <td><span class="badge accent">${escapeHtml(labelType(ev.type))}</span></td>
                <td>${escapeHtml(ev.summary||"")}</td>
                <td>
                  <button class="btn ghost" data-act="view" data-id="${ev.id}">Ver</button>
                  <button class="btn" data-act="pdf" data-id="${ev.id}">PDF</button>
                  <button class="btn danger" data-act="del" data-id="${ev.id}">Excluir</button>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="4" style="color:rgba(255,255,255,.55)">Sem eventos para mostrar.</td></tr>`}
          </tbody>
        </table>
      `;

      $$("button[data-act]", list).forEach(b => b.onclick = async () => {
        const id = b.dataset.id;
        const act = b.dataset.act;
        const ev = state.events.find(x=>x.id===id);
        if (!ev) return;
        if (act==="view") openEventViewer(ev);
        if (act==="pdf") openPrint(buildDocumentFromEvent(ev, p), suggestedFileName(ev, p));
        if (act==="del"){
          const pinOk = await requirePin("Excluir evento");
          if (!pinOk) return;
          await dbApi.del("events", id);
          await refreshState();
          toast("Evento excluído");
          redraw();
        }
      });
    };

    $("#tlType", c).onchange = redraw;
    $("#tlSearch", c).oninput = () => { clearTimeout(redraw._t); redraw._t=setTimeout(redraw, 160); };

    $("#newRx", c).onclick = () => setView("documents") || openDocWizard("rx");
    $("#newAt", c).onclick = () => setView("documents") || openDocWizard("certificate");
    $("#pdfAll", c).onclick = () => openPrint(buildHistoryDocument(p.id), `historico_${safe(p.name)}.html`);

    redraw();
    wrap.appendChild(c);
    return wrap;
  }

  function renderDocuments(){
    const wrap = document.createElement("div");
    const c = card("Documentos", "geradores limpos (sem propaganda) + evento automático na memória");
    c.appendChild(patientPicker());

    const p = state.patients.find(x=>x.id===state.selectedPatientId);
    if (!p){
      c.innerHTML += `<div class="cardSub" style="margin-top:10px">Crie um paciente antes.</div>`;
      wrap.appendChild(c);
      return wrap;
    }

    const grid = document.createElement("div");
    grid.className = "grid2";

    const left = document.createElement("div");
    left.className = "card";
    left.innerHTML = `
      <div class="cardHeader">
        <div>
          <div class="cardTitle">Gerar documento</div>
          <div class="cardSub">aqui você cria PDF visível com 1 clique</div>
        </div>
        <span class="badge accent">${escapeHtml(p.name)}</span>
      </div>

      <div class="row">
        <div class="field">
          <label>Tipo de documento</label>
          <select id="docType">
            <option value="rx">Receituário</option>
            <option value="certificate">Atestado</option>
            <option value="budget">Orçamento</option>
            <option value="receipt">Recibo</option>
          </select>
        </div>
        <div class="field">
          <label>Título/Resumo (opcional)</label>
          <input id="docTitle" placeholder="ex.: Receita antibiótico • Atestado 2 dias..." />
        </div>
      </div>

      <div id="docForm"></div>

      <div class="row" style="margin-top:10px">
        <button class="btn" id="genDoc">Gerar PDF</button>
        <button class="btn ghost" id="saveOnly">Salvar na memória</button>
      </div>
      <small class="hint">Gerar PDF aqui abre a prévia e você pode imprimir/salvar como PDF (funciona offline).</small>
    `;

    const right = document.createElement("div");
    right.className = "card";
    right.innerHTML = `
      <div class="cardHeader">
        <div>
          <div class="cardTitle">Documentos recentes</div>
          <div class="cardSub">receitas/atestados/orçamentos/recibos</div>
        </div>
        <button class="btn ghost" id="goTL">Abrir linha do tempo</button>
      </div>
      <div id="docRecent"></div>
    `;
    $("#goTL", right).onclick = () => setView("timeline");

    const formWrap = $("#docForm", left);

    const renderForm = () => {
      const type = $("#docType", left).value;
      if (type === "rx"){
        formWrap.innerHTML = `
          <div class="row">
            <div class="field"><label>Medicamento 1</label><input class="rxDrug" placeholder="Nome do medicamento" /></div>
            <div class="field"><label>Posologia 1</label><input class="rxPos" placeholder="ex.: 1 cp 8/8h por 7 dias" /></div>
          </div>
          <div class="row">
            <div class="field"><label>Medicamento 2</label><input class="rxDrug" placeholder="(opcional)" /></div>
            <div class="field"><label>Posologia 2</label><input class="rxPos" placeholder="(opcional)" /></div>
          </div>
          <div class="row">
            <div class="field"><label>Medicamento 3</label><input class="rxDrug" placeholder="(opcional)" /></div>
            <div class="field"><label>Posologia 3</label><input class="rxPos" placeholder="(opcional)" /></div>
          </div>
          <div class="row">
            <div class="field"><label>Observações</label><textarea id="rxObs" placeholder="ex.: tomar após alimentação; retornar se piorar..."></textarea></div>
          </div>
        `;
      } else if (type === "certificate"){
        formWrap.innerHTML = `
          <div class="row">
            <div class="field"><label>Quantidade de dias</label><input id="atDays" type="number" min="1" value="1" /></div>
            <div class="field"><label>Data de início</label><input id="atStart" type="date" /></div>
          </div>
          <div class="row">
            <div class="field"><label>Texto (opcional)</label><textarea id="atText" placeholder="ex.: paciente necessita afastamento por ..."></textarea></div>
          </div>
        `;
        const today = new Date();
        $("#atStart", formWrap).value = today.toISOString().slice(0,10);
      } else if (type === "budget"){
        formWrap.innerHTML = `
          <div class="row">
            <div class="field"><label>Descrição do orçamento</label><textarea id="orText" placeholder="Lista de procedimentos/itens, valores e observações (texto livre)"></textarea></div>
          </div>
          <div class="row">
            <div class="field"><label>Validade (dias)</label><input id="orDays" type="number" min="1" value="7" /></div>
            <div class="field"><label>Observações</label><input id="orObs" placeholder="ex.: pagamento parcelado; sinal; etc." /></div>
          </div>
        `;
      } else if (type === "receipt"){
        formWrap.innerHTML = `
          <div class="row">
            <div class="field"><label>Valor recebido</label><input id="rcValue" placeholder="ex.: R$ 200,00" /></div>
            <div class="field"><label>Referente a</label><input id="rcFor" placeholder="ex.: consulta, procedimento, prótese..." /></div>
          </div>
          <div class="row">
            <div class="field"><label>Forma de pagamento</label><input id="rcPay" placeholder="ex.: pix, dinheiro, cartão..." /></div>
            <div class="field"><label>Observações</label><input id="rcObs" placeholder="(opcional)" /></div>
          </div>
        `;
      }
    };

    const loadRecentDocs = () => {
      const evs = state.events.filter(e => e.patientId===p.id && ["rx","certificate","budget","receipt"].includes(e.type)).slice(0, 10);
      $("#docRecent", right).innerHTML = `
        <table class="table">
          <thead><tr><th>Data</th><th>Tipo</th><th>Resumo</th><th>Ação</th></tr></thead>
          <tbody>
            ${evs.map(ev => `
              <tr>
                <td>${escapeHtml(fmtDate(ev.createdAt))}</td>
                <td><span class="badge accent">${escapeHtml(labelType(ev.type))}</span></td>
                <td>${escapeHtml(ev.summary||"")}</td>
                <td>
                  <button class="btn" data-id="${ev.id}">PDF</button>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="4" style="color:rgba(255,255,255,.55)">Nenhum documento ainda.</td></tr>`}
          </tbody>
        </table>
      `;
      $$("button[data-id]", right).forEach(b => b.onclick = () => {
        const ev = state.events.find(x=>x.id===b.dataset.id);
        openPrint(buildDocumentFromEvent(ev, p), suggestedFileName(ev, p));
      });
    };

    $("#docType", left).onchange = () => { renderForm(); };
    renderForm();
    loadRecentDocs();

    async function makeDocEvent(){
      const type = $("#docType", left).value;
      const title = ($("#docTitle", left).value||"").trim();
      const payload = collectDocPayload(type, left);
      const summary = title || buildDocSummary(type, payload);
      const ev = { id: uid(), patientId: p.id, type, createdAt: Date.now(), summary, payload };
      await dbApi.put("events", ev);
      await touchPatient(p.id);
      await refreshState();
      return ev;
    }

    $("#saveOnly", left).onclick = async () => {
      const ev = await makeDocEvent();
      toast("Salvo na memória ✅");
      loadRecentDocs();
      openEventViewer(ev);
    };

    $("#genDoc", left).onclick = async () => {
      const ev = await makeDocEvent();
      const html = buildDocumentFromEvent(ev, p);
      openPrint(html, suggestedFileName(ev, p));
      toast("Prévia aberta. Agora é só salvar como PDF ✅");
      loadRecentDocs();
    };

    grid.appendChild(left);
    grid.appendChild(right);
    c.appendChild(grid);
    wrap.appendChild(c);
    return wrap;
  }

  function renderSettings(){
    const wrap = document.createElement("div");
    const c = card("Configurações", "dados do profissional • backup • uso pessoal");
    c.innerHTML += `
      <div class="grid2">
        <div class="card">
          <div class="cardHeader">
            <div>
              <div class="cardTitle">Dados do profissional</div>
              <div class="cardSub">isso aparece automaticamente nos PDFs</div>
            </div>
            <span class="badge">perfil</span>
          </div>

          <div class="row">
            <div class="field">
              <label>Nome</label>
              <input id="sName" placeholder="Seu nome completo" />
            </div>
          </div>

          <div class="row">
            <div class="field">
              <label>Registro (CRO/CRM/COREN etc.)</label>
              <input id="sReg" placeholder="Ex.: CRO-PA 00000 / CRM-PA 00000" />
            </div>
          </div>

          <div class="row">
            <div class="field">
              <label>Clínica / Marca</label>
              <input id="sClinic" placeholder="Ex.: BTXTech / Clínica ..." />
            </div>
          </div>

          <div class="row">
            <div class="field">
              <label>Telefone / WhatsApp</label>
              <input id="sPhone" placeholder="(91) 99999-9999" />
            </div>
          </div>

          <div class="row">
            <div class="field">
              <label>E-mail</label>
              <input id="sEmail" placeholder="seuemail@..." />
            </div>
          </div>

          <div class="row">
            <div class="field">
              <label>Endereço</label>
              <input id="sAddr" placeholder="Rua, número, bairro, cidade-uf" />
            </div>
          </div>

          <div class="row">
            <button class="btn" id="saveSettings">Salvar</button>
              <button class="btn ghost" id="exportBackup">Exportar backup</button>
              <button class="btn ghost" id="importBackup">Importar backup</button>
          </div>
          <small class="hint">Dica: depois de salvar, gere um PDF e confira o cabeçalho.</small>
        </div>

        <div class="card">
          <div class="cardHeader">
            <div>
              <div class="cardTitle">Uso pessoal</div>
              <div class="cardSub">sem PIN • sem bloqueios</div>
            </div>
            <span class="badge ok">livre</span>
          </div>

          <div class="row">
            <div class="field">
              <label>Modo</label>
              <input value="Pessoal (sem PIN)" disabled />
              <small class="hint">Exclusões e importações não pedem senha. Faça backup com frequência.</small>
            </div>
          </div>

          <div class="row">
            <button class="btn ghost" id="wipeAll">Apagar tudo (irreversível)</button>
          </div>
          <small class="hint">Apagar tudo remove TODOS os pacientes e eventos deste dispositivo.</small>

          <hr class="sep" />
          <div class="cardTitle">Diagnóstico do app</div>
          <div class="cardSub" style="margin-top:6px">
            IndexedDB: <span class="badge ok">ok</span> • Service Worker: <span class="badge ${'serviceWorker' in navigator?'ok':'warn'}">${'serviceWorker' in navigator?'ok':'indisponível'}</span>
          </div>
        </div>
      </div>
    `;
    // fill values
    $("#sName", c).value = state.settings.professionalName || "";
    $("#sReg", c).value = state.settings.professionalReg || "";
    $("#sClinic", c).value = state.settings.clinicName || "";
    $("#sPhone", c).value = state.settings.professionalContact || "";
    $("#sEmail", c).value = state.settings.professionalEmail || "";
    $("#sAddr", c).value = state.settings.professionalAddress || "";


    const saveBtn = $("#saveSettings", c);
    if (saveBtn) saveBtn.onclick = async () => {
      state.settings.professionalName = $("#sName", c).value.trim();
      state.settings.professionalReg = $("#sReg", c).value.trim();
      state.settings.clinicName = $("#sClinic", c).value.trim();
      state.settings.professionalContact = $("#sPhone", c).value.trim();
      state.settings.professionalEmail = $("#sEmail", c).value.trim();
      state.settings.professionalAddress = $("#sAddr", c).value.trim();
      await dbApi.put("settings", { key:"app_settings", value: state.settings });
      toast("Configurações salvas ✅");
    };

    const wipeBtn = $("#wipeAll", c);
    if (wipeBtn) wipeBtn.onclick = async () => {
      const ok = confirm("Tem certeza? Isso apaga TODOS os pacientes e eventos deste dispositivo.");
      if (!ok) return;
      await wipeDatabase();
      await refreshState();
      toast("Tudo apagado.");
      setView("dashboard");
    };

    const exBtn = $("#exportBackup", c);
    if (exBtn) exBtn.onclick = async () => exportBackup();
    const imBtn = $("#importBackup", c);
    if (imBtn) imBtn.onclick = async () => importBackup();

    wrap.appendChild(c);
    return wrap;
  }

  // ---------- logic helpers ----------
  async function refreshState(){
    state.patients = (await dbApi.all("patients")).sort((a,b)=> (b.updatedAt||0)-(a.updatedAt||0));
    state.events = (await dbApi.all("events")).sort((a,b)=> (b.createdAt||0)-(a.createdAt||0));
  }

  async function touchPatient(patientId){
    const p = await dbApi.get("patients", patientId);
    if (!p) return;
    p.updatedAt = Date.now();
    await dbApi.put("patients", p);
  }

  async function deletePatient(patientId){
    // delete all events for this patient
    const evs = state.events.filter(e=>e.patientId===patientId);
    for (const ev of evs){
      await dbApi.del("events", ev.id);
    }
    await dbApi.del("patients", patientId);
    if (state.selectedPatientId === patientId) state.selectedPatientId = (state.patients.find(p=>p.id!==patientId)?.id) || null;
    await refreshState();
    toast("Paciente excluído.");
    render();
  }

  function countPatientEvents(pid){
    return state.events.filter(e=>e.patientId===pid).length;
  }

  function buildAlertsForPatient(pid){
    const evs = state.events.filter(e=>e.patientId===pid);
    const last = evs[0];
    const docs = evs.filter(e=>["rx","certificate","budget","receipt"].includes(e.type));
    const lastRx = docs.find(e=>e.type==="rx");
    const out = [];
    if (!evs.length) out.push({level:"warn", text:"sem histórico"});
    if (last) {
      const days = Math.floor((Date.now()-last.createdAt)/(1000*60*60*24));
      out.push({level: days>180 ? "warn" : "ok", text: `último registro: ${days}d`});
    }
    if (lastRx){
      out.push({level:"accent", text:`última receita: ${fmtDate(lastRx.createdAt)}`});
    }
    return out;
  }

  function labelType(t){
    return ({
      rx:"Receituário",
      certificate:"Atestado",
      budget:"Orçamento",
      receipt:"Recibo",
      evolution:"Evolução/Anamnese",
      procedure:"Procedimento",
      exam:"Exame",
      note:"Observação"
    })[t] || t;
  }

  function buildEventSummary({type, chief, cid}){
    const base = (chief||"").trim();
    const c = (cid||"").trim();
    const lt = labelType(type);
    return [lt, base, c?`CID ${c}`:""].filter(Boolean).join(" • ");
  }

  function collectDocPayload(type, left){
    if (type==="rx"){
      const drugs = $$(".rxDrug", left).map(x=>x.value.trim()).filter(Boolean);
      const poss = $$(".rxPos", left).map(x=>x.value.trim());
      const items = drugs.map((d,i)=>({drug:d, pos:(poss[i]||"").trim()})).filter(x=>x.drug);
      return { items, obs: ($("#rxObs", left)?.value||"").trim() };
    }
    if (type==="certificate"){
      const days = parseInt($("#atDays", left).value||"1", 10);
      const start = $("#atStart", left).value;
      return { days, start, text: ($("#atText", left).value||"").trim() };
    }
    if (type==="budget"){
      return { text: ($("#orText", left).value||"").trim(), days: parseInt($("#orDays", left).value||"7",10), obs: ($("#orObs", left).value||"").trim() };
    }
    if (type==="receipt"){
      return { value: ($("#rcValue", left).value||"").trim(), for: ($("#rcFor", left).value||"").trim(), pay: ($("#rcPay", left).value||"").trim(), obs: ($("#rcObs", left).value||"").trim() };
    }
    return {};
  }

  function buildDocSummary(type, payload){
    if (type==="rx"){
      const first = payload.items?.[0]?.drug || "receita";
      return `Receita • ${first}${payload.items?.length>1?` (+${payload.items.length-1})`:""}`;
    }
    if (type==="certificate"){
      return `Atestado • ${payload.days||1} dia(s)`;
    }
    if (type==="budget"){
      return `Orçamento • validade ${payload.days||7} dia(s)`;
    }
    if (type==="receipt"){
      return `Recibo • ${payload.value||"valor"}`;
    }
    return labelType(type);
  }

  function safe(s){ return (s||"").toLowerCase().replace(/\s+/g,"_").replace(/[^a-z0-9_\-]/g,""); }

  function suggestedFileName(ev, p){
    const t = safe(labelType(ev.type));
    return `${t}_${safe(p.name)}_${new Date(ev.createdAt).toISOString().slice(0,10)}.html`;
  }

  function openPatientForm(existing=null){
    const p = existing || { id: uid(), name:"", identifier:"", phone:"", birth:"", notes:"", createdAt: Date.now(), updatedAt: Date.now() };
    const isEdit = !!existing;

    const modal = document.createElement("div");
    modal.className = "card";
    modal.innerHTML = `
      <div class="cardHeader">
        <div>
          <div class="cardTitle">${isEdit?"Editar":"Novo"} paciente</div>
          <div class="cardSub">cadastro mínimo + identificador (CPF/CNS)</div>
        </div>
        <button class="btn ghost" id="closeP">Fechar</button>
      </div>

      <div class="row">
        <div class="field"><label>Nome</label><input id="pName" /></div>
        <div class="field"><label>CPF/CNS</label><input id="pId" placeholder="(opcional)" /></div>
      </div>
      <div class="row">
        <div class="field"><label>Telefone</label><input id="pPhone" placeholder="(opcional)" /></div>
        <div class="field"><label>Nascimento</label><input id="pBirth" type="date" /></div>
      </div>
      <div class="row">
        <div class="field"><label>Observações / Alergias / Alertas</label><textarea id="pNotes" placeholder="ex.: alérgico a dipirona; HAS; DM; etc."></textarea></div>
      </div>
      <div class="row">
        <button class="btn" id="saveP">${isEdit?"Salvar":"Criar"}</button>
        ${isEdit?`<button class="btn ghost" id="selectP">Selecionar</button>`:""}
      </div>
    `;

    // Insert modal at top of content
    const content = $("#content");
    content.prepend(modal);

    $("#pName", modal).value = p.name || "";
    $("#pId", modal).value = p.identifier || "";
    $("#pPhone", modal).value = p.phone || "";
    $("#pBirth", modal).value = p.birth || "";
    $("#pNotes", modal).value = p.notes || "";

    $("#closeP", modal).onclick = () => modal.remove();
    if (isEdit){
      $("#selectP", modal).onclick = () => { state.selectedPatientId = p.id; toast("Paciente selecionado"); modal.remove(); render(); };
    }

    $("#saveP", modal).onclick = async () => {
      p.name = $("#pName", modal).value.trim();
      p.identifier = $("#pId", modal).value.trim();
      p.phone = $("#pPhone", modal).value.trim();
      p.birth = $("#pBirth", modal).value;
      p.notes = $("#pNotes", modal).value.trim();
      p.updatedAt = Date.now();
      if (!p.name){ toast("Nome é obrigatório."); return; }
      await dbApi.put("patients", p);
      await refreshState();
      state.selectedPatientId = p.id;
      toast(isEdit ? "Paciente atualizado ✅" : "Paciente criado ✅");
      modal.remove();
      render();
    };
  }

  function openEventViewer(ev){
    const p = state.patients.find(x=>x.id===ev.patientId);
    const modal = document.createElement("div");
    modal.className = "card";
    modal.innerHTML = `
      <div class="cardHeader">
        <div>
          <div class="cardTitle">Evento • ${escapeHtml(labelType(ev.type))}</div>
          <div class="cardSub">${escapeHtml(p?.name||"—")} • ${escapeHtml(fmtDateTime(ev.createdAt))}</div>
        </div>
        <div class="row" style="gap:8px">
          <button class="btn" id="pdfEv">PDF</button>
          <button class="btn ghost" id="closeEv">Fechar</button>
        </div>
      </div>
      <div class="cardSub" style="margin-bottom:10px">${escapeHtml(ev.summary||"")}</div>
      <pre style="white-space:pre-wrap;margin:0;color:rgba(255,255,255,.85);line-height:1.45">${escapeHtml(JSON.stringify(ev, null, 2))}</pre>
    `;
    $("#content").prepend(modal);
    $("#closeEv", modal).onclick = () => modal.remove();
    $("#pdfEv", modal).onclick = () => openPrint(buildDocumentFromEvent(ev, p), suggestedFileName(ev, p));
  }

  function openDocWizard(type){
    // helper: set doc type and scroll into view
    setView("documents");
    setTimeout(()=> {
      const sel = $("#docType");
      if (sel) { sel.value = type; sel.dispatchEvent(new Event("change")); toast("Documento pronto para preencher."); }
      window.scrollTo({top:0, behavior:"smooth"});
    }, 50);
  }

  // ---------- Print/PDF ----------
  const printBackdrop = $("#printBackdrop");
  const printFrame = $("#printFrame");

  function openPrint(html, filename="documento.html"){
    // abre SOMENTE quando você clicar em PDF
    printBackdrop.classList.add("show");
    printBackdrop.hidden = false;

    const blob = new Blob([html], {type:"text/html;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    printFrame.src = url;

    $("#doPrint").onclick = () => {
      try{
        printFrame.contentWindow.focus();
        printFrame.contentWindow.print();
      }catch(e){
        toast("Não deu pra acionar o print automático. Use o menu do navegador.");
      }
    };

    $("#downloadHtml").onclick = () => {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
    };

    const close = () => {
      printBackdrop.classList.remove("show");
      printBackdrop.hidden = true;
      URL.revokeObjectURL(url);
      printFrame.src = "about:blank";
    };

    $("#closePrint").onclick = close;
  }

  // Build HTML docs (no software propaganda)
  function docBase({title, bodyHtml}){
    const s = state.settings;
    const head = `
      <style>
        :root{--accent:#00b4ff}
        body{font-family: Arial, sans-serif; margin:28px; color:#111}
        .top{display:flex; justify-content:space-between; gap:16px; align-items:flex-start}
        .h1{font-size:18px; font-weight:800; margin:0}
        .sub{font-size:12px; color:#444; margin-top:4px}
        .box{border:1px solid #ddd; border-radius:12px; padding:14px; margin-top:14px}
        .line{height:1px; background:#eee; margin:14px 0}
        .row{display:flex; gap:14px; flex-wrap:wrap}
        .k{font-size:11px; color:#555}
        .v{font-size:13px; font-weight:700}
        table{width:100%; border-collapse:collapse}
        th,td{border-bottom:1px solid #eee; text-align:left; padding:8px 6px; font-size:13px}
        th{font-size:12px; color:#444}
        .sign{margin-top:18px}
        .sign .l{height:1px; background:#111; width:280px; margin-top:40px}
        @media print{body{margin:12mm}}
      </style>
    `;
    const prof = `
      <div class="top">
        <div>
          <p class="h1">${escapeHtml(s.clinicName || "Clínica")}</p>
          <div class="sub">${escapeHtml(s.professionalName||"")} ${s.professionalReg?("• "+escapeHtml(s.professionalReg)):""}</div>
          <div class="sub">${escapeHtml(s.professionalContact||"")} ${s.professionalEmail?("• "+escapeHtml(s.professionalEmail)):""}</div>
          ${s.professionalAddress?`<div class="sub">${escapeHtml(s.professionalAddress)}</div>`:""}
        </div>
        <div style="text-align:right">
          <p class="h1">${escapeHtml(title)}</p>
          <div class="sub">${escapeHtml(new Date().toLocaleString("pt-BR"))}</div>
        </div>
      </div>
    `;
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">${head}</head><body>${prof}${bodyHtml}</body></html>`;
  }

  function buildDocumentFromEvent(ev, patient){
    const p = patient || state.patients.find(x=>x.id===ev.patientId) || {};
    const patientBox = `
      <div class="box">
        <div class="row">
          <div><div class="k">Paciente</div><div class="v">${escapeHtml(p.name||"")}</div></div>
          <div><div class="k">Identificador</div><div class="v">${escapeHtml(p.identifier||"—")}</div></div>
          <div><div class="k">Contato</div><div class="v">${escapeHtml(p.phone||"—")}</div></div>
          <div><div class="k">Data do evento</div><div class="v">${escapeHtml(fmtDateTime(ev.createdAt))}</div></div>
        </div>
      </div>
    `;

    if (ev.type === "rx"){
      const items = (ev.payload?.items||[]).filter(x=>x.drug);
      const rows = items.map(it => `<tr><td><b>${escapeHtml(it.drug)}</b></td><td>${escapeHtml(it.pos||"")}</td></tr>`).join("");
      const obs = ev.payload?.obs ? `<div class="box"><div class="k">Observações</div><div class="v" style="font-weight:500">${escapeHtml(ev.payload.obs)}</div></div>` : "";
      const body = `
        ${patientBox}
        <div class="box">
          <table>
            <thead><tr><th>Medicamento</th><th>Posologia</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="2">—</td></tr>`}</tbody>
          </table>
        </div>
        ${obs}
        <div class="sign">
          <div class="l"></div>
          <div class="k">Assinatura e carimbo</div>
        </div>
      `;
      return docBase({title:"Receituário", bodyHtml: body});
    }

    if (ev.type === "certificate"){
      const days = ev.payload?.days || 1;
      const start = ev.payload?.start ? new Date(ev.payload.start+"T00:00:00") : new Date();
      const end = new Date(start.getTime() + (days-1)*24*60*60*1000);
      const text = ev.payload?.text?.trim();
      const body = `
        ${patientBox}
        <div class="box">
          <p style="margin:0;font-size:14px;line-height:1.6">
            Atesto para os devidos fins que <b>${escapeHtml(p.name||"")}</b>
            necessita de afastamento por <b>${days}</b> dia(s), a contar de <b>${escapeHtml(start.toLocaleDateString("pt-BR"))}</b>
            ${days>1?`até <b>${escapeHtml(end.toLocaleDateString("pt-BR"))}</b>.`:"."}
          </p>
          ${text?`<div class="line"></div><div class="k">Observação</div><div style="font-size:13px">${escapeHtml(text)}</div>`:""}
        </div>
        <div class="sign">
          <div class="l"></div>
          <div class="k">Assinatura e carimbo</div>
        </div>
      `;
      return docBase({title:"Atestado", bodyHtml: body});
    }

    if (ev.type === "budget"){
      const body = `
        ${patientBox}
        <div class="box">
          <div class="k">Descrição</div>
          <div style="white-space:pre-wrap;font-size:13px;line-height:1.5">${escapeHtml(ev.payload?.text||"")}</div>
          <div class="line"></div>
          <div class="row">
            <div><div class="k">Validade</div><div class="v">${escapeHtml(String(ev.payload?.days||7))} dia(s)</div></div>
            <div><div class="k">Observações</div><div class="v">${escapeHtml(ev.payload?.obs||"—")}</div></div>
          </div>
        </div>
        <div class="sign">
          <div class="l"></div>
          <div class="k">Assinatura e carimbo</div>
        </div>
      `;
      return docBase({title:"Orçamento", bodyHtml: body});
    }

    if (ev.type === "receipt"){
      const body = `
        ${patientBox}
        <div class="box">
          <p style="margin:0;font-size:14px;line-height:1.6">
            Recebi de <b>${escapeHtml(p.name||"")}</b> a quantia de <b>${escapeHtml(ev.payload?.value||"")}</b>,
            referente a <b>${escapeHtml(ev.payload?.for||"")}</b>.
          </p>
          <div class="line"></div>
          <div class="row">
            <div><div class="k">Forma de pagamento</div><div class="v">${escapeHtml(ev.payload?.pay||"—")}</div></div>
            <div><div class="k">Observações</div><div class="v">${escapeHtml(ev.payload?.obs||"—")}</div></div>
          </div>
        </div>
        <div class="sign">
          <div class="l"></div>
          <div class="k">Assinatura e carimbo</div>
        </div>
      `;
      return docBase({title:"Recibo", bodyHtml: body});
    }

    // generic event
    const body = `
      ${patientBox}
      <div class="box">
        <div class="k">Resumo</div>
        <div class="v">${escapeHtml(ev.summary||"")}</div>
        <div class="line"></div>
        <div class="k">Conteúdo</div>
        <div style="white-space:pre-wrap;font-size:13px;line-height:1.5">${escapeHtml(ev.text||"")}</div>
        ${ev.cid?`<div class="line"></div><div class="k">CID</div><div class="v">${escapeHtml(ev.cid)}</div>`:""}
        ${ev.vitals?`<div class="line"></div><div class="k">Sinais/Vitais</div><div class="v">${escapeHtml(ev.vitals)}</div>`:""}
      </div>
      <div class="sign">
        <div class="l"></div>
        <div class="k">Assinatura e carimbo</div>
      </div>
    `;
    return docBase({title: labelType(ev.type), bodyHtml: body});
  }

  function buildHistoryDocument(patientId){
    const p = state.patients.find(x=>x.id===patientId) || {};
    const evs = state.events.filter(e=>e.patientId===patientId).slice().sort((a,b)=>b.createdAt-a.createdAt);
    const rows = evs.map(ev => `
      <tr>
        <td>${escapeHtml(fmtDateTime(ev.createdAt))}</td>
        <td>${escapeHtml(labelType(ev.type))}</td>
        <td>${escapeHtml(ev.summary||"")}</td>
      </tr>
    `).join("");
    const body = `
      <div class="box">
        <div class="row">
          <div><div class="k">Paciente</div><div class="v">${escapeHtml(p.name||"")}</div></div>
          <div><div class="k">Identificador</div><div class="v">${escapeHtml(p.identifier||"—")}</div></div>
          <div><div class="k">Contato</div><div class="v">${escapeHtml(p.phone||"—")}</div></div>
        </div>
      </div>

      <div class="box">
        <div class="k">Linha do tempo (resumo)</div>
        <table>
          <thead><tr><th>Data/Hora</th><th>Tipo</th><th>Resumo</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="3">—</td></tr>`}</tbody>
        </table>
      </div>
    `;
    return docBase({title:"Histórico do paciente", bodyHtml: body});
  }

  // ---------- PIN ----------
  async function requirePin(actionName="Ação"){
    const pin = state.settings.accessPin || "007";
    const input = prompt(`${actionName}: digite o PIN de acesso`);
    if (input === null) return false;
    if (input.trim() !== pin){
      toast("PIN incorreto.");
      return false;
    }
    return true;
  }

  // ---------- Backup ----------
  async function exportBackup(){
    const backup = {
      version: 1,
      exportedAt: Date.now(),
      settings: state.settings,
      patients: await dbApi.all("patients"),
      events: await dbApi.all("events")
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `btx_prontuario_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
    toast("Backup exportado ✅");
  }

  async function importBackup(){
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "application/json";
    inp.onchange = async () => {
      const file = inp.files?.[0];
      if (!file) return;
      const text = await file.text();
      let data;
      try{ data = JSON.parse(text); }catch(e){ toast("JSON inválido."); return; }
      if (!data || !Array.isArray(data.patients) || !Array.isArray(data.events)){
        toast("Backup inválido.");
        return;
      }
      // wipe then import
      await wipeDatabase();
      // restore settings first
      state.settings = {...state.settings, ...(data.settings||{})};
      await dbApi.put("settings", { key:"app_settings", value: state.settings });
      for (const p of data.patients) await dbApi.put("patients", p);
      for (const ev of data.events) await dbApi.put("events", ev);
      await refreshState();
      state.selectedPatientId = state.patients[0]?.id || null;
      toast("Backup importado ✅");
      render();
    };
    inp.click();
  }

  async function wipeDatabase(){
    // delete all data from stores
    for (const store of Object.keys(STORES)){
      const all = await dbApi.all(store);
      for (const item of all){
        const key = store==="settings" ? item.key : item.id;
        await dbApi.del(store, key);
      }
    }
  }

  // ---------- quick PDF button ----------
  function quickPatientPDF(){
    const p = state.patients.find(x=>x.id===state.selectedPatientId);
    if (!p){ toast("Selecione um paciente."); return; }
    openPrint(buildHistoryDocument(p.id), `historico_${safe(p.name)}.html`);
  }

  // ---------- global search ----------
  function globalSearch(q){
    const s = (q||"").trim().toLowerCase();
    if (!s){ toast("Digite algo para buscar."); return; }
    const hitPatient = state.patients.find(p => JSON.stringify(p).toLowerCase().includes(s));
    if (hitPatient){
      state.selectedPatientId = hitPatient.id;
      setView("timeline");
      toast(`Encontrado: ${hitPatient.name}`);
      $("#tlSearch")?.setAttribute("value", s);
    }else{
      toast("Nada encontrado.");
    }
  }

  // ---------- online/offline pill ----------
  function updateOnlinePill(){
    const pill = $("#syncPill");
    if (navigator.onLine){
      pill.textContent = "ONLINE";
      pill.classList.add("ok");
      pill.classList.remove("warn");
    }else{
      pill.textContent = "OFFLINE";
      pill.classList.add("warn");
      pill.classList.remove("ok");
    }
  }

  // ---------- init ----------
  async function init(){
    // FIX: garante que o modal de PDF nunca bloqueie a tela ao abrir
    try{ printBackdrop.classList.remove("show"); printBackdrop.hidden = true; printFrame.src = "about:blank"; }catch(e){}
    // service worker
    if ("serviceWorker" in navigator){
      try{
        await navigator.serviceWorker.register("./sw.js");
      }catch(e){
        console.warn("SW register failed", e);
      }
    }

    await ensureSeed();
    updateOnlinePill();

    // nav buttons
    $$(".navBtn").forEach(b => b.onclick = () => setView(b.dataset.view));
    setView("dashboard");

    // menu button (mobile)
    $("#menuBtn").onclick = () => $("#sidebar").classList.toggle("open");
    $("#content").addEventListener("click", () => $("#sidebar").classList.remove("open"));

    // global search
    $("#globalSearch").addEventListener("keydown", (e) => {
      if (e.key === "Enter") globalSearch(e.target.value);
    });

    // quick pdf
    $("#quickPdfBtn").onclick = () => quickPatientPDF();

    // print modal close via backdrop click
    $("#printBackdrop").addEventListener("click", (e) => {
      if (e.target === $("#printBackdrop")) $("#closePrint").click();
    });

    
    // fechar modal com ESC (quando estiver aberto)
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !printBackdrop.hidden){
        $("#closePrint")?.click();
      }
    });
// online status
    window.addEventListener("online", () => { updateOnlinePill(); toast("Online"); });
    window.addEventListener("offline", () => { updateOnlinePill(); toast("Offline"); });

    toast("Prontuário pronto ✅ (offline-first)");
  }

  init();

})();

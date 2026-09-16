/* FreelancerOS — dashboard engine shared by demo.html (localStorage, sample
 * data, templates locked) and app.html (token-gated, cloud persistence).
 *
 * Boot: FreelancerOS.boot({ mode: 'demo'|'live', token, load, save,
 *   templatesLocked, rootId })
 *   load()  -> Promise resolving to the state object (or null for fresh)
 *   save(state) -> persist; may return a promise. Debounced by the engine.
 *
 * State shape:
 * { clients:[{id,name,company,email,status,notes,followUp}],
 *   invoices:[{id,number,clientId,items:[{desc,qty,rate}],tax,discount,status,issued,due,notes}],
 *   content:[{id,title,platform,stage,notes}],
 *   settings:{businessName,email,currency,accent} }
 */
"use strict";

(function () {
  var CURRENCIES = { USD: "$", EUR: "€", GBP: "£", CAD: "CA$", AUD: "A$", INR: "₹", BRL: "R$" };
  var CLIENT_STATUSES = ["lead", "active", "on-hold", "done"];
  var INVOICE_STATUSES = ["draft", "sent", "paid", "overdue"];
  var STAGES = [
    { id: "ideas", label: "Ideas" },
    { id: "drafting", label: "Drafting" },
    { id: "scheduled", label: "Scheduled" },
    { id: "published", label: "Published" }
  ];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function uid(p) {
    return (p || "id") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function daysUntil(dateStr) {
    if (!dateStr) return null;
    var t = todayStr();
    var a = new Date(t + "T00:00:00"), b = new Date(dateStr + "T00:00:00");
    if (isNaN(b.getTime())) return null;
    return Math.round((b - a) / 86400000);
  }
  function fmtDate(dateStr) {
    if (!dateStr) return "—";
    var d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return esc(dateStr);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function money(amount, currency) {
    var sym = CURRENCIES[currency] || (currency ? currency + " " : "$");
    var n = Number(amount) || 0;
    return sym + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function freshState() {
    return { clients: [], invoices: [], content: [], settings: { businessName: "", email: "", currency: "USD", accent: "#34d399" } };
  }

  function sampleState() {
    return {
      clients: [
        { id: "c-sample-1", name: "Dana Reyes", company: "Acme Studio", email: "dana@acmestudio.co", status: "active", notes: "Brand refresh, phase 2 starting next month.", followUp: addDays(2) },
        { id: "c-sample-2", name: "Marcus Bell", company: "Bright Bakery", email: "marcus@brightbakery.com", status: "lead", notes: "Wants a new menu site. Sent proposal last week.", followUp: addDays(-3) },
        { id: "c-sample-3", name: "Priya Nair", company: "Northwind Coaching", email: "priya@northwind.coach", status: "on-hold", notes: "Pausing until Q1 budget clears.", followUp: "" }
      ],
      invoices: [
        { id: "i-sample-1", number: "INV-1042", clientId: "c-sample-1", items: [{ desc: "Homepage redesign — milestone 2", qty: 1, rate: 2450 }], tax: 0, discount: 0, status: "sent", issued: addDays(-6), due: addDays(8), notes: "Net 14" },
        { id: "i-sample-2", number: "INV-1041", clientId: "c-sample-1", items: [{ desc: "Homepage redesign — milestone 1", qty: 1, rate: 1800 }], tax: 0, discount: 0, status: "paid", issued: addDays(-34), due: addDays(-20), notes: "" }
      ],
      content: [
        { id: "k-sample-1", title: "Portfolio teardown reel", platform: "Instagram", stage: "scheduled", notes: "Post Tuesday 9am. Hook: '3 homepage mistakes'." },
        { id: "k-sample-2", title: "Rate-raise announcement", platform: "LinkedIn", stage: "drafting", notes: "Frame as value, not apology." },
        { id: "k-sample-3", title: "Client onboarding checklist", platform: "Blog", stage: "ideas", notes: "" },
        { id: "k-sample-4", title: "Behind the scenes — desk setup", platform: "Instagram", stage: "published", notes: "Posted last Friday. 2.1k views." }
      ],
      settings: { businessName: "Sample Studio", email: "hello@samplestudio.co", currency: "USD", accent: "#34d399" }
    };
    function addDays(n) {
      var d = new Date(); d.setDate(d.getDate() + n);
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }
  }

  function invoiceTotals(inv) {
    var sub = (inv.items || []).reduce(function (s, it) { return s + (Number(it.qty) || 0) * (Number(it.rate) || 0); }, 0);
    var disc = Number(inv.discount) || 0;
    var tax = (Number(inv.tax) || 0) / 100 * Math.max(0, sub - disc);
    return { sub: sub, discount: disc, tax: tax, total: Math.max(0, sub - disc) + tax };
  }

  /* ================= boot ================= */
  function boot(cfg) {
    var root = document.getElementById(cfg.rootId || "dash-root");
    if (!root) return;
    var state = null;
    var activeTab = "clients";
    var clientQuery = "";
    var saveTimer = null;
    var saveNote = "";

    function scheduleSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        try {
          var r = cfg.save(state);
          if (r && r.then) {
            setSaveNote("Saving…");
            r.then(function () { setSaveNote("Saved ✓"); },
                   function () { setSaveNote("Save failed — retrying"); scheduleSave(); });
          }
        } catch (e) { setSaveNote("Save failed"); }
      }, 700);
    }
    function setSaveNote(t) {
      saveNote = t;
      var el = document.getElementById("sync-note");
      if (el) el.textContent = cfg.mode === "demo" ? "Demo — saved on this device only" : t;
    }
    function mutate() { render(); scheduleSave(); }

    /* ---------- modal ---------- */
    function openModal(title, bodyHtml, onMount) {
      closeModal();
      var m = document.createElement("div");
      m.className = "modal"; m.id = "dash-modal";
      m.innerHTML = '<div class="modal-backdrop" data-mclose></div>' +
        '<div class="modal-card wide" role="dialog" aria-modal="true">' +
        '<button class="modal-close" data-mclose aria-label="Close">×</button>' +
        "<h2>" + esc(title) + "</h2><div id='modal-body'></div></div>";
      document.body.appendChild(m);
      document.getElementById("modal-body").innerHTML = bodyHtml;
      m.querySelectorAll("[data-mclose]").forEach(function (el) {
        el.addEventListener("click", closeModal);
      });
      if (onMount) onMount(document.getElementById("modal-body"));
      var first = m.querySelector("input, select, textarea");
      if (first) first.focus();
    }
    function closeModal() {
      var m = document.getElementById("dash-modal");
      if (m) m.remove();
    }
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });

    function field(label, inner) {
      return '<div class="field"><label>' + esc(label) + "</label>" + inner + "</div>";
    }
    function input(name, value, type, attrs) {
      return '<input name="' + esc(name) + '" type="' + esc(type || "text") + '" value="' + esc(value == null ? "" : value) + '"' + (attrs ? " " + attrs : "") + ">";
    }
    function formValues(container) {
      var out = {};
      var els = container && container.querySelectorAll ? container.querySelectorAll("[name]") : [];
      Array.prototype.forEach.call(els, function (el) {
        if (el.name && !el.disabled) out[el.name] = el.value;
      });
      return out;
    }

    /* ---------- shell ---------- */
    var TABS = [
      { id: "clients", label: "👥 Clients" },
      { id: "invoices", label: "🧾 Invoices" },
      { id: "content", label: "📋 Content" },
      { id: "templates", label: "📄 Templates" },
      { id: "settings", label: "⚙️ Settings" }
    ];

    function render() {
      var html = '<div class="dash-top"><h1>' + esc(state.settings.businessName || "My Dashboard") + '</h1>' +
        '<span class="sync-note" id="sync-note"></span></div>';
      html += '<div class="tabs" role="tablist">' + TABS.map(function (t) {
        return '<button class="tab' + (t.id === activeTab ? " active" : "") + '" data-tab="' + t.id + '" role="tab">' + esc(t.label) + "</button>";
      }).join("") + "</div>";
      html += '<div class="tab-panel" id="tab-panel"></div>';
      root.innerHTML = html;
      setSaveNote(saveNote);
      root.querySelectorAll("[data-tab]").forEach(function (b) {
        b.addEventListener("click", function () { activeTab = b.getAttribute("data-tab"); render(); });
      });
      var panel = document.getElementById("tab-panel");
      if (activeTab === "clients") renderClients(panel);
      else if (activeTab === "invoices") renderInvoices(panel);
      else if (activeTab === "content") renderContent(panel);
      else if (activeTab === "templates") renderTemplates(panel);
      else if (activeTab === "settings") renderSettings(panel);
    }

    function followBadge(c) {
      var d = daysUntil(c.followUp);
      if (d == null) return "";
      if (d < 0) return ' <span class="pill pill-overdue">follow-up overdue</span>';
      if (d <= 3) return ' <span class="pill pill-follow">follow-up in ' + d + "d</span>";
      return "";
    }
    function clientName(id) {
      var c = state.clients.find(function (x) { return x.id === id; });
      return c ? (c.company ? c.name + " · " + c.company : c.name) : "—";
    }

    /* ---------- clients tab ---------- */
    function renderClients(panel) {
      var q = clientQuery.toLowerCase();
      var list = state.clients.filter(function (c) {
        return !q || (c.name + " " + (c.company || "") + " " + (c.email || "")).toLowerCase().indexOf(q) !== -1;
      });
      var html = '<div class="section-head"><h2>Clients</h2>' +
        '<button class="btn btn-primary btn-sm" id="add-client">+ Add client</button></div>' +
        '<div class="toolbar"><input class="search" id="client-search" placeholder="Search clients…" value="' + esc(clientQuery) + '"></div>';
      if (!list.length) {
        html += '<div class="empty"><span class="big">👥</span><strong>No clients yet</strong><p>Add your first client to start tracking follow-ups and invoices.</p></div>';
      } else {
        html += '<div class="table-wrap"><table class="data"><thead><tr>' +
          "<th>Client</th><th>Status</th><th>Follow-up</th><th></th></tr></thead><tbody>";
        list.forEach(function (c) {
          html += "<tr><td><strong>" + esc(c.name) + "</strong>" +
            (c.company ? '<br><span class="muted">' + esc(c.company) + "</span>" : "") +
            (c.email ? '<br><span class="muted" style="font-size:13px">' + esc(c.email) + "</span>" : "") +
            (c.notes ? '<br><span class="muted" style="font-size:13px">' + esc(c.notes) + "</span>" : "") +
            "</td><td><span class='pill pill-" + esc(c.status.replace("-", "")) + "'>" + esc(c.status) + "</span></td>" +
            "<td>" + fmtDate(c.followUp) + followBadge(c) + "</td>" +
            '<td style="white-space:nowrap"><button class="btn btn-sm" data-edit-client="' + esc(c.id) + '">Edit</button> ' +
            '<button class="btn btn-sm btn-danger" data-del-client="' + esc(c.id) + '">Delete</button></td></tr>';
        });
        html += "</tbody></table></div>";
      }
      panel.innerHTML = html;
      document.getElementById("add-client").addEventListener("click", function () { clientForm(null); });
      var search = document.getElementById("client-search");
      search.addEventListener("input", function () { clientQuery = search.value; renderClients(panel); var s2 = document.getElementById("client-search"); s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); });
      panel.querySelectorAll("[data-edit-client]").forEach(function (b) {
        b.addEventListener("click", function () { clientForm(b.getAttribute("data-edit-client")); });
      });
      panel.querySelectorAll("[data-del-client]").forEach(function (b) {
        b.addEventListener("click", function () {
          var id = b.getAttribute("data-del-client");
          var c = state.clients.find(function (x) { return x.id === id; });
          if (confirm("Delete " + (c ? c.name : "this client") + "? Their invoices stay, but the client record is gone.")) {
            state.clients = state.clients.filter(function (x) { return x.id !== id; });
            mutate();
          }
        });
      });
    }

    function clientForm(id) {
      var c = id ? state.clients.find(function (x) { return x.id === id; }) : null;
      var v = c || { name: "", company: "", email: "", status: "lead", notes: "", followUp: "" };
      var body =
        field("Name", input("name", v.name, "text", "required")) +
        '<div class="field-row">' +
        field("Company", input("company", v.company)) +
        field("Email", input("email", v.email, "email")) +
        "</div>" +
        '<div class="field-row">' +
        field("Status", '<select name="status">' + CLIENT_STATUSES.map(function (s) {
          return '<option value="' + s + '"' + (v.status === s ? " selected" : "") + ">" + s + "</option>";
        }).join("") + "</select>") +
        field("Follow-up date", input("followUp", v.followUp, "date")) +
        "</div>" +
        field("Notes", '<textarea name="notes">' + esc(v.notes) + "</textarea>") +
        '<div class="form-actions"><button class="btn btn-primary" id="cf-save">' + (c ? "Save changes" : "Add client") + "</button></div>";
      openModal(c ? "Edit client" : "Add client", body, function (host) {
        host.querySelector("#cf-save").addEventListener("click", function () {
          var vals = formValues(host);
          if (!vals.name.trim()) { alert("Name is required."); return; }
          if (vals.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vals.email)) { alert("That email doesn't look right."); return; }
          if (c) Object.assign(c, { name: vals.name.trim(), company: vals.company.trim(), email: vals.email.trim(), status: vals.status, notes: vals.notes.trim(), followUp: vals.followUp });
          else state.clients.push({ id: uid("c"), name: vals.name.trim(), company: vals.company.trim(), email: vals.email.trim(), status: vals.status, notes: vals.notes.trim(), followUp: vals.followUp });
          closeModal(); mutate();
        });
      });
    }

    /* ---------- invoices tab ---------- */
    function nextInvoiceNumber() {
      var max = 0;
      state.invoices.forEach(function (i) {
        var m = /(\d+)\s*$/.exec(i.number || "");
        if (m) max = Math.max(max, parseInt(m[1], 10));
      });
      return "INV-" + (max >= 1000 ? max + 1 : 1043 + state.invoices.length);
    }

    function renderInvoices(panel) {
      var cur = state.settings.currency || "USD";
      var outstanding = 0, paidTotal = 0, overdueN = 0;
      state.invoices.forEach(function (i) {
        var t = invoiceTotals(i).total;
        if (i.status === "paid") paidTotal += t;
        else outstanding += t;
        if (i.status === "overdue" || (i.status !== "paid" && daysUntil(i.due) != null && daysUntil(i.due) < 0)) overdueN++;
      });
      var html = '<div class="section-head"><h2>Invoices</h2>' +
        '<button class="btn btn-primary btn-sm" id="add-invoice">+ New invoice</button></div>' +
        '<div class="pipeline-stats">' +
        '<div class="stat"><div class="n" style="color:var(--accent-2)">' + esc(money(outstanding, cur)) + '</div><div class="l">Outstanding</div></div>' +
        '<div class="stat"><div class="n" style="color:var(--accent)">' + esc(money(paidTotal, cur)) + '</div><div class="l">Paid</div></div>' +
        '<div class="stat"><div class="n" style="color:' + (overdueN ? "var(--err)" : "var(--muted)") + '">' + overdueN + '</div><div class="l">Overdue</div></div>' +
        "</div>";
      if (!state.invoices.length) {
        html += '<div class="empty"><span class="big">🧾</span><strong>No invoices yet</strong><p>Create your first invoice — line items, tax, PDF export, all in one place.</p></div>';
      } else {
        html += '<div class="table-wrap"><table class="data"><thead><tr>' +
          "<th>#</th><th>Client</th><th>Total</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>";
        state.invoices.slice().reverse().forEach(function (i) {
          var t = invoiceTotals(i).total;
          var effStatus = i.status;
          if (effStatus !== "paid" && daysUntil(i.due) != null && daysUntil(i.due) < 0) effStatus = "overdue";
          html += "<tr><td><strong>" + esc(i.number) + "</strong></td>" +
            "<td>" + esc(clientName(i.clientId)) + "</td>" +
            "<td><strong>" + esc(money(t, cur)) + "</strong></td>" +
            "<td>" + fmtDate(i.due) + "</td>" +
            '<td><span class="pill pill-' + esc(effStatus) + '">' + esc(effStatus) + "</span></td>" +
            '<td style="white-space:nowrap">' +
            '<button class="btn btn-sm" data-edit-inv="' + esc(i.id) + '">Edit</button> ' +
            '<button class="btn btn-sm" data-pdf-inv="' + esc(i.id) + '">PDF</button> ' +
            '<button class="btn btn-sm btn-danger" data-del-inv="' + esc(i.id) + '">Delete</button></td></tr>';
        });
        html += "</tbody></table></div>";
      }
      panel.innerHTML = html;
      document.getElementById("add-invoice").addEventListener("click", function () { invoiceForm(null); });
      panel.querySelectorAll("[data-edit-inv]").forEach(function (b) {
        b.addEventListener("click", function () { invoiceForm(b.getAttribute("data-edit-inv")); });
      });
      panel.querySelectorAll("[data-pdf-inv]").forEach(function (b) {
        b.addEventListener("click", function () {
          var inv = state.invoices.find(function (x) { return x.id === b.getAttribute("data-pdf-inv"); });
          if (inv) downloadInvoicePdf(inv);
        });
      });
      panel.querySelectorAll("[data-del-inv]").forEach(function (b) {
        b.addEventListener("click", function () {
          var id = b.getAttribute("data-del-inv");
          var inv = state.invoices.find(function (x) { return x.id === id; });
          if (confirm("Delete invoice " + (inv ? inv.number : "") + "? This can't be undone.")) {
            state.invoices = state.invoices.filter(function (x) { return x.id !== id; });
            mutate();
          }
        });
      });
    }

    function invoiceForm(id) {
      var inv = id ? state.invoices.find(function (x) { return x.id === id; }) : null;
      var v = inv || { number: nextInvoiceNumber(), clientId: state.clients[0] ? state.clients[0].id : "", items: [{ desc: "", qty: 1, rate: 0 }], tax: 0, discount: 0, status: "draft", issued: todayStr(), due: "", notes: "" };
      var items = (v.items && v.items.length ? v.items : [{ desc: "", qty: 1, rate: 0 }]).map(function (it) {
        return { desc: it.desc || "", qty: it.qty == null ? 1 : it.qty, rate: it.rate == null ? 0 : it.rate };
      });

      function itemsHtml() {
        return items.map(function (it, idx) {
          return '<div class="line-item" data-idx="' + idx + '">' +
            '<input data-f="desc" placeholder="Description" value="' + esc(it.desc) + '">' +
            '<input data-f="qty" type="number" min="0" step="any" placeholder="Qty" value="' + esc(it.qty) + '">' +
            '<input data-f="rate" type="number" min="0" step="any" placeholder="Rate" value="' + esc(it.rate) + '">' +
            '<button type="button" class="rm" data-rm="' + idx + '" aria-label="Remove line">×</button></div>';
        }).join("");
      }

      var body =
        '<div class="field-row">' +
        field("Invoice #", input("number", v.number, "text", "required")) +
        field("Client", '<select name="clientId">' + state.clients.map(function (c) {
          return '<option value="' + esc(c.id) + '"' + (v.clientId === c.id ? " selected" : "") + ">" + esc(c.company ? c.name + " · " + c.company : c.name) + "</option>";
        }).join("") + (state.clients.length ? "" : '<option value="">— add a client first —</option>') + "</select>") +
        "</div>" +
        '<div class="field"><label>Line items</label><div class="line-items" id="line-items">' + itemsHtml() + '</div>' +
        '<button type="button" class="btn btn-sm" id="add-line">+ Add line</button></div>' +
        '<div class="field-row">' +
        field("Tax %", input("tax", v.tax, "number", 'min="0" step="any"')) +
        field("Discount (flat)", input("discount", v.discount, "number", 'min="0" step="any"')) +
        "</div>" +
        '<div class="field-row">' +
        field("Issued", input("issued", v.issued, "date")) +
        field("Due", input("due", v.due, "date")) +
        "</div>" +
        '<div class="field-row">' +
        field("Status", '<select name="status">' + INVOICE_STATUSES.map(function (s) {
          return '<option value="' + s + '"' + (v.status === s ? " selected" : "") + ">" + s + "</option>";
        }).join("") + "</select>") +
        "</div>" +
        field("Notes", '<textarea name="notes" rows="2">' + esc(v.notes) + "</textarea>") +
        '<div class="invoice-totals" id="inv-totals"></div>' +
        '<div class="form-actions"><button class="btn btn-primary" id="if-save">' + (inv ? "Save changes" : "Create invoice") + "</button></div>";

      openModal(inv ? "Edit invoice " + v.number : "New invoice", body, function (host) {
        function readItems() {
          var out = [];
          host.querySelectorAll(".line-item").forEach(function (row) {
            out.push({
              desc: row.querySelector('[data-f="desc"]').value,
              qty: parseFloat(row.querySelector('[data-f="qty"]').value) || 0,
              rate: parseFloat(row.querySelector('[data-f="rate"]').value) || 0
            });
          });
          return out;
        }
        function refreshTotals() {
          var vals = formValues(host);
          var t = invoiceTotals({ items: readItems(), tax: vals.tax, discount: vals.discount });
          var cur = state.settings.currency || "USD";
          host.querySelector("#inv-totals").innerHTML =
            '<div class="row"><span>Subtotal</span><span>' + esc(money(t.sub, cur)) + '</span></div>' +
            '<div class="row"><span>Discount</span><span>−' + esc(money(t.discount, cur)) + '</span></div>' +
            '<div class="row"><span>Tax</span><span>' + esc(money(t.tax, cur)) + '</span></div>' +
            '<div class="row grand"><span>Total</span><span>' + esc(money(t.total, cur)) + '</span></div>';
        }
        host.addEventListener("input", refreshTotals);
        host.querySelector("#add-line").addEventListener("click", function () {
          items.push({ desc: "", qty: 1, rate: 0 });
          host.querySelector("#line-items").innerHTML = itemsHtml();
          wireRm(); refreshTotals();
        });
        function wireRm() {
          host.querySelectorAll("[data-rm]").forEach(function (b) {
            b.addEventListener("click", function () {
              items.splice(parseInt(b.getAttribute("data-rm"), 10), 1);
              if (!items.length) items.push({ desc: "", qty: 1, rate: 0 });
              host.querySelector("#line-items").innerHTML = itemsHtml();
              wireRm(); refreshTotals();
            });
          });
        }
        wireRm(); refreshTotals();
        host.querySelector("#if-save").addEventListener("click", function () {
          var vals = formValues(host);
          var finalItems = readItems().filter(function (it) { return it.desc.trim() || it.qty || it.rate; });
          if (!vals.number.trim()) { alert("Invoice number is required."); return; }
          if (!finalItems.length) { alert("Add at least one line item."); return; }
          var data = { number: vals.number.trim(), clientId: vals.clientId, items: finalItems, tax: parseFloat(vals.tax) || 0, discount: parseFloat(vals.discount) || 0, status: vals.status, issued: vals.issued, due: vals.due, notes: vals.notes.trim() };
          if (inv) Object.assign(inv, data);
          else state.invoices.push(Object.assign({ id: uid("i") }, data));
          closeModal(); mutate();
        });
      });
    }

    /* ---------- branded invoice PDF (jsPDF, manual table — no plugins) ---------- */
    function hexToRgb(hex) {
      var h = String(hex || "#34d399").replace("#", "");
      if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
      var n = parseInt(h, 16);
      return [ (n >> 16) & 255, (n >> 8) & 255, n & 255 ];
    }
    function downloadInvoicePdf(inv) {
      if (!window.jspdf || !window.jspdf.jsPDF) {
        alert("PDF library is still loading — check your connection and try again in a moment.");
        return;
      }
      var s = state.settings;
      var cur = s.currency || "USD";
      var t = invoiceTotals(inv);
      var accent = hexToRgb(s.accent);
      var doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
      var W = 595, M = 48, y = 64;

      doc.setFillColor(accent[0], accent[1], accent[2]);
      doc.rect(0, 0, W, 10, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(20, 20, 20);
      doc.text(s.businessName || "Freelancer", M, y);
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(110, 110, 110);
      if (s.email) { y += 18; doc.text(s.email, M, y); }
      y += 34;
      doc.setFontSize(26); doc.setTextColor(20, 20, 20); doc.setFont("helvetica", "bold");
      doc.text("INVOICE", M, y);
      doc.setFontSize(11); doc.setFont("helvetica", "normal"); doc.setTextColor(110, 110, 110);
      doc.text(inv.number, M, y + 18);
      var rx = W - M - 170;
      doc.setFontSize(10);
      doc.text("Bill to:", rx, y - 8);
      doc.setFont("helvetica", "bold"); doc.setTextColor(20, 20, 20);
      doc.text(clientName(inv.clientId), rx, y + 8);
      doc.setFont("helvetica", "normal"); doc.setTextColor(110, 110, 110);
      var c = state.clients.find(function (x) { return x.id === inv.clientId; });
      var cy = y + 24;
      if (c && c.email) { doc.text(c.email, rx, cy); cy += 14; }
      doc.text("Issued: " + fmtDate(inv.issued), rx, cy); cy += 14;
      doc.text("Due: " + fmtDate(inv.due), rx, cy);
      y += 52;

      /* table header */
      doc.setFillColor(245, 247, 250); doc.rect(M, y - 12, W - 2 * M, 26, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(100, 100, 100);
      doc.text("DESCRIPTION", M + 8, y + 5);
      doc.text("QTY", M + 300, y + 5);
      doc.text("RATE", M + 360, y + 5);
      doc.text("AMOUNT", W - M - 8, y + 5, { align: "right" });
      y += 26;
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(30, 30, 30);
      inv.items.forEach(function (it) {
        var lines = doc.splitTextToSize(it.desc || "—", 270);
        var h = Math.max(20, lines.length * 13 + 8);
        if (y + h > 760) { doc.addPage(); y = 64; }
        doc.text(lines, M + 8, y + 4);
        doc.text(String(it.qty), M + 300, y + 4);
        doc.text(money(it.rate, cur), M + 360, y + 4);
        doc.text(money((Number(it.qty) || 0) * (Number(it.rate) || 0), cur), W - M - 8, y + 4, { align: "right" });
        y += h;
        doc.setDrawColor(230, 230, 230); doc.line(M, y, W - M, y); y += 6;
      });
      y += 10;
      var tx = W - M - 170;
      doc.setFontSize(10); doc.setTextColor(110, 110, 110);
      doc.text("Subtotal", tx, y); doc.text(money(t.sub, cur), W - M - 8, y, { align: "right" }); y += 16;
      if (t.discount) { doc.text("Discount", tx, y); doc.text("−" + money(t.discount, cur), W - M - 8, y, { align: "right" }); y += 16; }
      if (t.tax) { doc.text("Tax", tx, y); doc.text(money(t.tax, cur), W - M - 8, y, { align: "right" }); y += 16; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(20, 20, 20);
      doc.text("Total due", tx, y + 6);
      doc.setTextColor(accent[0], accent[1], accent[2]);
      doc.text(money(t.total, cur), W - M - 8, y + 6, { align: "right" });
      y += 40;
      if (inv.notes) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(110, 110, 110);
        doc.text("Notes:", M, y); y += 14;
        doc.splitTextToSize(inv.notes, W - 2 * M).forEach(function (ln) { doc.text(ln, M, y); y += 13; });
      }
      doc.setFontSize(9); doc.setTextColor(150, 150, 150);
      doc.text("Generated with FreelancerOS", M, 820);
      if (cfg.mode === "demo") doc.text("DEMO — sample data", W - M, 820, { align: "right" });
      doc.save((inv.number || "invoice").replace(/[^a-zA-Z0-9-_]/g, "_") + ".pdf");
    }

    /* ---------- content tab ---------- */
    function renderContent(panel) {
      var html = '<div class="section-head"><h2>Content pipeline</h2>' +
        '<button class="btn btn-primary btn-sm" id="add-card">+ New card</button></div>' +
        '<p class="lede" style="font-size:14px">Ideas in, published content out. Move cards as they progress.</p>' +
        '<div class="kanban">';
      STAGES.forEach(function (st) {
        var cards = state.content.filter(function (k) { return k.stage === st.id; });
        html += '<div class="kanban-col"><h3>' + esc(st.label) + ' <span class="count">' + cards.length + "</span></h3>";
        cards.forEach(function (k) {
          var si = STAGES.findIndex(function (x) { return x.id === k.stage; });
          html += '<div class="kcard"><h4>' + esc(k.title) + "</h4>" +
            (k.platform ? '<span class="platform">' + esc(k.platform) + "</span>" : "") +
            (k.notes ? "<p>" + esc(k.notes) + "</p>" : "") +
            '<div class="moves">' +
            (si > 0 ? '<button data-move="' + esc(k.id) + "|" + STAGES[si - 1].id + '">← ' + esc(STAGES[si - 1].label) + "</button>" : "") +
            (si < STAGES.length - 1 ? '<button data-move="' + esc(k.id) + "|" + STAGES[si + 1].id + '">' + esc(STAGES[si + 1].label) + " →</button>" : "") +
            '<button data-edit-card="' + esc(k.id) + '">Edit</button>' +
            '<button data-del-card="' + esc(k.id) + '">Delete</button>' +
            "</div></div>";
        });
        html += "</div>";
      });
      html += "</div>";
      panel.innerHTML = html;
      document.getElementById("add-card").addEventListener("click", function () { cardForm(null); });
      panel.querySelectorAll("[data-move]").forEach(function (b) {
        b.addEventListener("click", function () {
          var parts = b.getAttribute("data-move").split("|");
          var k = state.content.find(function (x) { return x.id === parts[0]; });
          if (k) { k.stage = parts[1]; mutate(); }
        });
      });
      panel.querySelectorAll("[data-edit-card]").forEach(function (b) {
        b.addEventListener("click", function () { cardForm(b.getAttribute("data-edit-card")); });
      });
      panel.querySelectorAll("[data-del-card]").forEach(function (b) {
        b.addEventListener("click", function () {
          var id = b.getAttribute("data-del-card");
          if (confirm("Delete this card?")) {
            state.content = state.content.filter(function (x) { return x.id !== id; });
            mutate();
          }
        });
      });
    }

    function cardForm(id) {
      var k = id ? state.content.find(function (x) { return x.id === id; }) : null;
      var v = k || { title: "", platform: "", stage: "ideas", notes: "" };
      var body =
        field("Title", input("title", v.title, "text", "required")) +
        '<div class="field-row">' +
        field("Platform", input("platform", v.platform, "text", 'placeholder="Instagram, LinkedIn, blog…"')) +
        field("Stage", '<select name="stage">' + STAGES.map(function (s) {
          return '<option value="' + s.id + '"' + (v.stage === s.id ? " selected" : "") + ">" + s.label + "</option>";
        }).join("") + "</select>") +
        "</div>" +
        field("Notes", '<textarea name="notes">' + esc(v.notes) + "</textarea>") +
        '<div class="form-actions"><button class="btn btn-primary" id="kf-save">' + (k ? "Save changes" : "Add card") + "</button></div>";
      openModal(k ? "Edit card" : "New card", body, function (host) {
        host.querySelector("#kf-save").addEventListener("click", function () {
          var vals = formValues(host);
          if (!vals.title.trim()) { alert("Title is required."); return; }
          if (k) Object.assign(k, { title: vals.title.trim(), platform: vals.platform.trim(), stage: vals.stage, notes: vals.notes.trim() });
          else state.content.push({ id: uid("k"), title: vals.title.trim(), platform: vals.platform.trim(), stage: vals.stage, notes: vals.notes.trim() });
          closeModal(); mutate();
        });
      });
    }

    /* ---------- templates tab ---------- */
    var TEMPLATES = [
      { file: "contract-template.md", name: "Freelancer Contract", desc: "Scope, payment terms, revisions, late fees, IP transfer, termination. The paperwork that keeps projects clean." },
      { file: "proposal-template.md", name: "Proposal Template", desc: "A proposal structure that sells the outcome, handles objections, and makes saying yes easy." },
      { file: "onboarding-form.md", name: "Client Onboarding Form", desc: "Every question to ask before work starts — contacts, assets, access, timelines, and expectations." }
    ];
    var templateCache = {};

    function fillTemplate(text) {
      var s = state.settings;
      var d = new Date();
      var dateStr = d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
      return String(text)
        .replace(/\{\{\s*business_name\s*\}\}/g, s.businessName || "[Your Business Name]")
        .replace(/\{\{\s*business_email\s*\}\}/g, s.email || "[your@email.com]")
        .replace(/\{\{\s*client_name\s*\}\}/g, "[Client Name]")
        .replace(/\{\{\s*date\s*\}\}/g, dateStr);
    }

    function renderTemplates(panel) {
      var html = '<div class="section-head"><h2>Template pack</h2></div>' +
        '<p class="lede" style="font-size:14px">Your business name and email fill in automatically from Settings. Copy straight into a doc, or download the markdown.</p>';
      if (cfg.templatesLocked) {
        html += '<div class="template-cards">' + TEMPLATES.map(function (t) {
          return '<div class="template-card"><h3>' + esc(t.name) + "</h3><p>" + esc(t.desc) + "</p>" +
            '<div class="actions"><button class="btn btn-sm" disabled>🔒 Locked in demo</button></div></div>';
        }).join("") + "</div>" +
        '<div class="lock-note"><strong>Unlock the template pack</strong><p class="muted" style="font-size:14px;margin:8px 0 14px">The contract, proposal, and onboarding templates unlock with your $29 purchase — along with cloud saving for everything.</p>' +
        '<button class="btn btn-primary" data-buy>Unlock FreelancerOS — $29</button></div>';
      } else {
        html += '<div class="template-cards" id="template-cards">' + TEMPLATES.map(function (t, i) {
          return '<div class="template-card"><h3>' + esc(t.name) + "</h3><p>" + esc(t.desc) + "</p>" +
            '<div class="actions"><button class="btn btn-sm" data-tcopy="' + i + '">Copy</button> ' +
            '<button class="btn btn-sm" data-tdl="' + i + '">Download .md</button></div>' +
            '<div class="status" id="tstat-' + i + '"></div></div>';
        }).join("") + "</div>";
      }
      panel.innerHTML = html;
      if (cfg.templatesLocked) {
        if (window.FreelancerOSCheckout) {
          panel.querySelectorAll("[data-buy]").forEach(function (b) {
            b.addEventListener("click", function () { window.FreelancerOSCheckout.openBuyModal(); });
          });
        }
        return;
      }
      function getTemplate(i, cb) {
        var t = TEMPLATES[i];
        if (templateCache[t.file]) { cb(fillTemplate(templateCache[t.file])); return; }
        var st = document.getElementById("tstat-" + i);
        if (st) { st.textContent = "Loading…"; st.className = "status busy"; }
        fetch("templates/" + t.file).then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.text();
        }).then(function (text) {
          templateCache[t.file] = text;
          if (st) { st.textContent = ""; st.className = "status"; }
          cb(fillTemplate(text));
        }).catch(function () {
          if (st) { st.textContent = "Couldn't load the template — check your connection."; st.className = "status error"; }
        });
      }
      function download(name, text) {
        var blob = new Blob([text], { type: "text/markdown" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      }
      panel.querySelectorAll("[data-tcopy]").forEach(function (b) {
        b.addEventListener("click", function () {
          var i = parseInt(b.getAttribute("data-tcopy"), 10);
          getTemplate(i, function (text) {
            var done = function (ok) {
              var st = document.getElementById("tstat-" + i);
              if (st) { st.textContent = ok ? "Copied ✓" : "Copy failed — download instead."; st.className = "status" + (ok ? "" : " error"); }
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
            } else {
              var ta = document.createElement("textarea");
              ta.value = text; document.body.appendChild(ta); ta.select();
              try { done(document.execCommand("copy")); } catch (e) { done(false); }
              ta.remove();
            }
          });
        });
      });
      panel.querySelectorAll("[data-tdl]").forEach(function (b) {
        b.addEventListener("click", function () {
          var i = parseInt(b.getAttribute("data-tdl"), 10);
          getTemplate(i, function (text) { download(TEMPLATES[i].file, text); });
        });
      });
    }

    /* ---------- settings tab ---------- */
    function renderSettings(panel) {
      var s = state.settings;
      var html = '<div class="section-head"><h2>Settings</h2></div>' +
        '<div class="card" style="max-width:640px">' +
        field("Business name", input("businessName", s.businessName, "text", 'placeholder="Your studio or freelance name" id="set-biz"')) +
        '<div class="field-row">' +
        field("Email", input("email", s.email, "email", 'id="set-email"')) +
        field("Currency", '<select id="set-cur">' + Object.keys(CURRENCIES).map(function (c) {
          return '<option value="' + c + '"' + (s.currency === c ? " selected" : "") + ">" + c + " (" + CURRENCIES[c] + ")</option>";
        }).join("") + "</select>") +
        "</div>" +
        field("Brand accent", '<input type="color" id="set-accent" value="' + esc(s.accent || "#34d399") + '" style="height:44px;padding:4px;width:100%">') +
        '<div class="form-actions"><button class="btn btn-primary" id="set-save">Save settings</button></div>' +
        '<div class="status" id="set-status"></div></div>' +
        '<div class="card" style="max-width:640px;margin-top:16px"><h3>Your data</h3>' +
        '<p class="muted" style="font-size:14px">Export a full backup any time. Import restores from a backup file.</p>' +
        '<div class="form-actions"><button class="btn" id="set-export">Export JSON</button> ' +
        '<label class="btn" style="cursor:pointer">Import JSON<input type="file" id="set-import" accept="application/json" hidden></label></div>' +
        '<div class="status" id="data-status"></div>' +
        (cfg.mode === "demo" ? "" : '<hr style="border:none;border-top:1px solid var(--line);margin:18px 0">' +
          '<h3 style="color:var(--err)">Danger zone</h3>' +
          '<p class="muted" style="font-size:14px">Wipe all dashboard data and start fresh. This cannot be undone.</p>' +
          '<button class="btn btn-danger btn-sm" id="set-reset">Reset all data</button>') +
        "</div>";
      panel.innerHTML = html;
      document.getElementById("set-save").addEventListener("click", function () {
        var biz = document.getElementById("set-biz").value.trim();
        var em = document.getElementById("set-email").value.trim();
        if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
          document.getElementById("set-status").textContent = "That email doesn't look right.";
          document.getElementById("set-status").className = "status error";
          return;
        }
        s.businessName = biz; s.email = em;
        s.currency = document.getElementById("set-cur").value;
        s.accent = document.getElementById("set-accent").value;
        document.documentElement.style.setProperty("--accent", s.accent);
        mutate(); /* re-renders — set the confirmation after */
        var st = document.getElementById("set-status");
        if (st) { st.textContent = "Saved ✓"; st.className = "status"; }
      });
      document.getElementById("set-accent").addEventListener("input", function (e) {
        document.documentElement.style.setProperty("--accent", e.target.value);
      });
      document.getElementById("set-export").addEventListener("click", function () {
        var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "freelanceros-backup-" + todayStr() + ".json";
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
        document.getElementById("data-status").textContent = "Backup downloaded ✓";
        document.getElementById("data-status").className = "status";
      });
      document.getElementById("set-import").addEventListener("change", function (e) {
        var f = e.target.files[0];
        if (!f) return;
        var r = new FileReader();
        r.onload = function () {
          try {
            var data = JSON.parse(r.result);
            if (!data || !Array.isArray(data.clients) || !Array.isArray(data.invoices)) throw new Error("bad shape");
            state = Object.assign(freshState(), data);
            document.getElementById("data-status").textContent = "Imported ✓";
            document.getElementById("data-status").className = "status";
            mutate();
          } catch (err) {
            document.getElementById("data-status").textContent = "That file isn't a FreelancerOS backup.";
            document.getElementById("data-status").className = "status error";
          }
        };
        r.readAsText(f);
        e.target.value = "";
      });
      var resetBtn = document.getElementById("set-reset");
      if (resetBtn) {
        resetBtn.addEventListener("click", function () {
          if (confirm("Reset ALL dashboard data? This cannot be undone.")) {
            var keepSettings = state.settings;
            state = freshState(); state.settings = keepSettings;
            mutate();
          }
        });
      }
    }

    /* ---------- init ---------- */
    function applyAccent() {
      if (state.settings && state.settings.accent) {
        document.documentElement.style.setProperty("--accent", state.settings.accent);
      }
    }
    function start(loaded) {
      state = loaded || (cfg.mode === "demo" ? sampleState() : freshState());
      if (!state.settings) state.settings = freshState().settings;
      applyAccent();
      render();
      if (cfg.mode === "demo") setSaveNote("");
    }
    root.innerHTML = '<div class="empty"><span class="big">⏳</span><strong>Loading your dashboard…</strong></div>';
    Promise.resolve()
      .then(function () { return cfg.load(); })
      .then(function (loaded) { start(loaded); })
      .catch(function () { start(null); });
  }

  window.FreelancerOS = { boot: boot };
})();

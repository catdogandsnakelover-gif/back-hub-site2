// ---------- starfield ----------
(function () {
  const canvas = document.getElementById("stars");
  const ctx = canvas.getContext("2d");
  let stars = [];
  function resize() {
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    stars = Array.from({ length: Math.min(260, innerWidth) }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.6 + 0.3,
      p: Math.random() * Math.PI * 2,
      s: 0.5 + Math.random() * 1.5,
    }));
  }
  resize();
  addEventListener("resize", resize);
  (function tick(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const st of stars) {
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(t / 1000 * st.s + st.p));
      ctx.globalAlpha = tw;
      ctx.fillStyle = "#cfe9ff";
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(tick);
  })(0);
})();

// ---------- views ----------
const views = ["view-gate", "view-hubs", "view-admin-login", "view-console"];
function show(id) {
  for (const v of views) document.getElementById(v).hidden = v !== id;
}
document.querySelectorAll("[data-back]").forEach((b) =>
  b.addEventListener("click", () => show("view-gate"))
);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

// ---------- key gate ----------
document.getElementById("gate-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("gate-error");
  err.textContent = "";
  try {
    const data = await api("/api/redeem", {
      method: "POST",
      body: JSON.stringify({ key: document.getElementById("gate-key").value }),
    });
    renderHubs(data.hubs);
    show("view-hubs");
  } catch (ex) {
    err.textContent = ex.message;
  }
});

function renderHubs(hubs) {
  const list = document.getElementById("hub-list");
  list.innerHTML = hubs.length
    ? hubs
        .map(
          (h) =>
            `<a class="hub-card" href="${esc(h.url)}" target="_blank" rel="noopener">🚀 ${esc(h.name)}<span class="url">${esc(h.url)}</span></a>`
        )
        .join("")
    : `<p class="muted">No hubs yet — the owner hasn't added any.</p>`;
}

document.getElementById("lock-btn").addEventListener("click", () => {
  document.getElementById("gate-key").value = "";
  show("view-gate");
});

// ---------- admin ----------
document.getElementById("goto-admin").addEventListener("click", async () => {
  try {
    const me = await api("/api/admin/me");
    if (me.admin) {
      await loadConsole();
      show("view-console");
      return;
    }
  } catch {}
  show("view-admin-login");
});

document.getElementById("admin-login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("admin-login-error");
  err.textContent = "";
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ email: document.getElementById("admin-email").value }),
    });
    document.getElementById("admin-email").value = "";
    await loadConsole();
    show("view-console");
  } catch (ex) {
    err.textContent = ex.message;
  }
});

document.getElementById("admin-logout").addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" }).catch(() => {});
  show("view-gate");
});

// ---------- owner console ----------
async function loadConsole() {
  await Promise.all([loadKeys(), loadAdminHubs()]);
}

async function loadKeys() {
  const { keys } = await api("/api/admin/keys");
  const list = document.getElementById("key-list");
  list.innerHTML = keys.length
    ? keys
        .map(
          (k) => `
      <div class="list-item" data-id="${k.id}">
        <div><code>${esc(k.code)}</code>
          <span class="meta">${k.uses_left} of ${k.max_uses} uses left · created ${esc(k.created_at)}</span>
        </div>
        <div class="actions">
          <input class="uses-input" type="number" min="1" max="10000" value="${k.max_uses}" title="Allowed uses" />
          <button class="icon-btn save-uses" title="Save allowed uses">save</button>
          <button class="icon-btn del-key" title="Revoke key">revoke</button>
        </div>
      </div>`
        )
        .join("")
    : `<p class="muted">No keys yet. Generate one above.</p>`;

  list.querySelectorAll(".list-item").forEach((el) => {
    const id = el.dataset.id;
    el.querySelector(".del-key").addEventListener("click", async () => {
      if (!confirm("Revoke this key?")) return;
      await api(`/api/admin/keys/${id}`, { method: "DELETE" });
      loadKeys();
    });
    el.querySelector(".save-uses").addEventListener("click", async () => {
      const maxUses = Number(el.querySelector(".uses-input").value);
      try {
        await api(`/api/admin/keys/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ max_uses: maxUses }),
        });
        loadKeys();
      } catch (ex) {
        alert(ex.message);
      }
    });
  });
}

document.getElementById("key-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const { key } = await api("/api/admin/keys", {
      method: "POST",
      body: JSON.stringify({ max_uses: Number(document.getElementById("key-uses").value) || 1 }),
    });
    const box = document.getElementById("new-key");
    box.hidden = false;
    box.innerHTML = `${esc(key.code)}<small>tap to copy — send this to whoever you want to let in</small>`;
    box.onclick = () => navigator.clipboard.writeText(key.code).catch(() => {});
    loadKeys();
  } catch (ex) {
    alert(ex.message);
  }
});

async function loadAdminHubs() {
  const { hubs } = await api("/api/admin/hubs");
  const list = document.getElementById("admin-hub-list");
  list.innerHTML = hubs.length
    ? hubs
        .map(
          (h) => `
      <div class="list-item" data-id="${h.id}">
        <div><strong>${esc(h.name)}</strong><span class="meta">${esc(h.url)}</span></div>
        <div class="actions"><button class="icon-btn del-hub">remove</button></div>
      </div>`
        )
        .join("")
    : `<p class="muted">No hubs yet.</p>`;
  list.querySelectorAll(".list-item").forEach((el) => {
    el.querySelector(".del-hub").addEventListener("click", async () => {
      if (!confirm(`Remove "${el.querySelector("strong").textContent}"?`)) return;
      await api(`/api/admin/hubs/${el.dataset.id}`, { method: "DELETE" });
      loadAdminHubs();
    });
  });
}

document.getElementById("hub-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("hub-form-error");
  err.textContent = "";
  try {
    await api("/api/admin/hubs", {
      method: "POST",
      body: JSON.stringify({
        name: document.getElementById("hub-name").value,
        url: document.getElementById("hub-url").value,
      }),
    });
    document.getElementById("hub-name").value = "";
    document.getElementById("hub-url").value = "";
    loadAdminHubs();
  } catch (ex) {
    err.textContent = ex.message;
  }
});

// If the visitor already has a valid access cookie, skip the gate.
(async () => {
  try {
    const { hubs } = await api("/api/hubs");
    renderHubs(hubs);
    show("view-hubs");
  } catch {
    show("view-gate");
  }
})();

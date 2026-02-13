function initStage(containerId) {
  const stage = new NGL.Stage(containerId, { backgroundColor: "#f6f7f5" });
  window.addEventListener("resize", () => stage.handleResize(), false);
  return stage;
}

function loadPdbIntoStage(stage, pdbText) {
  stage.removeAllComponents();
  const blob = new Blob([pdbText], { type: "text/plain" });
  stage.loadFile(blob, { ext: "pdb" }).then((component) => {
    component.addRepresentation("cartoon", { color: "chainname" });
    component.addRepresentation("ball+stick", { sele: "hetero and not water" });
    component.autoView();
  });
}

function setStatus(id, message, isError = false) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.className = `status ${isError ? "error" : "ok"}`;
}

function clearStatus(id) {
  const el = document.getElementById(id);
  el.textContent = "";
  el.className = "status";
}

function renderInteractionsTable(rows) {
  const tbody = document.querySelector("#single-table tbody");
  tbody.innerHTML = "";

  for (const row of rows.slice(0, 500)) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.interaction_type}</td>
      <td>${row.receptor_chain}:${row.receptor_resname}${row.receptor_resseq}</td>
      <td>${row.receptor_atom}</td>
      <td>${row.ligand_atom}</td>
      <td>${row.distance.toFixed(3)}</td>
    `;
    tbody.appendChild(tr);
  }
}

function formatSig(item) {
  return `${item.interaction_type} | ${item.receptor_chain}:${item.receptor_resname}${item.receptor_resseq}`;
}

function renderCompactList(id, items, emptyText) {
  const list = document.getElementById(id);
  list.innerHTML = "";
  if (items.length === 0) {
    const li = document.createElement("li");
    li.textContent = emptyText;
    list.appendChild(li);
    return;
  }

  for (const item of items.slice(0, 300)) {
    const li = document.createElement("li");
    li.textContent = formatSig(item);
    list.appendChild(li);
  }
}

const singleStage = initStage("viewer-single");
const compareStage1 = initStage("viewer-1");
const compareStage2 = initStage("viewer-2");

document.getElementById("analyze-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus("analyze-status");

  const form = e.target;
  const formData = new FormData(form);

  try {
    setStatus("analyze-status", "Running analysis...");
    const response = await fetch("/api/analyze", { method: "POST", body: formData });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }

    loadPdbIntoStage(singleStage, data.pdb);
    renderInteractionsTable(data.interactions);

    document.getElementById("single-summary").textContent =
      `Ligand: ${data.ligand.name} | Chain: ${data.ligand.chain || "auto"} | Interactions: ${data.interaction_count} | Engine: ${data.engine_used}`;

    if (data.warnings && data.warnings.length > 0) {
      setStatus("analyze-status", data.warnings.join(" "), true);
    } else {
      setStatus("analyze-status", "Analysis complete.");
    }
  } catch (err) {
    setStatus("analyze-status", err.message, true);
  }
});

document.getElementById("compare-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus("compare-status");

  const form = e.target;
  const formData = new FormData(form);

  try {
    setStatus("compare-status", "Running comparison...");
    const response = await fetch("/api/compare", { method: "POST", body: formData });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }

    loadPdbIntoStage(compareStage1, data.pdb_1);
    loadPdbIntoStage(compareStage2, data.pdb_2);

    renderCompactList("shared-list", data.shared, "No shared interaction signatures.");
    renderCompactList("only-1-list", data.only_in_complex_1, "No unique signatures.");
    renderCompactList("only-2-list", data.only_in_complex_2, "No unique signatures.");

    document.getElementById("compare-summary").textContent =
      `Complex 1 interactions: ${data.complex_1.interaction_count} (${data.complex_1.engine_used}) | Complex 2 interactions: ${data.complex_2.interaction_count} (${data.complex_2.engine_used}) | Shared signatures: ${data.shared.length}`;

    const warnings = [...(data.complex_1.warnings || []), ...(data.complex_2.warnings || [])];
    if (warnings.length > 0) {
      setStatus("compare-status", warnings.join(" "), true);
    } else {
      setStatus("compare-status", "Comparison complete.");
    }
  } catch (err) {
    setStatus("compare-status", err.message, true);
  }
});

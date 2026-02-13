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

function clearStage(stage) {
  stage.removeAllComponents();
}

function setStatus(message, isError = false) {
  const el = document.getElementById("workflow-status");
  el.textContent = message;
  el.className = `status ${isError ? "error" : "ok"}`;
}

function clearStatus() {
  const el = document.getElementById("workflow-status");
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

function setRunButtonBusy(isBusy, modeLabel) {
  const button = document.getElementById("run-button");
  if (isBusy) {
    button.disabled = true;
    button.textContent = modeLabel === "compare" ? "Comparing..." : "Analyzing...";
  } else {
    button.disabled = false;
    button.textContent = "Run Analysis";
  }
}

function fileName(input) {
  const f = input.files && input.files[0];
  return f ? f.name : null;
}

function onFileSelectionChange() {
  const c1 = document.getElementById("complex-1-file");
  const c2 = document.getElementById("complex-2-file");
  const f1 = fileName(c1);
  const f2 = fileName(c2);

  if (!f1) {
    setStatus("Select Complex 1 to begin.", true);
    return;
  }

  if (f2) {
    setStatus(`Files selected: ${f1} and ${f2}. Ready to run comparison.`);
  } else {
    setStatus(`File selected: ${f1}. Ready to run single analysis.`);
  }
}

function setSingleModeVisible() {
  document.getElementById("single-results").style.display = "block";
  document.getElementById("compare-results").style.display = "none";
}

function setCompareModeVisible() {
  document.getElementById("single-results").style.display = "none";
  document.getElementById("compare-results").style.display = "block";
}

const stage1 = initStage("viewer-1");
const stage2 = initStage("viewer-2");

setSingleModeVisible();
clearStage(stage2);

const file1Input = document.getElementById("complex-1-file");
const file2Input = document.getElementById("complex-2-file");
file1Input.addEventListener("change", onFileSelectionChange);
file2Input.addEventListener("change", onFileSelectionChange);

document.getElementById("workflow-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus();

  const form = e.target;
  const c1 = fileName(file1Input);
  const c2 = fileName(file2Input);

  if (!c1) {
    setStatus("Complex 1 file is required.", true);
    return;
  }

  const mode = c2 ? "compare" : "single";
  setRunButtonBusy(true, mode);

  try {
    if (mode === "compare") {
      setStatus(`Starting comparison: ${c1} vs ${c2}...`);
      const formData = new FormData(form);
      const response = await fetch("/api/compare", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Comparison failed");
      }

      setCompareModeVisible();
      loadPdbIntoStage(stage1, data.pdb_1);
      loadPdbIntoStage(stage2, data.pdb_2);

      renderCompactList("shared-list", data.shared, "No shared interaction signatures.");
      renderCompactList("only-1-list", data.only_in_complex_1, "No unique signatures.");
      renderCompactList("only-2-list", data.only_in_complex_2, "No unique signatures.");

      document.getElementById("workflow-summary").textContent =
        `Complex 1 interactions: ${data.complex_1.interaction_count} (${data.complex_1.engine_used}) | Complex 2 interactions: ${data.complex_2.interaction_count} (${data.complex_2.engine_used}) | Shared signatures: ${data.shared.length}`;

      const warnings = [...(data.complex_1.warnings || []), ...(data.complex_2.warnings || [])];
      if (warnings.length > 0) {
        setStatus(warnings.join(" "), true);
      } else {
        setStatus(`Comparison complete: ${c1} vs ${c2}.`);
      }
    } else {
      setStatus(`Starting analysis of ${c1}...`);

      const formData = new FormData();
      formData.append("complex", file1Input.files[0]);
      formData.append("ligand_resname", form.elements.ligand_resname_1.value || "");
      formData.append("ligand_chain", form.elements.ligand_chain_1.value || "");
      formData.append("engine", form.elements.engine.value || "auto");

      const response = await fetch("/api/analyze", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Analysis failed");
      }

      setSingleModeVisible();
      loadPdbIntoStage(stage1, data.pdb);
      clearStage(stage2);
      renderInteractionsTable(data.interactions);

      document.getElementById("workflow-summary").textContent =
        `Ligand: ${data.ligand.name} | Chain: ${data.ligand.chain || "auto"} | Interactions: ${data.interaction_count} | Engine: ${data.engine_used}`;

      if (data.warnings && data.warnings.length > 0) {
        setStatus(data.warnings.join(" "), true);
      } else {
        setStatus(`Analysis complete: ${c1}.`);
      }
    }
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    setRunButtonBusy(false, mode);
  }
});

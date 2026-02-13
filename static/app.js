function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureNglLoaded() {
  if (typeof NGL !== "undefined") return true;

  const urls = [
    "https://cdn.jsdelivr.net/npm/ngl@2.1.0-dev.39/dist/ngl.js",
    "https://unpkg.com/ngl@2.1.0-dev.39/dist/ngl.js",
    "https://cdnjs.cloudflare.com/ajax/libs/ngl/2.0.0-dev.37/ngl.js",
  ];

  for (const url of urls) {
    try {
      await loadScript(url);
      if (typeof NGL !== "undefined") return true;
    } catch (_err) {
      // Try next CDN.
    }
  }

  return false;
}

function initStage(containerId) {
  if (typeof NGL === "undefined") {
    const el = document.getElementById(containerId);
    if (el) {
      el.innerHTML = "<div class='viewer-fallback'>3D viewer unavailable (NGL failed to load).</div>";
    }
    return null;
  }
  const stage = new NGL.Stage(containerId, { backgroundColor: "#f6f7f5" });
  window.addEventListener("resize", () => stage.handleResize(), false);
  return stage;
}

async function loadPdbIntoStage(stage, pdbText) {
  if (!stage) return null;
  stage.removeAllComponents();
  const blob = new Blob([pdbText], { type: "text/plain" });
  const component = await stage.loadFile(blob, { ext: "pdb" });
  component.addRepresentation("cartoon", { color: "chainname" });
  component.addRepresentation("ball+stick", { sele: "hetero and not water" });
  component.autoView();
  return component;
}

function clearStage(stage) {
  if (!stage) return;
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

function renderInteractionsTable(rows, handlers, activeIndex) {
  const tbody = document.querySelector("#single-table tbody");
  tbody.innerHTML = "";

  for (const [idx, row] of rows.slice(0, 500).entries()) {
    const tr = document.createElement("tr");
    tr.className = "interaction-row";
    tr.dataset.idx = String(idx);
    if (idx === activeIndex) {
      tr.classList.add("selected");
    }
    tr.innerHTML = `
      <td>${row.interaction_type}</td>
      <td>${row.receptor_chain}:${row.receptor_resname}${row.receptor_resseq}</td>
      <td>${row.receptor_atom}</td>
      <td>${row.ligand_atom}</td>
      <td>${row.distance.toFixed(3)}</td>
    `;
    tr.addEventListener("mouseenter", () => handlers.onHover(idx));
    tr.addEventListener("mouseleave", () => handlers.onLeave());
    tr.addEventListener("click", () => handlers.onClick(idx));
    tbody.appendChild(tr);
  }
}

function residueSele(chain, resseq) {
  return `:${chain} and ${resseq}`;
}

function clearHighlights(state) {
  for (const repr of state.highlightReprs) {
    try {
      repr.dispose();
    } catch (_e) {
      // Ignore disposal errors for replaced components.
    }
  }
  state.highlightReprs = [];
}

function highlightInteraction(state, interaction) {
  if (!state.component || !interaction) return;
  clearHighlights(state);

  const receptorSele = residueSele(interaction.receptor_chain, interaction.receptor_resseq);
  const ligandSele = residueSele(interaction.ligand_chain, interaction.ligand_resseq);

  const receptorRepr = state.component.addRepresentation("ball+stick", {
    sele: receptorSele,
    color: "#f97316",
    scale: 2.2,
  });
  const ligandRepr = state.component.addRepresentation("ball+stick", {
    sele: ligandSele,
    color: "#1f7a53",
    scale: 2.2,
  });
  state.highlightReprs.push(receptorRepr, ligandRepr);

  state.component.autoView(`${receptorSele} or ${ligandSele}`, 800);
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

function updateFileBadge(inputId, labelId, triggerButton) {
  const input = document.getElementById(inputId);
  const label = document.getElementById(labelId);
  if (!input || !label || !triggerButton) return;
  const name = fileName(input);
  if (name) {
    label.textContent = name;
    triggerButton.textContent = "Replace file";
  } else {
    label.textContent = "No file selected";
    triggerButton.textContent = "Choose file";
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

function populateSelect(selectEl, options, emptyLabel) {
  selectEl.innerHTML = "";
  if (!options || options.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = emptyLabel;
    selectEl.appendChild(opt);
    selectEl.disabled = true;
    return;
  }

  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    selectEl.appendChild(opt);
  }
  selectEl.disabled = false;
}

function updateSelectorEnablement(idx) {
  const mode = document.getElementById(`ligand-mode-${idx}`).value;
  const chainSel = document.getElementById(`ligand-chain-select-${idx}`);
  const hetSel = document.getElementById(`ligand-het-select-${idx}`);

  chainSel.disabled = mode !== "chain" || chainSel.options.length === 0;
  hetSel.disabled = mode !== "het" || hetSel.options.length === 0;

  if (mode === "chain" && chainSel.options.length === 0) {
    setStatus(`Complex ${idx}: no chain options yet. Upload and parse the file first.`, true);
  }
  if (mode === "het" && hetSel.options.length === 0) {
    setStatus(`Complex ${idx}: no HETATM ligand options yet. Upload and parse the file first.`, true);
  }
}

async function inspectFile(file, idx) {
  const formData = new FormData();
  formData.append("complex", file);

  const response = await fetch("/api/inspect", { method: "POST", body: formData });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "PDB inspection failed");
  }

  const chainSel = document.getElementById(`ligand-chain-select-${idx}`);
  const hetSel = document.getElementById(`ligand-het-select-${idx}`);

  const chainOptions = (data.chains || []).map((c) => ({
    value: c.chain,
    label: `${c.chain} (${c.residue_count} residues, ${c.role_hint})`,
  }));
  populateSelect(chainSel, chainOptions, "No chains detected");

  const hetOptions = (data.het_ligands || []).map((h) => ({
    value: `${h.resname}:${h.chain}`,
    label: `${h.resname} on chain ${h.chain} (${h.instances} residues)`,
  }));
  populateSelect(hetSel, hetOptions, "No HETATM ligands detected");

  updateSelectorEnablement(idx);

  return {
    chainCount: chainOptions.length,
    hetCount: hetOptions.length,
  };
}

function applyLigandSelection(formData, idx, analyzeMode) {
  const mode = document.getElementById(`ligand-mode-${idx}`).value;
  const chainSel = document.getElementById(`ligand-chain-select-${idx}`);
  const hetSel = document.getElementById(`ligand-het-select-${idx}`);

  let ligandResname = "";
  let ligandChain = "";

  if (mode === "chain") {
    ligandChain = chainSel.value || "";
  } else if (mode === "het") {
    const value = hetSel.value || "";
    const parts = value.split(":");
    ligandResname = parts[0] || "";
    ligandChain = parts[1] || "";
  }

  if (analyzeMode === "single") {
    formData.append("ligand_resname", ligandResname);
    formData.append("ligand_chain", ligandChain);
  } else {
    formData.append(`ligand_resname_${idx}`, ligandResname);
    formData.append(`ligand_chain_${idx}`, ligandChain);
  }
}

async function main() {
  const nglOk = await ensureNglLoaded();

  const stage1 = initStage("viewer-1");
  const stage2 = initStage("viewer-2");
  const singleViewState = {
    component: null,
    interactions: [],
    highlightReprs: [],
    selectedIndex: null,
  };

  setSingleModeVisible();
  clearStage(stage2);

  const file1Input = document.getElementById("complex-1-file");
  const file2Input = document.getElementById("complex-2-file");
  const mode1 = document.getElementById("ligand-mode-1");
  const mode2 = document.getElementById("ligand-mode-2");

  mode1.addEventListener("change", () => updateSelectorEnablement(1));
  mode2.addEventListener("change", () => updateSelectorEnablement(2));

  const fileTriggers = document.querySelectorAll(".file-trigger");
  for (const trigger of fileTriggers) {
    trigger.addEventListener("click", () => {
      const target = trigger.dataset.fileTarget;
      const input = document.getElementById(target);
      if (input) input.click();
    });
  }

  updateFileBadge("complex-1-file", "complex-1-name", document.querySelector('[data-file-target="complex-1-file"]'));
  updateFileBadge("complex-2-file", "complex-2-name", document.querySelector('[data-file-target="complex-2-file"]'));

  setStatus("Ready. Upload Complex 1 to parse chains/ligands.");
  if (!nglOk) {
    setStatus("3D viewer failed to load from all CDNs, but analysis and ligand parsing still work.", true);
  }

  file1Input.addEventListener("change", async () => {
    updateFileBadge("complex-1-file", "complex-1-name", document.querySelector('[data-file-target="complex-1-file"]'));
    const f1 = fileName(file1Input);
    if (!f1) {
      setStatus("Select Complex 1 to begin.", true);
      return;
    }
    setStatus(`Parsing ${f1}...`);
    try {
      const info = await inspectFile(file1Input.files[0], 1);
      setStatus(`Parsed ${f1}: ${info.chainCount} chains, ${info.hetCount} HETATM ligands detected.`);
      if (mode1.value === "chain" && info.chainCount === 0) {
        setStatus(`Parsed ${f1}, but no chain ligands were detected.`, true);
      }
    } catch (err) {
      setStatus(`Failed to parse ${f1}: ${err.message}`, true);
    }
  });

  file2Input.addEventListener("change", async () => {
    updateFileBadge("complex-2-file", "complex-2-name", document.querySelector('[data-file-target="complex-2-file"]'));
    const f2 = fileName(file2Input);
    if (!f2) {
      setStatus("Complex 2 cleared. Single-analysis mode ready.");
      return;
    }
    setStatus(`Parsing ${f2}...`);
    try {
      const info = await inspectFile(file2Input.files[0], 2);
      setStatus(`Parsed ${f2}: ${info.chainCount} chains, ${info.hetCount} HETATM ligands detected. Comparison mode ready.`);
      if (mode2.value === "chain" && info.chainCount === 0) {
        setStatus(`Parsed ${f2}, but no chain ligands were detected.`, true);
      }
    } catch (err) {
      setStatus(`Failed to parse ${f2}: ${err.message}`, true);
    }
  });

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

        const formData = new FormData();
        formData.append("complex_1", file1Input.files[0]);
        formData.append("complex_2", file2Input.files[0]);
        formData.append("engine", form.elements.engine.value || "auto");
        applyLigandSelection(formData, 1, "compare");
        applyLigandSelection(formData, 2, "compare");

        const response = await fetch("/api/compare", { method: "POST", body: formData });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Comparison failed");
        }

        setCompareModeVisible();
        singleViewState.component = null;
        singleViewState.interactions = [];
        singleViewState.selectedIndex = null;
        clearHighlights(singleViewState);
        renderInteractionsTable([], {
          onHover: () => {},
          onLeave: () => {},
          onClick: () => {},
        }, null);

        await Promise.all([
          loadPdbIntoStage(stage1, data.pdb_1),
          loadPdbIntoStage(stage2, data.pdb_2),
        ]);

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
        formData.append("engine", form.elements.engine.value || "auto");
        applyLigandSelection(formData, 1, "single");

        const response = await fetch("/api/analyze", { method: "POST", body: formData });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Analysis failed");
        }

        setSingleModeVisible();
        singleViewState.component = await loadPdbIntoStage(stage1, data.pdb);
        clearStage(stage2);
        clearHighlights(singleViewState);
        singleViewState.interactions = data.interactions.slice(0, 500);
        singleViewState.selectedIndex = null;

        const tableHandlers = {
          onHover: (idx) => {
            if (singleViewState.selectedIndex !== null) return;
            highlightInteraction(singleViewState, singleViewState.interactions[idx]);
          },
          onLeave: () => {
            if (singleViewState.selectedIndex !== null) {
              highlightInteraction(
                singleViewState,
                singleViewState.interactions[singleViewState.selectedIndex]
              );
              return;
            }
            clearHighlights(singleViewState);
          },
          onClick: (idx) => {
            if (singleViewState.selectedIndex === idx) {
              singleViewState.selectedIndex = null;
              clearHighlights(singleViewState);
              renderInteractionsTable(singleViewState.interactions, tableHandlers, null);
              setStatus("Selection cleared.");
              return;
            }
            singleViewState.selectedIndex = idx;
            highlightInteraction(singleViewState, singleViewState.interactions[idx]);
            renderInteractionsTable(singleViewState.interactions, tableHandlers, idx);
            setStatus(`Selected interaction ${idx + 1}. Click again to clear.`);
          },
        };
        renderInteractionsTable(singleViewState.interactions, tableHandlers, null);

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
}

main();

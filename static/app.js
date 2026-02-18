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
    "/static/vendor/ngl.js",
    "https://cdn.jsdelivr.net/npm/ngl@2.1.0-dev.39/dist/ngl.js",
    "https://unpkg.com/ngl@2.1.0-dev.39/dist/ngl.js",
    "https://cdnjs.cloudflare.com/ajax/libs/ngl/2.0.0-dev.37/ngl.js",
  ];
  for (const url of urls) {
    try {
      await loadScript(url);
      if (typeof NGL !== "undefined") return true;
    } catch (_err) {
      // Try next source.
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
  const c = (chain || "").trim();
  const r = Number(resseq);
  if (!Number.isFinite(r) || r <= 0) return null;
  if (c) return `${r}:${c}`;
  return `${r}`;
}

function atomSele(chain, resseq, atomName) {
  const base = residueSele(chain, resseq);
  const atom = (atomName || "").trim();
  if (!base) return null;
  if (!atom) return base;
  return `${base}.${atom}`;
}

function clearHighlights(state) {
  if (!state.component) {
    state.highlightReprs = [];
    return;
  }
  for (const repr of state.highlightReprs) {
    try {
      state.component.removeRepresentation(repr);
    } catch (_e) {
      // Ignore disposal errors for replaced components.
    }
  }
  state.highlightReprs = [];
}

// Highlights receptor/ligand residues (atom-level when available) for one interaction row.
function highlightInteraction(state, interaction) {
  if (!state.component || !interaction) return;
  clearHighlights(state);

  const receptorResidueSele = residueSele(interaction.receptor_chain, interaction.receptor_resseq);
  const ligandResidueSele = residueSele(interaction.ligand_chain, interaction.ligand_resseq);
  const receptorAtomSele = atomSele(
    interaction.receptor_chain,
    interaction.receptor_resseq,
    interaction.receptor_atom
  );
  const ligandAtomSele = atomSele(
    interaction.ligand_chain,
    interaction.ligand_resseq,
    interaction.ligand_atom
  );

  if (!receptorResidueSele || !ligandResidueSele) {
    return;
  }

  const receptorRepr = state.component.addRepresentation("ball+stick", {
    sele: receptorAtomSele || receptorResidueSele,
    color: "#f97316",
    scale: 2.2,
  });
  const ligandRepr = state.component.addRepresentation("ball+stick", {
    sele: ligandAtomSele || ligandResidueSele,
    color: "#1f7a53",
    scale: 2.2,
  });
  state.highlightReprs.push(receptorRepr, ligandRepr);

  state.component.autoView(`${receptorResidueSele} or ${ligandResidueSele}`, 800);
}

function highlightExampleForCompare(state, interaction) {
  if (!state || !state.component || !interaction) {
    if (state) clearHighlights(state);
    return;
  }
  highlightInteraction(state, interaction);
}

function syncStageOrientation(fromStage, toStage, syncState) {
  if (!fromStage || !toStage || syncState.isApplying) return;
  try {
    syncState.isApplying = true;
    const orientation = fromStage.viewerControls.getOrientation();
    if (orientation) {
      toStage.viewerControls.orient(orientation);
    }
  } catch (_err) {
    // Keep orientation sync best-effort only.
  } finally {
    syncState.isApplying = false;
  }
}

function formatSig(item) {
  return `${item.interaction_type} | ${item.receptor_chain}:${item.receptor_resname}${item.receptor_resseq}`;
}

function renderCompareList(id, items, emptyText, handlers, selectedKey) {
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
    li.className = "compare-item";
    if (selectedKey && item.signature_key === selectedKey) {
      li.classList.add("selected");
    }
    li.textContent = formatSig(item);
    if (handlers) {
      li.addEventListener("mouseenter", () => handlers.onHover(item));
      li.addEventListener("mouseleave", () => handlers.onLeave(item));
      li.addEventListener("click", () => handlers.onClick(item));
    }
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

function setSummaryText(text) {
  const el = document.getElementById("summary-text");
  if (el) el.value = text || "";
}

const SHARE_PROMPT_HEADER =
  "Compare the protein–ligand interactions between the following complexes and present the result in the style of a scientific article. Start with a short TL;DR written for non-experts. Then provide an expert-level analysis using sections typical of a structural biology paper (Abstract-style overview, Interaction Statistics, Conserved Interactions, Structure-Specific Differences, Interpretation, Conclusion). Maintain a neutral, technical tone. Focus on interpreting the biological meaning of shared vs unique interactions rather than listing raw data. Include biological context by identifying the proteins and ligands present in each PDB file. Outputs should summarize shared and unique interaction signatures and their implications for ligand recognition and specificity.\n";

function summarizeSingleResult(fileNameValue, data) {
  const lines = [];
  lines.push(SHARE_PROMPT_HEADER);
  lines.push("Protein Interaction Analysis (Single Complex)");
  lines.push(`File: ${fileNameValue}`);
  lines.push(`Ligand: ${data.ligand?.name || "unknown"} | Chain: ${data.ligand?.chain || "auto"} | Engine: ${data.engine_used}`);
  lines.push(`Total interactions: ${data.interaction_count}`);
  lines.push("");
  lines.push("Interactions:");

  const rows = data.interactions || [];
  const limit = 1500;
  const shown = rows.slice(0, limit);
  shown.forEach((row, idx) => {
    lines.push(
      `${idx + 1}. ${row.interaction_type} | Receptor ${row.receptor_chain}:${row.receptor_resname}${row.receptor_resseq} (${row.receptor_atom}) <-> Ligand ${row.ligand_chain}:${row.ligand_resname}${row.ligand_resseq} (${row.ligand_atom}) | Distance ${row.distance} A`
    );
  });
  if (rows.length > limit) {
    lines.push(`... truncated: showing ${limit} of ${rows.length} interactions`);
  }

  if (data.warnings && data.warnings.length > 0) {
    lines.push("");
    lines.push(`Warnings: ${data.warnings.join(" ")}`);
  }
  return lines.join("\n");
}

function summarizeCompareResult(file1, file2, data) {
  const lines = [];
  lines.push(SHARE_PROMPT_HEADER);
  lines.push("Protein Interaction Comparison");
  lines.push(`Complex 1 file: ${file1}`);
  lines.push(`Complex 2 file: ${file2}`);
  lines.push(`Complex 1: interactions=${data.complex_1?.interaction_count || 0}, engine=${data.complex_1?.engine_used || "unknown"}, ligand=${data.complex_1?.ligand?.name || "unknown"} chain=${data.complex_1?.ligand?.chain || "auto"}`);
  lines.push(`Complex 2: interactions=${data.complex_2?.interaction_count || 0}, engine=${data.complex_2?.engine_used || "unknown"}, ligand=${data.complex_2?.ligand?.name || "unknown"} chain=${data.complex_2?.ligand?.chain || "auto"}`);
  lines.push(`Shared signatures: ${(data.shared || []).length}`);
  lines.push(`Only in Complex 1: ${(data.only_in_complex_1 || []).length}`);
  lines.push(`Only in Complex 2: ${(data.only_in_complex_2 || []).length}`);
  if (data.alignment?.aligned) {
    lines.push(
      `Structural alignment: yes (reference chain ${data.alignment.reference_chain}, moving chain ${data.alignment.moving_chain}, shared CA ${data.alignment.shared_ca_atoms}, RMSD ${data.alignment.rmsd} A)`
    );
  } else if (data.alignment) {
    lines.push(`Structural alignment: no (${data.alignment.reason || "not available"})`);
  }
  lines.push("");

  const addSection = (title, rows) => {
    lines.push(title);
    if (!rows || rows.length === 0) {
      lines.push("- none");
      lines.push("");
      return;
    }
    const limit = 1000;
    rows.slice(0, limit).forEach((item, idx) => {
      lines.push(
        `${idx + 1}. ${item.interaction_type} | ${item.receptor_chain}:${item.receptor_resname}${item.receptor_resseq}`
      );
    });
    if (rows.length > limit) {
      lines.push(`... truncated: showing ${limit} of ${rows.length}`);
    }
    lines.push("");
  };

  addSection("Shared interaction signatures:", data.shared || []);
  addSection("Only in Complex 1:", data.only_in_complex_1 || []);
  addSection("Only in Complex 2:", data.only_in_complex_2 || []);

  const warnings = [...(data.complex_1?.warnings || []), ...(data.complex_2?.warnings || [])];
  if (warnings.length > 0) {
    lines.push(`Warnings: ${warnings.join(" ")}`);
  }
  return lines.join("\n");
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
  const compareViewState1 = { component: null, highlightReprs: [] };
  const compareViewState2 = { component: null, highlightReprs: [] };
  const compareUiState = {
    shared: [],
    only1: [],
    only2: [],
    examples1: {},
    examples2: {},
    selectedKey: null,
  };

  setSingleModeVisible();
  clearStage(stage2);

  const file1Input = document.getElementById("complex-1-file");
  const file2Input = document.getElementById("complex-2-file");
  const mode1 = document.getElementById("ligand-mode-1");
  const mode2 = document.getElementById("ligand-mode-2");
  const linkViewsToggle = document.getElementById("link-views-toggle");
  const alignStructuresToggle = document.getElementById("align-structures-toggle");
  const copyButton = document.getElementById("copy-summary-button");
  const trigger1 = document.querySelector('[data-file-target="complex-1-file"]');
  const trigger2 = document.querySelector('[data-file-target="complex-2-file"]');
  const orientationSyncState = { isApplying: false };

  mode1.addEventListener("change", () => updateSelectorEnablement(1));
  mode2.addEventListener("change", () => updateSelectorEnablement(2));

  if (stage1 && stage2 && linkViewsToggle) {
    stage1.viewerControls.signals.changed.add(() => {
      if (!linkViewsToggle.checked) return;
      syncStageOrientation(stage1, stage2, orientationSyncState);
    });
    stage2.viewerControls.signals.changed.add(() => {
      if (!linkViewsToggle.checked) return;
      syncStageOrientation(stage2, stage1, orientationSyncState);
    });
    linkViewsToggle.addEventListener("change", () => {
      if (linkViewsToggle.checked) {
        syncStageOrientation(stage1, stage2, orientationSyncState);
        setStatus("Compare panel orientations linked.");
      }
    });
  }

  const fileTriggers = document.querySelectorAll(".file-trigger");
  for (const trigger of fileTriggers) {
    trigger.addEventListener("click", () => {
      const target = trigger.dataset.fileTarget;
      const input = document.getElementById(target);
      if (input) input.click();
    });
  }

  updateFileBadge("complex-1-file", "complex-1-name", trigger1);
  updateFileBadge("complex-2-file", "complex-2-name", trigger2);
  setSummaryText("");

  setStatus("Ready. Upload Complex 1 to parse chains/ligands.");
  if (!nglOk) {
    setStatus("3D viewer failed to load, but analysis and ligand parsing still work.", true);
  }

  if (copyButton) {
    copyButton.addEventListener("click", async () => {
      const text = document.getElementById("summary-text")?.value || "";
      if (!text.trim()) {
        setStatus("No summary text available yet. Run an analysis first.", true);
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        setStatus("Summary text copied to clipboard.");
      } catch (_err) {
        setStatus("Clipboard copy failed. You can still select and copy from the text box.", true);
      }
    });
  }

  file1Input.addEventListener("change", async () => {
    updateFileBadge("complex-1-file", "complex-1-name", trigger1);
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
    updateFileBadge("complex-2-file", "complex-2-name", trigger2);
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
        formData.append(
          "align_structures",
          alignStructuresToggle && alignStructuresToggle.checked ? "true" : "false"
        );
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
        clearHighlights(compareViewState1);
        clearHighlights(compareViewState2);
        renderInteractionsTable([], {
          onHover: () => {},
          onLeave: () => {},
          onClick: () => {},
        }, null);

        const loaded = await Promise.all([
          loadPdbIntoStage(stage1, data.pdb_1),
          loadPdbIntoStage(stage2, data.pdb_2),
        ]);
        compareViewState1.component = loaded[0];
        compareViewState2.component = loaded[1];
        if (linkViewsToggle && linkViewsToggle.checked) {
          syncStageOrientation(stage1, stage2, orientationSyncState);
        }

        compareUiState.shared = data.shared || [];
        compareUiState.only1 = data.only_in_complex_1 || [];
        compareUiState.only2 = data.only_in_complex_2 || [];
        compareUiState.examples1 = data.example_interactions_complex_1 || {};
        compareUiState.examples2 = data.example_interactions_complex_2 || {};
        compareUiState.selectedKey = null;

        // Compare lists are signatures; each signature maps to one example interaction per complex for highlighting.
        const renderCompareLists = () => {
          const handlers = {
            onHover: (item) => {
              if (compareUiState.selectedKey) return;
              const key = item.signature_key;
              highlightExampleForCompare(compareViewState1, compareUiState.examples1[key]);
              highlightExampleForCompare(compareViewState2, compareUiState.examples2[key]);
            },
            onLeave: () => {
              if (compareUiState.selectedKey) {
                const key = compareUiState.selectedKey;
                highlightExampleForCompare(compareViewState1, compareUiState.examples1[key]);
                highlightExampleForCompare(compareViewState2, compareUiState.examples2[key]);
                return;
              }
              clearHighlights(compareViewState1);
              clearHighlights(compareViewState2);
            },
            onClick: (item) => {
              const key = item.signature_key;
              if (compareUiState.selectedKey === key) {
                compareUiState.selectedKey = null;
                clearHighlights(compareViewState1);
                clearHighlights(compareViewState2);
                renderCompareLists();
                setStatus("Comparison selection cleared.");
                return;
              }
              compareUiState.selectedKey = key;
              highlightExampleForCompare(compareViewState1, compareUiState.examples1[key]);
              highlightExampleForCompare(compareViewState2, compareUiState.examples2[key]);
              renderCompareLists();
              setStatus("Comparison interaction selected. Click again to clear.");
            },
          };

          renderCompareList(
            "shared-list",
            compareUiState.shared,
            "No shared interaction signatures.",
            handlers,
            compareUiState.selectedKey
          );
          renderCompareList(
            "only-1-list",
            compareUiState.only1,
            "No unique signatures.",
            handlers,
            compareUiState.selectedKey
          );
          renderCompareList(
            "only-2-list",
            compareUiState.only2,
            "No unique signatures.",
            handlers,
            compareUiState.selectedKey
          );
        };
        renderCompareLists();

        document.getElementById("workflow-summary").textContent =
          `Complex 1 interactions: ${data.complex_1.interaction_count} (${data.complex_1.engine_used}) | Complex 2 interactions: ${data.complex_2.interaction_count} (${data.complex_2.engine_used}) | Shared signatures: ${data.shared.length}`;

        const warnings = [...(data.complex_1.warnings || []), ...(data.complex_2.warnings || [])];
        const alignment = data.alignment || {};
        const alignmentMsg = alignment.aligned
          ? `Aligned on chains ${alignment.reference_chain}/${alignment.moving_chain} (shared CA: ${alignment.shared_ca_atoms}, RMSD: ${alignment.rmsd} A).`
          : `Alignment not applied: ${alignment.reason || "unknown reason"}`;
        setSummaryText(summarizeCompareResult(c1, c2, data));
        if (warnings.length > 0) {
          setStatus(`${alignmentMsg} ${warnings.join(" ")}`, true);
        } else {
          setStatus(`Comparison complete: ${c1} vs ${c2}. ${alignmentMsg}`);
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
        compareViewState1.component = null;
        compareViewState2.component = null;
        compareUiState.selectedKey = null;
        clearHighlights(compareViewState1);
        clearHighlights(compareViewState2);
        renderCompareList("shared-list", [], "No shared interaction signatures.", null, null);
        renderCompareList("only-1-list", [], "No unique signatures.", null, null);
        renderCompareList("only-2-list", [], "No unique signatures.", null, null);
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

        setSummaryText(summarizeSingleResult(c1, data));
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

# Protein Interaction Analyzer

Web app for analyzing receptor-ligand interactions from PDB files, with optional dual-complex comparison.

## What the app can do

- Analyze one complex (`Complex 1`) and produce an interaction list.
- Compare two complexes (`Complex 1` + `Complex 2`) by interaction signatures.
- Download structures directly from the RCSB PDB using 4-character PDB codes.
- Superpose Complex 2 onto Complex 1 in compare mode for same-frame 3D comparison.
- Visualize structures in 3D with NGL.
- Parse uploaded PDB files and offer ligand selectors from:
  - chain IDs (for peptide/protein ligands, including PPI-like use)
  - HETATM ligand residues
  - auto-detection
- Support two interaction engines:
  - `heuristic` (always available, fast)
  - `plip` (chemistry-aware, optional install)
  - `auto` (tries PLIP, falls back to heuristic)
- Interactive highlighting:
  - single-complex table rows: hover/click to highlight in 3D
  - compare lists: hover/click to highlight corresponding contacts in one/both viewers
  - optional linked camera orientation between compare viewers

## Tech stack

- Python 3
- Flask
- Biopython
- NGL Viewer (frontend)
- Optional: PLIP + OpenBabel for chemistry-aware interactions

## Project layout

- `app.py`: Flask app and API routes
- `analyzer.py`: parsing, interaction detection, comparison
- `templates/index.html`: UI
- `static/app.js`: frontend logic
- `static/styles.css`: styling

## Installation

### Option A: Standard Python venv (heuristic engine)

```bash
cd proteinanalyser
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
```

Run:

```bash
python app.py
```

Open: [http://localhost:5000](http://localhost:5000)

If port `5000` is occupied:

```bash
python -c "from app import app; app.run(host='0.0.0.0', port=5001, debug=True)"
```

### Option B: Chemistry-aware setup on macOS (recommended for PLIP)

Use conda-forge binaries for `openbabel` + `plip` (more reliable than pip wheel builds on macOS):

```bash
cd proteinanalyser
conda create -n proteinchem -c conda-forge python=3.11 openbabel plip -y
conda activate proteinchem
pip install -r requirements.txt
python app.py
```

Open: [http://localhost:5000](http://localhost:5000)

## NGL viewer reliability (local-first)

The frontend already tries local NGL first (`/static/vendor/ngl.js`) before CDNs.

If you want to (re)install local NGL:

```bash
cd proteinanalyser
mkdir -p static/vendor
curl -L "https://unpkg.com/ngl@2.1.0-dev.39/dist/ngl.js" -o static/vendor/ngl.js
```

## Usage guide

### 1. Single-complex analysis

1. Provide `Complex 1` as either:
   - uploaded PDB file, or
   - 4-character PDB code (use `Fetch + Parse`).
2. Choose ligand source:
   - `Auto detect`
   - `Chain` (for peptide/protein ligand)
   - `HETATM ligand`
3. Choose engine (`auto`, `plip`, or `heuristic`).
4. Click `Run Analysis`.

Results:
- 3D structure viewer
- interaction table
- hover/click table rows to highlight contacts in the structure

### 2. Dual-complex comparison

1. Provide `Complex 1` and `Complex 2` as files and/or PDB codes.
2. Set ligand source for each complex.
3. Click `Run Analysis` (comparison mode auto-detected).
4. Keep `Align Complex 2 onto Complex 1` enabled for structural superposition.

Results:
- side-by-side 3D viewers
- lists: `Shared`, `Only in Complex 1`, `Only in Complex 2`
- hover/click list entries to highlight matching representative contacts
- alignment status with chain pair, shared C-alpha count, and RMSD

## Ligand selection behavior

- `Auto detect`: picks the most likely ligand HET residue by atom count.
- `Chain`: treats entire selected chain as ligand (useful for peptide ligands and PPI-style analysis).
- `HETATM ligand`: uses specific residue name + chain from parsed HETATM candidates.

## Interaction engines

### `heuristic`
Distance/type-based approximation using Biopython atom coordinates.

Categories include:
- `hydrogen_bond_like`
- `salt_bridge_like`
- `hydrophobic_contact`
- `aromatic_contact`
- `close_contact`

### `plip`
Chemistry-aware interaction extraction (when installed), including classes such as:
- hydrogen bonds
- hydrophobic contacts
- salt bridges
- pi-stacking / cation-pi
- halogen bonds
- metal complexes
- water bridges

### `auto`
- Uses PLIP if available and compatible with selected ligand mode.
- Falls back to heuristic with warning when needed.

## API reference

### `POST /api/inspect`
Parse uploaded PDB and return chain/HET ligand candidates.

Form fields:
- `complex` (optional file)
- `pdb_id` (optional 4-character PDB code)

One of `complex` or `pdb_id` is required.

Response (high level):
- `chains[]`
- `het_ligands[]`

### `POST /api/analyze`
Analyze one complex.

Form fields:
- `complex` (optional file)
- `pdb_id` (optional 4-character PDB code)
- `ligand_resname` (optional)
- `ligand_chain` (optional)
- `engine` (optional: `auto|plip|heuristic`)

One of `complex` or `pdb_id` is required.

Response includes:
- `ligand`
- `interaction_count`
- `interactions[]`
- `engine_used`
- `warnings[]`
- `pdb`

### `POST /api/compare`
Compare two complexes.

Form fields:
- `complex_1` (optional file)
- `pdb_id_1` (optional 4-character PDB code)
- `complex_2` (optional file)
- `pdb_id_2` (optional 4-character PDB code)
- `ligand_resname_1` / `ligand_chain_1` (optional)
- `ligand_resname_2` / `ligand_chain_2` (optional)
- `engine` (optional: `auto|plip|heuristic`)
- `align_structures` (optional: `true|false`, default `true`)

For each complex, provide either file or PDB code.

Response includes:
- `complex_1`, `complex_2` summaries
- `shared[]`, `only_in_complex_1[]`, `only_in_complex_2[]`
- `example_interactions_complex_1`, `example_interactions_complex_2` (used by compare highlighting)
- `alignment` (superposition metadata: `aligned`, `reason`, and if aligned: `rmsd`, chain ids, shared CA count)
- `pdb_1`, `pdb_2`

## File constraints and limits

- Accepted upload extensions: `.pdb`, `.ent`, `.txt`
- Max upload size: 8 MB per request (`MAX_CONTENT_LENGTH`)

## Troubleshooting

- Viewer not showing:
  - hard refresh (`Cmd+Shift+R`)
  - disable ad blocker for localhost
  - ensure `/static/vendor/ngl.js` exists
- PLIP unavailable error:
  - use conda setup above (`openbabel` + `plip`)
  - or run with `engine=heuristic`
- No interactions returned:
  - verify ligand source selection (chain vs HET)
  - try `heuristic` engine first

## Current limitations

- Heuristic engine is approximate and not a replacement for full docking/energetics workflows.
- Compare view uses one representative contact per signature for highlighting.
- PDB preprocessing (protonation states, alternate locations normalization, etc.) is not yet automated.

## License

MIT. See `LICENSE`.

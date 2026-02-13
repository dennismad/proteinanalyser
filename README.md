# Protein Interaction Analyzer

Flask web app to analyze receptor-ligand interactions from PDB files.

## Features

- Upload a protein-ligand complex and visualize it in 3D.
- Generate an interaction list between receptor residues and ligand atoms.
- Compare interaction signatures between two complexes.
- Auto-detect ligand residue if not provided.
- Supports `auto / plip / heuristic` analysis engines.
- Supports peptide ligands and protein-protein interfaces via chain-as-ligand mode.
- Parses uploaded PDB files to offer ligand selection from chain IDs or HETATM ligands.

## Tech stack

- Python + Flask (standard web framework)
- Biopython for PDB parsing
- NGL Viewer (browser-side 3D rendering)

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Then open [http://localhost:5000](http://localhost:5000).

## Interaction model

Current interaction categories are simple geometry heuristics based on atom types and distances:

- `hydrogen_bond_like`
- `salt_bridge_like`
- `hydrophobic_contact`
- `aromatic_contact`
- `close_contact`

This gives a fast first-pass analysis for exploration. For production-grade chemistry, integrate a dedicated engine (for example, PLIP or ProLIF) and explicit protonation handling.

## Chemistry-accurate engine (PLIP)

The app now supports a PLIP-based interaction engine (`engine=plip`) for more chemistry-aware contact typing, including categories such as:

- hydrogen bonds
- hydrophobic contacts
- salt bridges
- pi stacking / cation-pi
- halogen bonds
- metal complexes

`engine=auto` (default) tries PLIP first and falls back to the heuristic model if PLIP dependencies are unavailable.

PLIP installation depends on OpenBabel being available on your system. Typical flow:

```bash
pip install plip
```

If OpenBabel is missing, install OpenBabel for your OS first, then reinstall PLIP.

## API endpoints

- `POST /api/analyze`
  - form-data: `complex` file, optional `ligand_resname`, optional `ligand_chain`, optional `engine`
- `POST /api/compare`
  - form-data: `complex_1`, `complex_2`, optional ligand selectors for both complexes, optional `engine`
- `POST /api/inspect`
  - form-data: `complex` file
  - returns parsed chain list and HETATM ligand candidates for UI selection

## Ligand selection modes

- Small molecule mode:
  - Provide `ligand_resname` (optionally `ligand_chain`), or leave both empty for auto-detection.
- Peptide/protein ligand mode:
  - Provide `ligand_chain` and leave `ligand_resname` empty.
  - The full selected chain is treated as ligand; other protein chains are treated as receptor.

In peptide/protein chain mode, `engine=auto` uses the heuristic engine and adds a warning because PLIP is primarily small-molecule focused.

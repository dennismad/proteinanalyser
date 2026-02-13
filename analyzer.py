from __future__ import annotations

from dataclasses import dataclass
from io import StringIO
from math import dist
import os
import tempfile
from typing import Iterable

from Bio.PDB import PDBParser


PROTEIN_RESIDUES = {
    "ALA",
    "ARG",
    "ASN",
    "ASP",
    "CYS",
    "GLN",
    "GLU",
    "GLY",
    "HIS",
    "ILE",
    "LEU",
    "LYS",
    "MET",
    "PHE",
    "PRO",
    "SER",
    "THR",
    "TRP",
    "TYR",
    "VAL",
}

WATER_RESIDUES = {"HOH", "WAT", "H2O"}
AROMATIC_RESIDUES = {"PHE", "TYR", "TRP", "HIS"}
POSITIVE_RESIDUES = {"ARG", "LYS", "HIS"}
NEGATIVE_RESIDUES = {"ASP", "GLU"}


@dataclass(frozen=True)
class Interaction:
    interaction_type: str
    receptor_chain: str
    receptor_resname: str
    receptor_resseq: int
    receptor_atom: str
    ligand_chain: str
    ligand_resname: str
    ligand_resseq: int
    ligand_atom: str
    distance: float

    def signature(self) -> tuple[str, str, int, str]:
        return (
            self.interaction_type,
            self.receptor_chain,
            self.receptor_resseq,
            self.receptor_resname,
        )

    def signature_key(self) -> str:
        t, c, n, r = self.signature()
        return f"{t}|{c}|{n}|{r}"


def _to_int(value, default: int = -1) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _to_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_get(obj, aliases: list[str], default=None):
    for name in aliases:
        if hasattr(obj, name):
            value = getattr(obj, name)
            if value is not None:
                return value
    return default


def _is_protein_residue(residue) -> bool:
    return residue.resname.strip() in PROTEIN_RESIDUES


def _is_water_residue(residue) -> bool:
    return residue.resname.strip() in WATER_RESIDUES


def _is_ligand_residue(residue) -> bool:
    hetflag = residue.id[0].strip()
    return bool(hetflag) and not _is_water_residue(residue)


def _is_standard_residue(residue) -> bool:
    return _is_protein_residue(residue) or _is_ligand_residue(residue)


def _residue_label(residue) -> str:
    return f"{residue.get_parent().id}:{residue.resname.strip()}:{residue.id[1]}"


def parse_structure(pdb_text: str):
    parser = PDBParser(QUIET=True)
    return parser.get_structure("complex", StringIO(pdb_text))


def autodetect_ligand(structure) -> tuple[str, str]:
    ligand_residues = []
    for residue in structure.get_residues():
        if _is_ligand_residue(residue):
            ligand_residues.append(residue)

    if not ligand_residues:
        raise ValueError("No ligand-like HETATM residues found.")

    counts: dict[tuple[str, str], int] = {}
    for residue in ligand_residues:
        key = (residue.get_parent().id, residue.resname.strip())
        counts[key] = counts.get(key, 0) + len(list(residue.get_atoms()))

    ligand_chain, ligand_resname = max(counts, key=counts.get)
    return ligand_chain, ligand_resname


def _select_ligand_residues(structure, ligand_resname: str, ligand_chain: str | None = None):
    matches = []
    for residue in structure.get_residues():
        if not _is_ligand_residue(residue):
            continue
        if residue.resname.strip() != ligand_resname:
            continue
        if ligand_chain and residue.get_parent().id != ligand_chain:
            continue
        matches.append(residue)
    return matches


def _select_chain_ligand_residues(structure, ligand_chain: str, ligand_resname: str | None = None):
    matches = []
    for residue in structure.get_residues():
        if residue.get_parent().id != ligand_chain:
            continue
        if not _is_standard_residue(residue):
            continue
        if _is_water_residue(residue):
            continue
        if ligand_resname and residue.resname.strip() != ligand_resname:
            continue
        matches.append(residue)
    return matches


def _classify_interaction(receptor_residue, receptor_atom, ligand_atom, d: float) -> str | None:
    re = (receptor_atom.element or "").upper()
    le = (ligand_atom.element or "").upper()
    rr = receptor_residue.resname.strip()

    if d <= 3.5 and {re, le}.issubset({"N", "O", "S", "P"}):
        return "hydrogen_bond_like"

    if d <= 4.0 and ((rr in POSITIVE_RESIDUES and le == "O") or (rr in NEGATIVE_RESIDUES and le == "N")):
        return "salt_bridge_like"

    if d <= 4.5 and re == "C" and le == "C":
        return "hydrophobic_contact"

    if d <= 5.0 and rr in AROMATIC_RESIDUES and le == "C":
        return "aromatic_contact"

    if d <= 4.0:
        return "close_contact"

    return None


def _iter_receptor_residues(structure, ligand_residues) -> Iterable:
    ligand_keys = {
        (residue.get_parent().id, residue.id[1], residue.resname.strip()) for residue in ligand_residues
    }

    for residue in structure.get_residues():
        if not _is_protein_residue(residue):
            continue
        key = (residue.get_parent().id, residue.id[1], residue.resname.strip())
        if key in ligand_keys:
            continue
        yield residue


def _count_plip_interactions(interaction_set) -> int:
    categories = [
        "hydrophobic_contacts",
        "hbonds_pdon",
        "hbonds_ldon",
        "water_bridges",
        "saltbridge_lneg",
        "saltbridge_pneg",
        "pistacking",
        "pication",
        "halogen_bonds",
        "metal_complexes",
    ]
    total = 0
    for category in categories:
        total += len(getattr(interaction_set, category, []))
    return total


def _match_bsid(bsid: str, ligand_resname: str | None, ligand_chain: str | None) -> bool:
    parts = bsid.split(":")
    if len(parts) < 2:
        return False
    resname = parts[0].strip()
    chain = parts[1].strip()
    if ligand_resname and resname != ligand_resname:
        return False
    if ligand_chain and chain != ligand_chain:
        return False
    return True


def _plip_rows_from_category(
    interaction_set,
    bsid: str,
    category: str,
    interaction_type: str,
) -> list[Interaction]:
    rows = []
    parts = bsid.split(":")
    ligand_resname = parts[0].strip() if len(parts) >= 1 else "LIG"
    ligand_chain = parts[1].strip() if len(parts) >= 2 else "?"
    ligand_resseq = _to_int(parts[2] if len(parts) >= 3 else -1)

    for item in getattr(interaction_set, category, []):
        receptor_chain = str(_safe_get(item, ["reschain", "chain"], "?"))
        receptor_resname = str(_safe_get(item, ["restype", "resname"], "UNK"))
        receptor_resseq = _to_int(_safe_get(item, ["resnr", "resid"], -1))
        receptor_atom = str(_safe_get(item, ["protatom", "rest_atom", "atype"], "?"))
        ligand_atom = str(_safe_get(item, ["ligatom", "lig_atom", "dtype"], "?"))
        interaction_dist = round(_to_float(_safe_get(item, ["dist", "distance"], 0.0)), 3)

        rows.append(
            Interaction(
                interaction_type=interaction_type,
                receptor_chain=receptor_chain,
                receptor_resname=receptor_resname,
                receptor_resseq=receptor_resseq,
                receptor_atom=receptor_atom,
                ligand_chain=ligand_chain,
                ligand_resname=ligand_resname,
                ligand_resseq=ligand_resseq,
                ligand_atom=ligand_atom,
                distance=interaction_dist,
            )
        )
    return rows


def _detect_interactions_plip(
    pdb_text: str,
    ligand_resname: str | None = None,
    ligand_chain: str | None = None,
) -> dict:
    try:
        from plip.structure.preparation import PDBComplex
    except ImportError as exc:
        raise ImportError("PLIP not installed. Install optional chemistry dependencies first.") from exc

    temp_path = None
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".pdb", delete=False) as tmp:
            tmp.write(pdb_text)
            temp_path = tmp.name

        complex_obj = PDBComplex()
        complex_obj.load_pdb(temp_path)
        complex_obj.analyze()

        if not complex_obj.interaction_sets:
            raise ValueError("No ligand binding sites were detected by PLIP.")

        candidate_keys = [
            key
            for key in complex_obj.interaction_sets.keys()
            if _match_bsid(key, ligand_resname, ligand_chain)
        ]
        if not candidate_keys:
            raise ValueError("No PLIP binding site matched the requested ligand selector.")

        selected_key = max(
            candidate_keys,
            key=lambda k: _count_plip_interactions(complex_obj.interaction_sets[k]),
        )
        interaction_set = complex_obj.interaction_sets[selected_key]

        interactions: list[Interaction] = []
        mapping = {
            "hydrophobic_contacts": "hydrophobic_contact",
            "hbonds_pdon": "hydrogen_bond",
            "hbonds_ldon": "hydrogen_bond",
            "water_bridges": "water_bridge",
            "saltbridge_lneg": "salt_bridge",
            "saltbridge_pneg": "salt_bridge",
            "pistacking": "pi_stacking",
            "pication": "cation_pi",
            "halogen_bonds": "halogen_bond",
            "metal_complexes": "metal_complex",
        }

        for category, interaction_type in mapping.items():
            interactions.extend(
                _plip_rows_from_category(interaction_set, selected_key, category, interaction_type)
            )

        interactions.sort(key=lambda x: (x.distance, x.receptor_chain, x.receptor_resseq))
        parts = selected_key.split(":")
        return {
            "ligand": {
                "name": parts[0].strip() if len(parts) >= 1 else ligand_resname,
                "chain": parts[1].strip() if len(parts) >= 2 else ligand_chain,
                "residues": [selected_key],
            },
            "interaction_count": len(interactions),
            "interactions": [i.__dict__ for i in interactions],
            "engine_used": "plip",
            "warnings": [],
        }
    finally:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)


def _detect_interactions_heuristic(
    pdb_text: str,
    ligand_resname: str | None = None,
    ligand_chain: str | None = None,
    cutoff: float = 5.0,
) -> dict:
    structure = parse_structure(pdb_text)

    # If chain is provided and residue name is omitted, treat the entire chain as ligand.
    if ligand_chain and not ligand_resname:
        ligand_residues = _select_chain_ligand_residues(structure, ligand_chain)
        ligand_resname = "CHAIN"
    else:
        if not ligand_resname:
            ligand_chain, ligand_resname = autodetect_ligand(structure)
        if ligand_chain:
            ligand_residues = _select_chain_ligand_residues(structure, ligand_chain, ligand_resname)
        else:
            ligand_residues = _select_ligand_residues(structure, ligand_resname, ligand_chain)

    if not ligand_residues:
        chain_info = f" on chain {ligand_chain}" if ligand_chain else ""
        raise ValueError(f"Ligand '{ligand_resname}'{chain_info} was not found.")

    interactions: list[Interaction] = []

    for receptor_residue in _iter_receptor_residues(structure, ligand_residues):
        for receptor_atom in receptor_residue.get_atoms():
            rc = receptor_atom.coord
            for ligand_residue in ligand_residues:
                for ligand_atom in ligand_residue.get_atoms():
                    d = dist(rc, ligand_atom.coord)
                    if d > cutoff:
                        continue

                    interaction_type = _classify_interaction(receptor_residue, receptor_atom, ligand_atom, d)
                    if not interaction_type:
                        continue

                    interactions.append(
                        Interaction(
                            interaction_type=interaction_type,
                            receptor_chain=receptor_residue.get_parent().id,
                            receptor_resname=receptor_residue.resname.strip(),
                            receptor_resseq=receptor_residue.id[1],
                            receptor_atom=receptor_atom.name.strip(),
                            ligand_chain=ligand_residue.get_parent().id,
                            ligand_resname=ligand_residue.resname.strip(),
                            ligand_resseq=ligand_residue.id[1],
                            ligand_atom=ligand_atom.name.strip(),
                            distance=round(d, 3),
                        )
                    )

    interactions.sort(key=lambda x: (x.distance, x.receptor_chain, x.receptor_resseq, x.receptor_atom))

    return {
        "ligand": {
            "name": ligand_resname,
            "chain": ligand_chain,
            "residues": [_residue_label(r) for r in ligand_residues],
        },
        "interaction_count": len(interactions),
        "interactions": [i.__dict__ for i in interactions],
        "engine_used": "heuristic",
        "warnings": [],
    }


def compare_interaction_patterns(
    pdb_text_1: str,
    ligand_resname_1: str | None,
    ligand_chain_1: str | None,
    pdb_text_2: str,
    ligand_resname_2: str | None,
    ligand_chain_2: str | None,
    engine: str = "auto",
) -> dict:
    result_1 = detect_interactions(pdb_text_1, ligand_resname_1, ligand_chain_1, engine=engine)
    result_2 = detect_interactions(pdb_text_2, ligand_resname_2, ligand_chain_2, engine=engine)

    interactions_1 = [Interaction(**x) for x in result_1["interactions"]]
    interactions_2 = [Interaction(**x) for x in result_2["interactions"]]

    set_1 = {i.signature() for i in interactions_1}
    set_2 = {i.signature() for i in interactions_2}

    only_1 = sorted(set_1 - set_2)
    only_2 = sorted(set_2 - set_1)
    shared = sorted(set_1 & set_2)

    def _to_rows(items: list[tuple[str, str, int, str]]) -> list[dict]:
        return [
            {
                "interaction_type": i[0],
                "receptor_chain": i[1],
                "receptor_resseq": i[2],
                "receptor_resname": i[3],
                "signature_key": f"{i[0]}|{i[1]}|{i[2]}|{i[3]}",
            }
            for i in items
        ]

    # Keep one representative full interaction per signature so the UI can highlight
    # receptor/ligand atoms in each viewer while compare lists remain signature-level.
    examples_1: dict[str, dict] = {}
    examples_2: dict[str, dict] = {}
    for interaction in interactions_1:
        key = interaction.signature_key()
        if key not in examples_1:
            examples_1[key] = interaction.__dict__
    for interaction in interactions_2:
        key = interaction.signature_key()
        if key not in examples_2:
            examples_2[key] = interaction.__dict__

    return {
        "complex_1": {
            "ligand": result_1["ligand"],
            "interaction_count": result_1["interaction_count"],
            "engine_used": result_1["engine_used"],
            "warnings": result_1.get("warnings", []),
        },
        "complex_2": {
            "ligand": result_2["ligand"],
            "interaction_count": result_2["interaction_count"],
            "engine_used": result_2["engine_used"],
            "warnings": result_2.get("warnings", []),
        },
        "shared": _to_rows(shared),
        "only_in_complex_1": _to_rows(only_1),
        "only_in_complex_2": _to_rows(only_2),
        "example_interactions_complex_1": examples_1,
        "example_interactions_complex_2": examples_2,
    }


def detect_interactions(
    pdb_text: str,
    ligand_resname: str | None = None,
    ligand_chain: str | None = None,
    cutoff: float = 5.0,
    engine: str = "auto",
) -> dict:
    mode = (engine or "auto").lower()
    if mode not in {"auto", "plip", "heuristic"}:
        raise ValueError("Invalid engine. Use one of: auto, plip, heuristic.")

    # PLIP is primarily small-molecule focused. For chain-as-ligand mode, default to heuristic.
    if ligand_chain and not ligand_resname:
        if mode == "plip":
            raise ValueError(
                "PLIP mode is not supported for chain-as-ligand selection. Use engine=heuristic or auto."
            )
        heuristic = _detect_interactions_heuristic(
            pdb_text=pdb_text,
            ligand_resname=ligand_resname,
            ligand_chain=ligand_chain,
            cutoff=cutoff,
        )
        if mode == "auto":
            heuristic["warnings"] = [
                "Chain-as-ligand selection detected; using heuristic engine (PLIP is small-molecule focused).",
            ]
        return heuristic

    if mode in {"auto", "plip"}:
        try:
            return _detect_interactions_plip(
                pdb_text=pdb_text, ligand_resname=ligand_resname, ligand_chain=ligand_chain
            )
        except ImportError:
            if mode == "plip":
                raise ValueError(
                    "PLIP engine requested but not available. Install PLIP and OpenBabel dependencies."
                )
            heuristic = _detect_interactions_heuristic(
                pdb_text=pdb_text,
                ligand_resname=ligand_resname,
                ligand_chain=ligand_chain,
                cutoff=cutoff,
            )
            heuristic["warnings"] = [
                "PLIP not available; using heuristic interaction model instead.",
            ]
            return heuristic

    return _detect_interactions_heuristic(
        pdb_text=pdb_text,
        ligand_resname=ligand_resname,
        ligand_chain=ligand_chain,
        cutoff=cutoff,
    )


def inspect_pdb_entities(pdb_text: str) -> dict:
    structure = parse_structure(pdb_text)
    model = next(structure.get_models(), None)
    if model is None:
        raise ValueError("No model found in PDB file.")

    chains = []
    het_ligands: dict[tuple[str, str], dict] = {}

    for chain in model.get_chains():
        protein_count = 0
        ligand_count = 0
        residue_total = 0
        for residue in chain.get_residues():
            if _is_water_residue(residue):
                continue
            residue_total += 1
            if _is_protein_residue(residue):
                protein_count += 1
            elif _is_ligand_residue(residue):
                ligand_count += 1
                key = (chain.id, residue.resname.strip())
                if key not in het_ligands:
                    het_ligands[key] = {
                        "chain": chain.id,
                        "resname": residue.resname.strip(),
                        "instances": 0,
                    }
                het_ligands[key]["instances"] += 1

        if residue_total == 0:
            continue

        chain_role = "protein_like" if protein_count >= ligand_count else "ligand_like"
        chains.append(
            {
                "chain": chain.id,
                "residue_count": residue_total,
                "protein_residues": protein_count,
                "het_residues": ligand_count,
                "role_hint": chain_role,
            }
        )

    chains.sort(key=lambda c: c["chain"])
    ligands = sorted(het_ligands.values(), key=lambda x: (x["chain"], x["resname"]))
    return {
        "chains": chains,
        "het_ligands": ligands,
    }

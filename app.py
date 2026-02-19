from __future__ import annotations

from pathlib import Path
import re
from urllib.error import URLError
from urllib.request import urlopen

from flask import Flask, jsonify, render_template, request

from analyzer import (
    align_structure_for_compare,
    compare_interaction_patterns,
    detect_interactions,
    inspect_pdb_entities,
)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024  # 8MB


@app.get("/")
def index():
    return render_template("index.html")


def _normalize_pdb_id(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = value.strip().upper()
    if not re.fullmatch(r"[A-Z0-9]{4}", cleaned):
        raise ValueError(f"Invalid PDB code '{value}'. Expected 4 alphanumeric characters.")
    return cleaned


def _download_pdb_by_id(pdb_id: str) -> str:
    url = f"https://files.rcsb.org/download/{pdb_id}.pdb"
    try:
        with urlopen(url, timeout=20) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
    except URLError as exc:
        raise ValueError(f"Could not download PDB '{pdb_id}' from RCSB.") from exc

    if "ATOM" not in raw and "HETATM" not in raw:
        raise ValueError(f"Downloaded file for '{pdb_id}' did not look like a valid PDB structure.")
    return raw


def _extract_complex_text(file_field_name: str, pdb_id_field_name: str) -> tuple[str, str]:
    uploaded = request.files.get(file_field_name)
    if not uploaded or uploaded.filename == "":
        pdb_id = _normalize_pdb_id(request.form.get(pdb_id_field_name))
        if pdb_id:
            return _download_pdb_by_id(pdb_id), f"pdb:{pdb_id}"
        raise ValueError(f"Missing input for '{file_field_name}'. Provide a file or a PDB code.")

    filename = uploaded.filename.lower()
    if not (filename.endswith(".pdb") or filename.endswith(".ent") or filename.endswith(".txt") or "." not in filename):
        raise ValueError(f"Unsupported file type for '{file_field_name}'. Use .pdb/.ent/.txt")

    return uploaded.read().decode("utf-8", errors="ignore"), f"file:{uploaded.filename}"


@app.post("/api/analyze")
def analyze():
    try:
        pdb_text, source = _extract_complex_text("complex", "pdb_id")
        ligand_resname = (request.form.get("ligand_resname") or "").strip().upper() or None
        ligand_chain = (request.form.get("ligand_chain") or "").strip() or None
        engine = (request.form.get("engine") or "auto").strip().lower() or "auto"

        result = detect_interactions(pdb_text, ligand_resname, ligand_chain, engine=engine)
        result["pdb"] = pdb_text
        result["source"] = source
        return jsonify(result)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": f"Unexpected error: {exc}"}), 500


@app.post("/api/inspect")
def inspect():
    try:
        pdb_text, source = _extract_complex_text("complex", "pdb_id")
        result = inspect_pdb_entities(pdb_text)
        result["source"] = source
        return jsonify(result)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": f"Unexpected error: {exc}"}), 500


@app.post("/api/compare")
def compare():
    try:
        pdb_1, source_1 = _extract_complex_text("complex_1", "pdb_id_1")
        pdb_2, source_2 = _extract_complex_text("complex_2", "pdb_id_2")

        ligand_resname_1 = (request.form.get("ligand_resname_1") or "").strip().upper() or None
        ligand_chain_1 = (request.form.get("ligand_chain_1") or "").strip() or None
        ligand_resname_2 = (request.form.get("ligand_resname_2") or "").strip().upper() or None
        ligand_chain_2 = (request.form.get("ligand_chain_2") or "").strip() or None
        engine = (request.form.get("engine") or "auto").strip().lower() or "auto"
        align_structures = (request.form.get("align_structures") or "true").strip().lower() != "false"

        comparison = compare_interaction_patterns(
            pdb_1,
            ligand_resname_1,
            ligand_chain_1,
            pdb_2,
            ligand_resname_2,
            ligand_chain_2,
            engine=engine,
        )
        comparison["pdb_1"] = pdb_1
        comparison["source_1"] = source_1
        comparison["source_2"] = source_2
        if align_structures:
            alignment = align_structure_for_compare(
                pdb_text_reference=pdb_1,
                pdb_text_moving=pdb_2,
                ligand_chain_reference=ligand_chain_1,
                ligand_chain_moving=ligand_chain_2,
            )
            comparison["pdb_2"] = alignment.get("aligned_pdb_text", pdb_2)
            comparison["alignment"] = alignment
        else:
            comparison["pdb_2"] = pdb_2
            comparison["alignment"] = {
                "aligned": False,
                "reason": "Alignment disabled by user.",
            }
        return jsonify(comparison)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": f"Unexpected error: {exc}"}), 500


if __name__ == "__main__":
    debug = True
    if (Path.cwd() / ".env").exists():
        debug = False
    app.run(host="0.0.0.0", port=5000, debug=debug)

from __future__ import annotations

from pathlib import Path

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


def _extract_text_file(field_name: str) -> str:
    uploaded = request.files.get(field_name)
    if not uploaded or uploaded.filename == "":
        raise ValueError(f"Missing file: '{field_name}'.")

    filename = uploaded.filename.lower()
    if not (filename.endswith(".pdb") or filename.endswith(".ent") or filename.endswith(".txt")):
        raise ValueError(f"Unsupported file type for '{field_name}'. Use .pdb/.ent/.txt")

    return uploaded.read().decode("utf-8", errors="ignore")


@app.post("/api/analyze")
def analyze():
    try:
        pdb_text = _extract_text_file("complex")
        ligand_resname = (request.form.get("ligand_resname") or "").strip().upper() or None
        ligand_chain = (request.form.get("ligand_chain") or "").strip() or None
        engine = (request.form.get("engine") or "auto").strip().lower() or "auto"

        result = detect_interactions(pdb_text, ligand_resname, ligand_chain, engine=engine)
        result["pdb"] = pdb_text
        return jsonify(result)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": f"Unexpected error: {exc}"}), 500


@app.post("/api/inspect")
def inspect():
    try:
        pdb_text = _extract_text_file("complex")
        result = inspect_pdb_entities(pdb_text)
        return jsonify(result)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": f"Unexpected error: {exc}"}), 500


@app.post("/api/compare")
def compare():
    try:
        pdb_1 = _extract_text_file("complex_1")
        pdb_2 = _extract_text_file("complex_2")

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

"""Fetch a pinned, bounded Ardour source set and retain metadata, never vendor code.

Network access is required. This is a research tool, not Soundr's audio engine.
"""

import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import urllib.request

COMMIT = "a9ea4a98a336729a69453edbcc29905a79ac75e1"
FILES = {
    "libs/ardour/ardour/source.h": [r"class .*Source", r"get_state", r"set_state"],
    "libs/ardour/ardour/region.h": [r"class .*Region", r"SourceList", r"_sources", r"position\(", r"start\(", r"length\("],
    "libs/ardour/ardour/audioregion.h": [r"class .*AudioRegion", r"read_at", r"_scale_amplitude", r"_fade_in", r"_fade_out"],
    "libs/ardour/ardour/playlist.h": [r"class .*Playlist", r"RegionList", r"add_region", r"split_region", r"_regions"],
    "libs/ardour/ardour/track.h": [r"class .*Track", r"public Route", r"playlist", r"disk_reader"],
    "libs/ardour/ardour/route.h": [r"class .*Route", r"ProcessorList", r"_processors", r"_output", r"_input"],
    "libs/ardour/ardour/audioengine.h": [r"class .*AudioEngine", r"process_callback", r"set_session"],
    "libs/ardour/audioregion.cc": [r"AudioRegion::read_at", r"_scale_amplitude", r"_fade_in", r"_fade_out"],
    "libs/ardour/session_state.cc": [r"Session::save_state", r"Session::get_state", r"Sources", r"Playlists", r"Routes", r"rename"],
    "libs/ardour/audioengine.cc": [r"AudioEngine::process_callback", r"_session->process", r"_session.*process"],
    "libs/ardour/export_handler.cc": [r"ExportHandler::", r"start_timespan", r"process_timespan", r"finish_timespan"],
    "gtk2_ardour/editor_ops.cc": [r"begin_reversible_command", r"add_command", r"commit_reversible_command"],
}


def inspect_file(item):
    path, patterns = item
    url = f"https://raw.githubusercontent.com/Ardour/ardour/{COMMIT}/{path}"
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "Soundr-research"})
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read()
        lines = body.decode("utf-8").splitlines()
        hits = {pattern: [n for n, line in enumerate(lines, 1) if re.search(pattern, line)] for pattern in patterns}
        return {
            "path": path, "url": url, "status": "retrieved",
            "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body),
            "line_count": len(lines), "symbol_lines": hits,
            "license_header_mentions_gpl": "GNU General Public License" in "\n".join(lines[:55]),
        }, lines
    except Exception as error:
        return {"path": path, "url": url, "status": "failed", "error": str(error)}, []


def main():
    root = Path(__file__).resolve().parents[1]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(inspect_file, FILES.items()))
    report = {
        "research_date": "2026-10-16", "repository": "https://github.com/Ardour/ardour",
        "commit": COMMIT, "evidence_type": "static-source-inspection",
        "limitations": ["Bounded selection; not a complete repository audit.", "No build or runtime behaviour observed.", "Metadata and symbol locations retained; upstream implementation not vendored."],
        "files": [result[0] for result in results],
    }
    destination = root / "research" / "evidence" / "ardour-source-inspection.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    for metadata, lines in results:
        print(json.dumps(metadata))
        if not lines:
            continue
        # Small, bounded reading windows for implementation paths of interest.
        targets = {
            "libs/ardour/audioregion.cc": "AudioRegion::read_at",
            "libs/ardour/audioengine.cc": "AudioEngine::process_callback",
            "libs/ardour/session_state.cc": "Session::save_state",
            "libs/ardour/ardour/region.h": "SourceList",
        }
        needle = targets.get(metadata["path"])
        if needle:
            for number, line in enumerate(lines, 1):
                if needle in line:
                    end = min(number + 34, len(lines))
                    print(f"READING WINDOW {metadata['path']}:{number}-{end}")
                    print("\n".join(f"{n}: {lines[n - 1]}" for n in range(number, end + 1)))
                    break
    failures = [entry for entry in report["files"] if entry["status"] != "retrieved"]
    print(f"Saved {destination}; {len(report['files']) - len(failures)}/{len(report['files'])} files retrieved")
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()

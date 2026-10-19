"""Validate Soundr's research artefacts; this does not run an audio editor."""

from collections import Counter
from fractions import Fraction
import json
from pathlib import Path
import re
import sys

try:
    from jsonschema import Draft202012Validator
except ImportError:
    raise SystemExit("This check requires Python and the jsonschema package; no dependency was installed by this pack.")

ROOT = Path(__file__).resolve().parents[1]
CHECKS = []


def require(condition, message):
    if not condition:
        raise ValueError(message)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(path):
    def invalid_constant(value):
        raise ValueError(f"Nonfinite JSON constant: {value}")
    return json.loads(path.read_text(encoding="utf-8-sig"), object_pairs_hook=unique_object, parse_constant=invalid_constant)


def no_cycles(graph, label):
    active, done = set(), set()
    def visit(node):
        require(node not in active, f"{label} cycle at {node}")
        if node in done:
            return
        active.add(node)
        for target in graph.get(node, []):
            visit(target)
        active.remove(node)
        done.add(node)
    for node in graph:
        visit(node)


def validate_project(project):
    collections = ("sources", "pictureRevisions", "clips", "tracks", "buses", "routes", "automation", "cues", "takeGroups", "renderJobs")
    all_ids = [project["id"]]
    indexes = {}
    for name in collections:
        all_ids.extend(entity["id"] for entity in project[name])
        indexes[name] = {entity["id"]: entity for entity in project[name]}
    processors = {}
    for owner in project["tracks"] + project["buses"]:
        for processor in owner["processors"]:
            all_ids.append(processor["id"])
            processors[processor["id"]] = processor
    take_to_group = {}
    for group in project["takeGroups"]:
        for take in group["takes"]:
            all_ids.append(take["id"])
            take_to_group[take["id"]] = group
    duplicates = [key for key, count in Counter(all_ids).items() if count > 1]
    require(not duplicates, f"Duplicate entity IDs: {duplicates}")
    sources, clips, tracks, buses, cues, pictures = [indexes[name] for name in ("sources", "clips", "tracks", "buses", "cues", "pictureRevisions")]
    require(project["activePictureRevisionId"] is None or project["activePictureRevisionId"] in pictures, "Unknown active picture")

    lineage = {}
    for source in sources.values():
        parent = source["parentSourceId"]
        require(source["role"] != "derived" or parent in sources, f"Derived source lacks parent: {source['id']}")
        require(parent is None or parent in sources, f"Unknown parent source: {source['id']}")
        require(source["role"] != "original" or parent is None, f"Original source has parent: {source['id']}")
        require(source["availability"] != "verified" or source["sha256"] is not None, f"Verified source lacks hash: {source['id']}")
        lineage[source["id"]] = [] if parent is None else [parent]
    no_cycles(lineage, "Source lineage")

    memberships = Counter()
    for track in tracks.values():
        for clip_id in track["clipIds"]:
            require(clip_id in clips, f"Unknown clip in track: {clip_id}")
            require(clips[clip_id]["trackId"] == track["id"], f"Clip/track ownership mismatch: {clip_id}")
            memberships[clip_id] += 1
    required_source_ids = set()
    for clip in clips.values():
        clip_id = clip["id"]
        require(memberships[clip_id] == 1, f"Clip must belong to exactly one track: {clip_id}")
        require(clip["sourceId"] in sources, f"Unknown source: {clip_id}")
        source = sources[clip["sourceId"]]
        require(clip["sourceInSample"] + clip["durationSamples"] <= source["durationSamples"], f"Source bounds exceeded: {clip_id}")
        require(clip["timelineStartSample"] + clip["durationSamples"] <= 9007199254740991, f"Unsafe end position: {clip_id}")
        for side in ("fadeIn", "fadeOut"):
            require(clip[side]["durationSamples"] <= clip["durationSamples"], f"Fade too long: {clip_id}")
        require(all(cue_id in cues for cue_id in clip["cueIds"]), f"Unknown clip cue: {clip_id}")
        anchor = clip["anchor"]
        if anchor["type"] == "cue":
            require(anchor["cueId"] in cues and anchor["cueId"] in clip["cueIds"], f"Unknown/unlinked anchor cue: {clip_id}")
            expected = cues[anchor["cueId"]]["startSample"] + anchor["offsetSamples"]
            require(expected == clip["timelineStartSample"], f"Inconsistent resolved anchor: {clip_id}")
        active_take = True
        if clip["takeId"] is not None:
            require(clip["takeId"] in take_to_group, f"Unknown take: {clip_id}")
            group = take_to_group[clip["takeId"]]
            require(group["cueId"] in clip["cueIds"], f"Take/cue mismatch: {clip_id}")
            require(tracks[clip["trackId"]]["overlapPolicy"] == "selected-take", f"Take filtering not enabled: {clip_id}")
            active_take = group["selectedTakeId"] == clip["takeId"]
        if clip["isEnabled"] and active_take and not tracks[clip["trackId"]]["isMuted"]:
            required_source_ids.add(clip["sourceId"])
    for group in project["takeGroups"]:
        require(group["cueId"] in cues, f"Unknown take-group cue: {group['id']}")
        require(group["selectedTakeId"] in {take["id"] for take in group["takes"]}, f"Invalid selected take: {group['id']}")
    for cue in cues.values():
        require(cue["pictureRevisionId"] is None or cue["pictureRevisionId"] in pictures, f"Unknown cue picture: {cue['id']}")
        for external in cue["storyRefs"]:
            valid = {"screenwritr": {"character", "line", "scene"}, "storytellr": {"shot", "event", "scene"}}
            require(external["entityType"] in valid[external["system"]], f"Invalid story namespace: {cue['id']}")
        approval = cue["approval"]
        if approval["status"] == "approved":
            require(approval["reviewerId"] is not None, f"Approved cue lacks reviewer: {cue['id']}")
            require(approval["approvedPictureRevisionId"] == cue["pictureRevisionId"] and cue["pictureRevisionId"] is not None, f"Approval picture mismatch: {cue['id']}")
            if cue["kind"] == "dialogue":
                group = take_to_group.get(approval["approvedTakeId"])
                require(group is not None and group["cueId"] == cue["id"] and group["selectedTakeId"] == approval["approvedTakeId"], f"Approval take mismatch: {cue['id']}")

    nodes = {**tracks, **buses}
    masters = [bus["id"] for bus in buses.values() if bus["role"] == "master"]
    require(len(masters) == 1, "Exactly one master bus required")
    graph = {node: [] for node in nodes}
    edge_keys = set()
    for route in project["routes"]:
        require(route["fromId"] in nodes and route["toBusId"] in buses, f"Unknown route endpoint: {route['id']}")
        require(route["fromId"] != masters[0], "Master has outgoing route")
        edge_key = (route["fromId"], route["toBusId"], route["tap"])
        require(edge_key not in edge_keys, f"Duplicate route: {route['id']}")
        edge_keys.add(edge_key)
        channel_keys = [(channel["from"], channel["to"]) for channel in route["channelMap"]]
        require(len(channel_keys) == len(set(channel_keys)), f"Duplicate channel mapping: {route['id']}")
        graph[route["fromId"]].append(route["toBusId"])
    no_cycles(graph, "Routing")
    def reaches_master(node):
        return node == masters[0] or any(reaches_master(target) for target in graph[node])
    require(all(reaches_master(track) for track in tracks), "Track cannot reach master")

    for automation in project["automation"]:
        target = automation["target"]
        if target["kind"] == "processor":
            require(target["id"] in processors, f"Unknown processor target: {automation['id']}")
            processor = processors[target["id"]]
            ranges = {"builtin.gain": {"gainDb": (-120, 36)}, "builtin.highpass": {"cutoffHz": (20, 20000), "q": (0.1, 10)}}[processor["type"]]
        else:
            owners = tracks if target["kind"] == "track" else buses
            require(target["id"] in owners, f"Unknown automation owner: {automation['id']}")
            ranges = {"gainDb": (-120, 36)}
        require(target["parameter"] in ranges, f"Unsupported automation parameter: {automation['id']}")
        anchor = automation["anchor"]
        if anchor["type"] == "cue":
            require(anchor["cueId"] in cues, f"Unknown automation anchor: {automation['id']}")
            origin = cues[anchor["cueId"]]["startSample"]
        else:
            origin = 0
        last = None
        lo, hi = ranges[target["parameter"]]
        for point in automation["points"]:
            require(last is None or point["timeSample"] > last, f"Unordered automation: {automation['id']}")
            require(0 <= origin + point["timeSample"] <= 9007199254740991, f"Invalid automation time: {automation['id']}")
            require(lo <= point["value"] <= hi, f"Automation value out of range: {automation['id']}")
            last = point["timeSample"]
    output_paths = set()
    for job in project["renderJobs"]:
        require(job["projectRevision"] <= project["revision"], f"Future render revision: {job['id']}")
        require(job["pictureRevisionId"] is None or job["pictureRevisionId"] in pictures, f"Unknown render picture: {job['id']}")
        require(job["status"] == "draft" or job["projectContentHash"] is not None, f"Frozen job lacks content hash: {job['id']}")
        selected_buses = set()
        for output in job["outputs"]:
            require(output["busId"] in buses and output["busId"] not in selected_buses, f"Invalid/repeated output bus: {job['id']}")
            selected_buses.add(output["busId"])
            key = output["relativePath"].casefold()
            require(key not in output_paths, f"Case-insensitive output collision: {job['id']}")
            output_paths.add(key)
            is_master = output["busId"] == masters[0]
            require(is_master == (job["tap"] == "master-output"), f"Render tap/bus mismatch: {job['id']}")
    active_picture = pictures.get(project["activePictureRevisionId"])
    if active_picture:
        picture_samples = Fraction(active_picture["durationFrames"] * project["sampleRate"] * active_picture["fps"]["denominator"], active_picture["fps"]["numerator"])
        require(picture_samples == 3600000, "Illustrative picture must represent 75 seconds")
    unresolved = sorted(source_id for source_id in required_source_ids if sources[source_id]["availability"] != "verified" or sources[source_id]["sha256"] is None)
    picture_ready = active_picture is None or (active_picture["availability"] == "verified" and active_picture["sha256"] is not None)
    return {"requiredSources": sorted(required_source_ids), "unresolvedRequiredSources": unresolved, "declaredDependenciesReady": not unresolved and picture_ready, "actualPlaybackTested": False}


def main():
    excluded = {"node_modules", ".soundr-data", "output", ".playwright-cli", ".git", ".venv", "__pycache__"}
    pack_files = lambda suffix: (p for p in ROOT.rglob(suffix) if not excluded.intersection(p.relative_to(ROOT).parts))
    for path in pack_files("*.json"):
        read_json(path)
    CHECKS.append("All JSON files parse without duplicate keys or nonfinite constants")
    schema = read_json(ROOT / "schemas/soundr-project.schema.json")
    Draft202012Validator.check_schema(schema)
    project = read_json(ROOT / "examples/scene-75s.soundr.json")
    Draft202012Validator(schema).validate(project)
    CHECKS.append("Draft 2020-12 project schema and illustrative project shape")
    readiness = validate_project(project)
    require(project["purpose"] == "illustrative-fixture" and not readiness["declaredDependenciesReady"], "Fixture must remain explicitly unresolved")
    CHECKS.append("Fixture IDs, bounds, takes, anchors, approvals, routing, automation and draft render consistency")

    checked_links = 0
    for path in pack_files("*.md"):
        content = path.read_text(encoding="utf-8")
        for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", content):
            if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target) or target.startswith("#"):
                continue
            target_path = (path.parent / target.split("#", 1)[0]).resolve()
            require(target_path.is_relative_to(ROOT), f"Local link escapes pack: {path.name}: {target}")
            require(target_path.exists(), f"Broken local link: {path.name}: {target}")
            checked_links += 1
    CHECKS.append(f"{checked_links} local Markdown links resolve inside Soundr")

    spec = (ROOT / "docs/BUILD_SPEC.md").read_text(encoding="utf-8")
    requirements = set(re.findall(r"SND-\d{3}", spec))
    scenarios = read_json(ROOT / "acceptance/scenarios.json")["scenarios"]
    covered = {requirement for scenario in scenarios for requirement in scenario["requirements"]}
    require(requirements == covered and len(requirements) == 18, "Requirement/scenario coverage mismatch")
    require(len({scenario["id"] for scenario in scenarios}) == len(scenarios), "Duplicate scenario ID")
    require(all(scenario["status"] == "NOT_RUN" for scenario in scenarios), "Historical M0 scenarios must retain their NOT RUN status; M1 receipts live separately")
    benchmark = read_json(ROOT / "acceptance/benchmark-status.json")
    require(benchmark["status"] == "NOT_RUN" and all(run["status"] == "NOT_RUN" for run in benchmark["runs"]), "Unsubstantiated benchmark result")
    require({run["application"] for run in benchmark["runs"]} == {"REAPER", "Nuendo", "Pro Tools", "Fairlight", "Ardour", "Audition"}, "Missing reference-system run entry")
    CHECKS.append(f"18 requirements covered by {len(scenarios)} planned scenarios; all six application runs remain NOT RUN")

    revision = read_json(ROOT / "research/evidence/ardour-revision.json")["resolved_commit"]
    ledger = read_json(ROOT / "research/evidence/ardour-source-inspection.json")
    require(ledger["commit"] == revision and len(ledger["files"]) == 12, "Pinned source coverage mismatch")
    for entry in ledger["files"]:
        require(entry["status"] == "retrieved" and re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]), f"Incomplete source receipt: {entry['path']}")
        require(f"/{revision}/" in entry["url"], f"Unpinned source URL: {entry['path']}")
        require(all(1 <= number <= entry["line_count"] for numbers in entry["symbol_lines"].values() for number in numbers), f"Invalid source landmark: {entry['path']}")
    CHECKS.append("Twelve successful source receipts at one exact Ardour commit, with hashes and valid symbol locations")
    reaper = read_json(ROOT / "research/evidence/reaper-api-inspection.json")
    require(reaper["generatedByVersion"] == "7.82" and re.fullmatch(r"[0-9a-f]{64}", reaper["sha256"]), "Missing REAPER API version/hash")
    require(len(reaper["functions"]) == 19 and all(entry["anchorFound"] for entry in reaper["functions"]), "Incomplete REAPER interface evidence")
    require(len(reaper["fields"]) == 7 and all(entry["documented"] for entry in reaper["fields"]), "Incomplete REAPER attribute evidence")
    CHECKS.append("REAPER 7.82 API documentation hash, nineteen function anchors and seven documented attributes")
    manifest = read_json(ROOT / "acceptance/render-manifest.template.json")
    require(manifest["status"] == "TEMPLATE_NOT_EXECUTED" and not manifest["outputs"] and not manifest["metrics"]["measured"], "Template must not imply an executed export")
    CHECKS.append("Render manifest remains an unexecuted template with unmeasured metrics")

    report = {
        "validatedOn": "2026-10-16", "status": "PASSED_ARTIFACT_VALIDATION", "scope": "M0 research artifacts only; M1 runtime evidence is separate",
        "checks": CHECKS, "exampleReadiness": readiness,
        "notTested": ["Audio engine or UI", "Native application scene runs", "Media decoding or audible quality", "Save/reopen runtime durability", "Sync or exports", "MCP runtime or sibling integration"],
    }
    destination = ROOT / "research/evidence/pack-validation.json"
    destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"PACK VALIDATION FAILED: {error}", file=sys.stderr)
        raise SystemExit(1)

# Soundr MCP

The official stdio MCP bridge calls the same local operation service as the browser.

## Setup

Start `npm start`, then configure your MCP host to launch:

~~~json
{
  "mcpServers": {
    "soundr": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["D:\\ICUNI Group\\ICUNI Labs\\Soundr\\mcp\\stdio.mjs"]
    }
  }
}
~~~

This is an example; no global host configuration was edited. Another data root can be supplied with `--data-root` and an absolute directory. The bridge reads private runtime metadata. Tokens do not belong in arguments, checked-in configuration or chat.

Initialization/tool listing works without the workstation. Project calls require the local service.

## Tools

| Tool | Purpose |
|---|---|
| `soundr_list_projects` | Saved sessions |
| `soundr_create_project` | Retry-safe creation |
| `soundr_inspect_project` | Revision, IDs, story, edits, routing, versions and jobs |
| `soundr_apply_commands` | Atomic editing, takes, routing, processing, automation, save and history |
| `soundr_import_asset` | WAV or verified picture from data-root imports |
| `soundr_import_story` | Supplied Screenwritr/Storytellr snapshot |
| `soundr_query_cues` | Character ID's unapproved lines, takes and clips |
| `soundr_preview_picture_change` | Pure stable-shot change plan |
| `soundr_audition_picture_change` | Read-only resolved candidate |
| `soundr_apply_picture_change` | One reviewed, undoable edit |
| `soundr_export_audio` | Frozen master/D/M/E job |
| `soundr_render_status` | Actual status, hashes and receipt |
| `soundr_restore_version` | Earlier snapshot as a new revision |

## Editing

Inspect first and use returned IDs. This example is illustrative:

~~~json
{
  "projectId": "project-returned-by-inspection",
  "expectedRevision": 12,
  "requestId": "director-edit-001",
  "commands": [
    {
      "type": "clip.move",
      "clipIds": ["clip-returned-by-inspection"],
      "deltaSamples": 2400
    },
    {
      "type": "clip.set",
      "clipId": "clip-returned-by-inspection",
      "gainDb": -2,
      "fadeIn": 240,
      "fadeOut": 960
    }
  ]
}
~~~

A timeout retry reuses the **exact** envelope and request ID, including the original expected revision. A different edit needs a fresh ID/current revision. Receipts distinguish committed and replayed results from validation/revision failures. History and save operations require separate envelopes.

Commands cover initial timing, story links, clip add/move/trim/slip/split/duplicate/set/link, take add/select, cue approval, track/bus controls, processors, routes, automation and explicit picture adoption. See [the runtime schema](../schemas/command-envelope-v2.schema.json); semantic validation also checks references, bounds, cycles and timing.

## Import and review

MCP media paths are relative to `.soundr-data/imports`. Absolute paths, traversal, escaping symlinks, arbitrary URLs and shell execution are not import operations. UI uploads enter the same validated import service.

Story formats are `screenwritr` for story-graph v1 and `storytellr` for native v2. Storytellr can supply an exact rational `frameRate` and `sceneMap`. Board IDs become shot IDs. Changed cut timing requires reconform. Upstream live sharing/revocation remains intact; Soundr imports supplied snapshots.

Picture-change tools require an imported version and explicit shot map. Inspect conflicts and obtain director choices. Do not infer production editorial resolutions. Re-preview after edits or restart. Audition returns a candidate and local prepared-audio URL without a commit.

Export initially returns a queued job ID. Poll `soundr_render_status`. Only a completed manifest establishes delivery; inspect cut, range, origin, omissions, warnings and hashes.

Responses are bounded to 1 MiB. Use summary inspection and paginated queries for larger sessions. No remote public MCP endpoint is exposed.


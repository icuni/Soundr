import { check, hash } from './util.mjs';
import { StorySchema } from './model.mjs';
import { FRAME_RATES, sameRate } from './time.mjs';
const ref = (application, projectId, entityId, revision) => ({
  application,
  projectId,
  entityId,
  revision,
});
export function adaptStoryGraph(graph) {
  check(
    graph?.schema === 'org.icuni.story-graph' && graph.schemaVersion === 1,
    'UNSUPPORTED_OPERATION',
    'Choose a Screenwritr story-graph v1 export.',
  );
  const projectId = graph.snapshot?.storyId,
    revision = String(graph.snapshot?.updatedAt || 'unversioned');
  check(
    projectId &&
      Array.isArray(graph.scenes) &&
      Array.isArray(graph.blocks) &&
      Array.isArray(graph.entities),
    'VALIDATION_ERROR',
    'The story graph is incomplete.',
  );
  const characters = graph.entities
    .filter((e) => e.kind === 'characters')
    .map((e) => ({
      id: e.id,
      name: e.name,
      sourceRef: ref('Screenwritr', projectId, e.id, revision),
    }));
  const characterById = new Map(
    graph.entities.filter((e) => e.kind === 'characters').map((e) => [e.id, e]),
  );
  const scenes = graph.scenes.map((s) => ({
    id: s.id,
    name: s.heading || s.id,
    sourceRef: ref('Screenwritr', projectId, s.id, revision),
  }));
  const blocks = new Map(graph.blocks.map((b) => [b.id, b])),
    lines = [],
    warnings = [];
  for (const scene of graph.scenes) {
    let speaker = null,
      uncertain = true;
    for (const blockId of scene.blockIds || []) {
      const b = blocks.get(blockId);
      if (!b || b.omitted) continue;
      if (b.type === 'character') {
        const links = (graph.relationships || []).filter(
          (r) =>
            r.to === b.id &&
            r.type === 'dialogue-cue' &&
            r.confidence === 'explicit' &&
            characterById.has(r.from),
        );
        speaker = links.length === 1 ? links[0].from : null;
        uncertain = !speaker || characterById.get(speaker)?.inferred === true;
      }
      if (b.type === 'dialogue') {
        lines.push({
          id: b.id,
          sceneId: scene.id,
          characterId: speaker,
          text: b.text,
          reviewRequired: uncertain,
          sourceRef: ref('Screenwritr', projectId, b.id, revision),
        });
        if (uncertain)
          warnings.push({
            lineId: b.id,
            message:
              'Confirm the character for this line; no unique declared character link was supplied.',
          });
      }
    }
  }
  const story = StorySchema.parse({
    characters,
    scenes,
    lines,
    shots: [],
    imports: [{ application: 'Screenwritr', projectId, revision, sha256: hash(graph) }],
  });
  return { storyProjectId: projectId, story, warnings };
}
export function adaptStorytellr(project, { frameRate, sceneMap = {}, revision = 'snapshot' } = {}) {
  check(
    project?.schemaVersion === 2 && Array.isArray(project.scenes) && Array.isArray(project.boards),
    'UNSUPPORTED_OPERATION',
    'Choose a Storytellr v2 project snapshot.',
  );
  const fps = frameRate || { numerator: project.fps, denominator: 1 };
  check(
    FRAME_RATES.some((r) => sameRate(r, fps)),
    'UNSUPPORTED_OPERATION',
    'Supply a supported exact rational frame rate.',
  );
  check(
    Math.abs(project.fps - fps.numerator / fps.denominator) < 0.0001,
    'VALIDATION_ERROR',
    'The declared frame rate disagrees with Storytellr.',
  );
  const scenes = project.scenes.map((s) => ({
    id: sceneMap[s.id] || s.id,
    name: s.name,
    sourceRef: ref('Storytellr', project.id, s.id, revision),
  }));
  const shots = [];
  let frame = 0;
  for (const scene of project.scenes)
    for (const b of project.boards.filter((b) => b.sceneId === scene.id)) {
      check(
        Number.isInteger(b.durationFrames) && b.durationFrames > 0,
        'VALIDATION_ERROR',
        'Board duration must be whole frames.',
      );
      shots.push({
        id: b.id,
        sceneId: sceneMap[scene.id] || scene.id,
        name: b.name,
        startFrame: frame,
        durationFrames: b.durationFrames,
        isPresent: true,
        sourceRef: ref('Storytellr', project.id, b.id, revision),
      });
      frame += b.durationFrames;
    }
  check(
    shots.length === project.boards.length,
    'VALIDATION_ERROR',
    'A board has an unknown scene.',
  );
  return {
    scenes,
    shots,
    frameRate: fps,
    importRecord: {
      application: 'Storytellr',
      projectId: project.id,
      revision,
      sha256: hash(project),
    },
    warnings: [
      'This imports IDs and timing only. Media files are imported separately; no sibling project was changed.',
    ],
  };
}

export function createMockProject(projectId = 'proj_demo') {
  const now = new Date().toISOString();

  return {
    meta: {
      id: String(projectId || 'proj_demo'),
      title: 'Demo Session',
      owner: 'user_demo',
      createdAt: now,
      updatedAt: now,
    },
    transport: {
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      playhead: 0,
      loopRange: { enabled: false, start: 0, end: 8 },
      grid: '1/16',
    },
    tracks: [
      // Start empty; user adds tracks as needed.
    ],
    assets: [],
    clips: [],
    markers: [],
    regions: [],
    fork: {
      parentProjectId: null,
      rootProjectId: null,
      versionId: 'v1',
    },
  };
}

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
    fx: {
      enabled: false,
      quality: 'low',
      master: {
        eq: { enabled: false, low: 0, mid: 0, high: 0 },
        compressor: {
          enabled: false,
          threshold: -18,
          ratio: 2.5,
          attack: 0.003,
          release: 0.25,
          knee: 18,
          makeup: 0,
        },
        delay: { enabled: false, time: 0.28, feedback: 0.25, mix: 0.2 },
        reverb: { enabled: false, mix: 0.22, seconds: 1.6, decay: 2.2, preDelay: 0.012, irUrl: '' },
      },
    },
    fork: {
      parentProjectId: null,
      rootProjectId: null,
      forkFromVersionId: null,
      versionId: 'v1',
    },
  };
}

// Getting-started progress. Only real records count: simulated stations and demo or simulated
// devices never complete a setup step.
export interface SetupCounts {
  sites: number;
  realStations: number;
  devices: number;
  /** Current session passed two-step verification (AAL2). */
  twoStep: boolean;
}

export function setupProgress(c: SetupCounts) {
  const site = c.sites > 0;
  const station = c.realStations > 0;
  const device = c.devices > 0;
  const twoStep = c.twoStep;
  const steps = [true, twoStep, site, device];
  const done = steps.filter(Boolean).length;
  return { twoStep, site, station, device, done, total: steps.length, complete: done === steps.length };
}

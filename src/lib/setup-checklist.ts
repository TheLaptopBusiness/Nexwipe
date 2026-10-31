// Getting-started progress. Only real records count: simulated stations and demo or simulated
// devices never complete a setup step.
export interface SetupCounts {
  sites: number;
  realStations: number;
  devices: number;
}

export function setupProgress(c: SetupCounts) {
  const site = c.sites > 0;
  const station = c.realStations > 0;
  const device = c.devices > 0;
  const steps = [true, true, site, device];
  const done = steps.filter(Boolean).length;
  return { site, station, device, done, total: steps.length, complete: done === steps.length };
}
